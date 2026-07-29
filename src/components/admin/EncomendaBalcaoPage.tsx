'use client';

import React, { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Bike, CakeSlice, CalendarDays, Loader2, Store, User, Wallet } from 'lucide-react';
import { brl } from '@/lib/utils';
import type { EncomendaConfig } from '@/lib/encomendas/config';
import type { ProductKind, SkuOption } from '@/lib/encomendas/catalog';
import type { Encomenda } from '@/lib/encomendas/types';
import {
  calcularTotais,
  montarEncomenda,
  selecaoDaEncomenda,
  selecaoVazia,
  skuTotal,
  type Qmap,
  type SelecaoEncomenda,
} from '@/lib/encomendas/pricing';
import { fetchDeliveryFee } from '@/lib/delivery-fee';
import { valorRecebido } from '@/lib/encomendas/pagamento';

export type EncomendaBalcaoResult = {
  id: string;
  enc: Encomenda;
  pago: { valor: number; forma: string };
};

interface Props {
  db: any;
  /** Usuário logado no PDV (dono ou operador) — assina o documento. */
  user: any;
  ownerId: string;
  config: EncomendaConfig;
  caixaAberto: boolean;
  formasPagamento: { id: string; label: string; icon?: string }[];
  /** Quando vem preenchido, a tela EDITA esta encomenda em vez de criar uma. */
  encomenda?: (Encomenda & { id: string }) | null;
  onCancel: () => void;
  onSaved: (result: EncomendaBalcaoResult) => void | Promise<void>;
}

const gerarId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const mascaraTelefone = (valor: string) => {
  const raw = valor.replace(/\D/g, '').slice(0, 11);
  if (raw.length > 7) return `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
  if (raw.length > 2) return `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
  return raw;
};

/** Seção do formulário — mesma moldura branca do resto da Retaguarda. */
const Bloco = ({ icone: Icone, titulo, acao, children }: {
  icone: typeof User; titulo: string; acao?: React.ReactNode; children: React.ReactNode;
}) => (
  <section className="rounded-2xl border bg-white shadow-sm">
    <header className="flex items-center gap-2 border-b bg-gradient-to-r from-slate-50 to-white px-4 py-2.5">
      <Icone className="h-4 w-4 text-slate-500" />
      <h2 className="flex-1 text-sm font-bold text-slate-800">{titulo}</h2>
      {acao}
    </header>
    <div className="p-3">{children}</div>
  </section>
);

const Campo = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className={`space-y-1 ${className || ''}`}>
    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</Label>
    {children}
  </div>
);

/**
 * Linha de item vendido por quantidade (torta, docinho, especial). O balcão
 * digita direto — o stepper do cliente só atrasaria quem está atendendo.
 */
function LinhaItem({ item, qtd, onQtd }: { item: SkuOption; qtd: number; onQtd: (v: number) => void }) {
  const minimo = item.minQty || 0;
  const passo = item.stepQty || 1;
  const total = skuTotal(item, qtd);
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${qtd > 0 ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200'}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-700">{item.name}</p>
        <p className="text-[10px] text-slate-400">
          {typeof item.priceCento === 'number'
            ? `${brl(item.priceCento)} o cento${minimo ? ` · mín. ${minimo}` : ''}`
            : `${brl(item.price)} cada${minimo ? ` · mín. ${minimo}` : ''}`}
        </p>
      </div>
      <Input
        inputMode="numeric"
        value={qtd || ''}
        placeholder="0"
        onChange={(e) => onQtd(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))}
        className="h-8 w-20 text-center text-sm font-bold"
      />
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => onQtd(qtd === 0 ? Math.max(minimo, passo) : qtd + passo)}
          className="h-4 w-5 rounded bg-slate-100 text-[10px] font-bold leading-none text-slate-600 hover:bg-slate-200"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => onQtd(Math.max(0, qtd - passo) < minimo ? 0 : qtd - passo)}
          className="h-4 w-5 rounded bg-slate-100 text-[10px] font-bold leading-none text-slate-600 hover:bg-slate-200"
        >
          −
        </button>
      </div>
      <span className={`w-20 shrink-0 text-right text-xs font-bold tabular-nums ${qtd > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>
        {brl(total)}
      </span>
    </div>
  );
}

/** Lista de itens agrupada pelo `group` do catálogo. */
function GrupoItens({ lista, mapa, onMapa }: { lista: SkuOption[]; mapa: Qmap; onMapa: (m: Qmap) => void }) {
  const grupos = useMemo(() => {
    const out: { nome: string; itens: SkuOption[] }[] = [];
    for (const item of lista.filter((x) => x.enabled !== false)) {
      const nome = item.group || '';
      const bucket = out.find((g) => g.nome === nome);
      if (bucket) bucket.itens.push(item);
      else out.push({ nome, itens: [item] });
    }
    return out;
  }, [lista]);

  return (
    <div className="space-y-2.5">
      {grupos.map((g) => (
        <div key={g.nome} className="space-y-1.5">
          {g.nome && <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{g.nome}</p>}
          {g.itens.map((item) => (
            <LinhaItem
              key={item.id}
              item={item}
              qtd={mapa[item.id] || 0}
              onQtd={(v) => onMapa({ ...mapa, [item.id]: v })}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Nova encomenda tirada no balcão — tela da Retaguarda, não o formulário do
 * cliente. Tudo numa página só (cliente, itens, entrega, pagamento) porque
 * quem preenche está com a cliente na frente. O preço vem inteiro de
 * lib/encomendas/pricing, o mesmo que a página pública usa.
 */
export function EncomendaBalcaoPage({ db, user, ownerId, config, caixaAberto, formasPagamento, encomenda, onCancel, onSaved }: Props) {
  const { toast } = useToast();
  const cat = config.catalog;
  const porKg = (cat.cakes || []).length > 0;
  const editando = !!encomenda;

  const [nome, setNome] = useState(encomenda?.customerName || '');
  const [telefone, setTelefone] = useState(mascaraTelefone(encomenda?.customerPhone || ''));
  const [nascimento, setNascimento] = useState(encomenda?.customerBirthDate || '');

  const [sel, setSel] = useState<SelecaoEncomenda>(
    () => (encomenda ? selecaoDaEncomenda(cat, encomenda) : selecaoVazia()),
  );
  const [data, setData] = useState(encomenda?.delivery?.date || '');
  const [hora, setHora] = useState(encomenda?.delivery?.time || '');
  const [tipoEntrega, setTipoEntrega] = useState<'retirada' | 'delivery'>(
    encomenda?.delivery?.type === 'delivery' ? 'delivery' : 'retirada',
  );
  const [rua, setRua] = useState(encomenda?.delivery?.street || '');
  const [numero, setNumero] = useState(encomenda?.delivery?.number || '');
  const [complemento, setComplemento] = useState(encomenda?.delivery?.complement || '');
  const [bairro, setBairro] = useState(encomenda?.delivery?.neighborhood || '');
  const [cidade, setCidade] = useState(encomenda?.delivery?.city || config.city || '');
  const [taxa, setTaxa] = useState(encomenda?.deliveryFee ? String(encomenda.deliveryFee) : '');
  const [calculandoTaxa, setCalculandoTaxa] = useState(false);
  const [observacao, setObservacao] = useState(encomenda?.orderNotes || '');

  /**
   * Total gravado que a tela NÃO consegue reproduzir com o catálogo de hoje —
   * acontece quando um sabor/adicional foi renomeado ou apagado depois do
   * pedido. Salvar assim rebaixaria o valor no silêncio, então a tela avisa.
   */
  const [totalOriginalDivergente] = useState(() => {
    if (!encomenda) return 0;
    const inicial = calcularTotais(cat, selecaoDaEncomenda(cat, encomenda), {
      deliveryFee: encomenda.deliveryFee || 0,
      sinalPercent: config.sinalPercent,
    });
    return Math.abs(inicial.total - (encomenda.total || 0)) > 0.009 ? (encomenda.total || 0) : 0;
  });

  const [pagoOpcao, setPagoOpcao] = useState<'nada' | 'sinal' | 'total' | 'outro'>('sinal');
  const [pagoOutro, setPagoOutro] = useState('');
  const [pagoForma, setPagoForma] = useState(formasPagamento[0]?.id || 'dinheiro');
  const [salvando, setSalvando] = useState(false);

  const atualizarBolo = (patch: Partial<SelecaoEncomenda['bolo']>) =>
    setSel((s) => ({ ...s, bolo: { ...s.bolo, ...patch } }));

  const alternarProduto = (kind: ProductKind, ligado: boolean) =>
    setSel((s) => ({
      ...s,
      products: ligado ? Array.from(new Set([...s.products, kind])) : s.products.filter((k) => k !== kind),
    }));

  // Uma seção entra na encomenda assim que tem item escolhido — no balcão não
  // faz sentido perguntar "o que você quer?" antes de deixar escolher.
  const sincronizarSecao = (kind: ProductKind, mapa: Qmap) => {
    const temItem = Object.values(mapa).some((v) => v > 0);
    alternarProduto(kind, temItem);
  };

  const deliveryFee = tipoEntrega === 'delivery' ? Number((taxa || '').replace(',', '.')) || 0 : 0;
  const totais = useMemo(
    () => calcularTotais(cat, sel, { deliveryFee, sinalPercent: config.sinalPercent }),
    [cat, sel, deliveryFee, config.sinalPercent],
  );

  // Na edição não se recebe dinheiro: quem cobra é o botão "Receber" do card,
  // que sabe o saldo atualizado e passa pelo fechamento (com Prazo, split etc.).
  const pagoValor = editando || !caixaAberto ? 0
    : pagoOpcao === 'nada' ? 0
    : pagoOpcao === 'sinal' ? totais.sinal
    : pagoOpcao === 'total' ? totais.total
    : Math.max(0, Math.min(totais.total, Number((pagoOutro || '').replace(',', '.')) || 0));
  const faltaDepois = Math.max(0, totais.total - pagoValor);

  const telefoneOk = telefone.replace(/\D/g, '').length >= 10;
  const podeSalvar = !!nome.trim() && telefoneOk && totais.subtotal > 0 && !!data && !!hora
    && (tipoEntrega !== 'delivery' || (rua.trim().length >= 3 && !!bairro.trim()));

  // Antecedência mínima é regra da página pública; no balcão vira só um aviso —
  // a loja pode aceitar um prazo mais curto olhando na cara da cliente.
  const avisoData = (() => {
    if (!data) return '';
    if (data < hojeIso()) return 'Data no passado.';
    const minimo = new Date();
    minimo.setDate(minimo.getDate() + (config.minDays || 0));
    const minimoIso = `${minimo.getFullYear()}-${String(minimo.getMonth() + 1).padStart(2, '0')}-${String(minimo.getDate()).padStart(2, '0')}`;
    if (data < minimoIso) return `Menos que os ${config.minDays} dias de antecedência da loja — só confirme se der conta.`;
    return '';
  })();

  const calcularTaxa = async () => {
    const temRegras = (config.deliveryFeeRules?.length || 0) > 0 || (config.customAddressRules?.length || 0) > 0;
    if (!config.storeAddress || !temRegras || rua.trim().length < 3) {
      toast({ variant: 'destructive', title: 'Não dá para calcular', description: 'Informe a rua e tenha as taxas de entrega configuradas.' });
      return;
    }
    setCalculandoTaxa(true);
    try {
      const { ok, data: resposta } = await fetchDeliveryFee({
        storeAddress: config.storeAddress,
        customerAddress: [rua, numero, bairro, cidade, 'Brasil'].filter(Boolean).join(', '),
        feeRules: config.deliveryFeeRules,
        customAddressRules: config.customAddressRules,
        neighborhoodHint: bairro,
      });
      if (ok && typeof resposta.fee === 'number') {
        setTaxa(String(resposta.fee));
        toast({ title: `Taxa: ${brl(resposta.fee)}` });
      } else {
        toast({ variant: 'destructive', title: 'Endereço sem taxa', description: 'Digite o valor da entrega na mão.' });
      }
    } catch (err) {
      console.error('[encomendas] erro ao calcular taxa:', err);
      toast({ variant: 'destructive', title: 'Erro ao calcular a taxa' });
    } finally {
      setCalculandoTaxa(false);
    }
  };

  const salvar = async () => {
    if (!podeSalvar || salvando || !db || !user?.uid) return;
    setSalvando(true);
    try {
      const id = encomenda?.id || gerarId();
      // customerUid = quem está gravando: é o que as regras aceitam tanto do
      // dono quanto do operador (a página pública usa o uid anônimo do cliente).
      const enc = montarEncomenda({
        id,
        // Na edição o dono do documento não muda (o público criou com o uid
        // anônimo do cliente; reescrever isso tiraria a encomenda do app dele).
        customerUid: encomenda?.customerUid || user.uid,
        ownerId,
        cliente: { nome, telefone, nascimento },
        sel,
        totais,
        sinalPercent: config.sinalPercent,
        entrega: {
          date: data,
          time: hora,
          type: tipoEntrega,
          street: rua,
          number: numero,
          complement: complemento,
          neighborhood: bairro,
          city: cidade,
          feeStatus: deliveryFee > 0 ? 'calculada' : 'a_combinar',
        },
        status: encomenda?.status || 'confirmada',
        source: encomenda?.source || 'balcao',
        orderNotes: observacao,
        // Coisas que o cliente mandou e esta tela não edita: reescrever sem
        // elas apagaria o comprovante do PIX e os dados da plaquinha.
        comprovanteUrl: encomenda?.comprovanteUrl,
        plate: encomenda?.bolo?.plate,
        valorPago: encomenda ? valorRecebido(encomenda) : pagoValor,
        createdAt: encomenda?.createdAt ?? serverTimestamp(),
      });

      if (encomenda) {
        // Edição: reescreve o pedido, mas NÃO toca no que é histórico —
        // quando entrou, quanto já foi recebido e o comprovante do cliente.
        const { id: _id, customerUid: _uid, createdAt: _criado, orderDateTime: _quando, valorPago: _pago, ...conteudo } = enc as any;
        await updateDoc(doc(db, 'encomendas', id), conteudo);
      } else {
        await setDoc(doc(collection(db, 'encomendas'), id), {
          ...enc,
          // Só está "lançado" o que entrou agora; o resto o card cobra depois.
          sinalLancado: pagoValor > 0,
        });
      }
      await onSaved({ id, enc, pago: { valor: pagoValor, forma: pagoForma } });
    } catch (err: any) {
      console.error('[encomendas] erro ao salvar a encomenda do balcão:', err);
      toast({ variant: 'destructive', title: 'Não consegui salvar', description: err?.message || 'Tente de novo.' });
    } finally {
      setSalvando(false);
    }
  };

  const opcoesPagamento: { id: 'nada' | 'sinal' | 'total' | 'outro'; titulo: string; sub: string }[] = [
    { id: 'nada', titulo: 'Nada', sub: 'paga depois' },
    { id: 'sinal', titulo: brl(totais.sinal), sub: `entrada ${config.sinalPercent}%` },
    { id: 'total', titulo: brl(totais.total), sub: 'valor cheio' },
    { id: 'outro', titulo: 'Outro', sub: 'quanto ela deu' },
  ];

  return (
    <div className="flex h-full min-h-0 w-full max-w-[1400px] mx-auto flex-col gap-4 pt-4 pb-2">
      <header className="shrink-0 px-2">
        <button
          type="button"
          onClick={onCancel}
          className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para as encomendas
        </button>
        <h1 className="text-2xl font-black tracking-tight text-slate-800">
          {editando ? `Editar encomenda #${encomenda!.id.substring(0, 5)}` : 'Nova encomenda'}
        </h1>
        <p className="text-sm font-medium text-muted-foreground">
          {editando
            ? 'Pode incluir ou tirar itens — o total é recalculado e o que já foi pago continua valendo.'
            : 'Pedido tirado no balcão — os preços são os mesmos do link de encomendas.'}
        </p>
      </header>

      {totalOriginalDivergente > 0 && (
        <div className="mx-2 shrink-0 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <p className="font-bold">O catálogo mudou depois deste pedido.</p>
          <p>
            A encomenda foi fechada em <span className="font-bold">{brl(totalOriginalDivergente)}</span> e, com os produtos de hoje,
            a tela remonta <span className="font-bold">{brl(totais.total)}</span> — algum sabor ou adicional foi renomeado ou apagado.
            Confira o pedido antes de salvar; se salvar assim, vale o valor novo.
          </p>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 px-2 lg:grid-cols-[1fr_340px]">
        {/* Formulário */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto custom-scrollbar pb-1">
          <Bloco icone={User} titulo="Cliente">
            <div className="grid gap-2 sm:grid-cols-[1fr_180px_150px]">
              <Campo label="Nome *">
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome de quem encomendou" className="h-9 text-sm" />
              </Campo>
              <Campo label="Telefone *">
                <Input value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" className="h-9 text-sm" />
              </Campo>
              <Campo label="Nascimento">
                <Input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className="h-9 text-sm" />
              </Campo>
            </div>
          </Bloco>

          <Bloco
            icone={CakeSlice}
            titulo="Bolo"
            acao={sel.products.includes('bolo') ? (
              <button
                type="button"
                onClick={() => { alternarProduto('bolo', false); atualizarBolo({ flavorId: '', weightId: '', shape: '', dough: '', extraIds: [] }); }}
                className="text-[11px] font-bold text-slate-400 hover:text-rose-600"
              >
                Remover
              </button>
            ) : null}
          >
            {porKg ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-4">
                  <Campo label="Sabor">
                    <select
                      value={sel.bolo.flavorId || ''}
                      onChange={(e) => { atualizarBolo({ flavorId: e.target.value }); alternarProduto('bolo', !!e.target.value); }}
                      className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
                    >
                      <option value="">— sem bolo —</option>
                      {(cat.cakes || []).map((c) => (
                        <option key={c.id} value={c.id}>{c.name} · {brl(c.pricePerKg)}/kg</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Peso">
                    <select
                      value={sel.bolo.weightId || ''}
                      onChange={(e) => {
                        const peso = (cat.cakeWeights || []).find((w) => w.id === e.target.value);
                        const formatos = peso?.shapes || [];
                        atualizarBolo({ weightId: e.target.value, shape: formatos.length === 1 ? formatos[0] : '' });
                      }}
                      className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
                    >
                      <option value="">Escolha</option>
                      {(cat.cakeWeights || []).map((w) => (
                        <option key={w.id} value={w.id}>{w.label}</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Formato">
                    <select
                      value={sel.bolo.shape || ''}
                      onChange={(e) => atualizarBolo({ shape: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
                    >
                      <option value="">—</option>
                      {((cat.cakeWeights || []).find((w) => w.id === sel.bolo.weightId)?.shapes || []).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Massa">
                    <select
                      value={sel.bolo.dough || ''}
                      onChange={(e) => atualizarBolo({ dough: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
                    >
                      <option value="">—</option>
                      {(cat.cakeDoughs || []).map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </Campo>
                </div>

                {(cat.cakeExtras || []).length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Adicionais</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(cat.cakeExtras || []).map((extra) => {
                        const marcado = (sel.bolo.extraIds || []).includes(extra.id);
                        return (
                          <button
                            key={extra.id}
                            type="button"
                            onClick={() => atualizarBolo({
                              extraIds: marcado
                                ? (sel.bolo.extraIds || []).filter((id) => id !== extra.id)
                                : [...(sel.bolo.extraIds || []), extra.id],
                            })}
                            className={`rounded-full border-2 px-3 py-1 text-xs font-bold transition ${marcado ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                          >
                            {extra.name} · {brl(extra.price)}{extra.per === '2kg' ? '/2kg' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {totais.bolo.total > 0 && (
                  <p className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                    Bolo: <span className="text-emerald-700">{brl(totais.bolo.total)}</span>
                    {totais.bolo.weight?.packaging ? <span className="ml-1 font-medium text-slate-400">(embalagem inclusa)</span> : null}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Esta loja não tem bolos por quilo cadastrados. Configure em Retaguarda → Encomendas → Catálogo.
              </p>
            )}
          </Bloco>

          {[
            { kind: 'tortas' as ProductKind, lista: cat.tortas, mapa: sel.tortas, set: (m: Qmap) => setSel((s) => ({ ...s, tortas: m })) },
            { kind: 'docinhos' as ProductKind, lista: cat.docinhos, mapa: sel.docinhos, set: (m: Qmap) => setSel((s) => ({ ...s, docinhos: m })) },
            { kind: 'especial' as ProductKind, lista: cat.especialItems, mapa: sel.especial, set: (m: Qmap) => setSel((s) => ({ ...s, especial: m })) },
          ].filter((s) => (s.lista || []).some((x) => x.enabled !== false)).map((secao) => (
            <Bloco
              key={secao.kind}
              icone={CakeSlice}
              titulo={cat.products.find((p) => p.kind === secao.kind)?.title || secao.kind}
            >
              <GrupoItens
                lista={secao.lista}
                mapa={secao.mapa}
                onMapa={(m) => { secao.set(m); sincronizarSecao(secao.kind, m); }}
              />
            </Bloco>
          ))}

          <Bloco icone={CalendarDays} titulo="Retirada / entrega">
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-[160px_120px_1fr]">
                <Campo label="Data *">
                  <Input type="date" value={data} min={hojeIso()} onChange={(e) => setData(e.target.value)} className="h-9 text-sm" />
                </Campo>
                <Campo label="Hora *">
                  <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="h-9 text-sm" />
                </Campo>
                <Campo label="Forma">
                  <div className="flex h-9 rounded-md bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => setTipoEntrega('retirada')}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded text-xs font-bold transition ${tipoEntrega === 'retirada' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                    >
                      <Store className="h-3.5 w-3.5" /> Retirada
                    </button>
                    <button
                      type="button"
                      disabled={config.pickupOnly}
                      onClick={() => setTipoEntrega('delivery')}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded text-xs font-bold transition disabled:opacity-40 ${tipoEntrega === 'delivery' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                    >
                      <Bike className="h-3.5 w-3.5" /> Entrega
                    </button>
                  </div>
                </Campo>
              </div>

              {avisoData && <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700">{avisoData}</p>}

              {tipoEntrega === 'delivery' && (
                <div className="grid gap-2 border-t pt-2 sm:grid-cols-4">
                  <Campo label="Rua *" className="sm:col-span-2">
                    <Input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Rua / Avenida" className="h-9 text-sm" />
                  </Campo>
                  <Campo label="Número">
                    <Input value={numero} onChange={(e) => setNumero(e.target.value)} className="h-9 text-sm" />
                  </Campo>
                  <Campo label="Complemento">
                    <Input value={complemento} onChange={(e) => setComplemento(e.target.value)} className="h-9 text-sm" />
                  </Campo>
                  <Campo label="Bairro *">
                    <Input value={bairro} onChange={(e) => setBairro(e.target.value)} className="h-9 text-sm" />
                  </Campo>
                  <Campo label="Cidade">
                    <Input value={cidade} onChange={(e) => setCidade(e.target.value)} className="h-9 text-sm" />
                  </Campo>
                  <Campo label="Taxa (R$)">
                    <Input value={taxa} onChange={(e) => setTaxa(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0,00" className="h-9 text-sm" />
                  </Campo>
                  <div className="flex items-end">
                    <Button variant="outline" size="sm" onClick={calcularTaxa} disabled={calculandoTaxa} className="h-9 w-full text-xs">
                      {calculandoTaxa ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      Calcular pelo endereço
                    </Button>
                  </div>
                </div>
              )}

              <Campo label="Observação">
                <Textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={2}
                  placeholder="Decoração, recado da plaquinha, alergias..."
                  className="text-sm"
                />
              </Campo>
            </div>
          </Bloco>
        </div>

        {/* Resumo + pagamento */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto custom-scrollbar pb-1">
          <Bloco icone={Wallet} titulo="Resumo">
            <div className="space-y-1.5 text-xs">
              {totais.bolo.total > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 text-slate-600">
                    {totais.bolo.weight?.label} {totais.bolo.flavor?.name}
                    {totais.bolo.extras.length > 0 && (
                      <span className="block text-[10px] text-slate-400">{totais.bolo.extras.map((e) => e.name).join(' · ')}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-700">{brl(totais.bolo.total)}</span>
                </div>
              )}
              {[...totais.especialLines, ...totais.tortasLines, ...totais.docinhosLines].map((l) => (
                <div key={l.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate text-slate-600">{l.qty}× {l.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-700">{brl(l.total)}</span>
                </div>
              ))}
              {totais.subtotal === 0 && <p className="py-3 text-center text-slate-400">Nenhum item ainda.</p>}

              {totais.deliveryFee > 0 && (
                <div className="flex justify-between gap-2 border-t border-dashed pt-1.5 text-slate-500">
                  <span>Taxa de entrega</span>
                  <span className="tabular-nums">{brl(totais.deliveryFee)}</span>
                </div>
              )}
              <div className="flex items-end justify-between border-t pt-2">
                <span className="text-[13px] font-bold text-slate-800">Total</span>
                <span className="text-2xl font-black leading-none tabular-nums text-slate-900">{brl(totais.total)}</span>
              </div>
            </div>
          </Bloco>

          <Bloco icone={Wallet} titulo={editando ? 'Pagamento' : 'Pagamento agora'}>
            {editando ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Já pago</span>
                  <span className="font-bold tabular-nums text-emerald-700">{brl(valorRecebido(encomenda!))}</span>
                </div>
                <div className="flex justify-between border-t border-dashed pt-1.5">
                  <span className="text-slate-500">Falta com o novo total</span>
                  <span className="font-bold tabular-nums text-amber-600">
                    {brl(Math.max(0, totais.total - valorRecebido(encomenda!)))}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  O recebimento continua no botão <span className="font-semibold">Receber</span> do card, com o saldo já atualizado.
                </p>
              </div>
            ) : !caixaAberto ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                Caixa fechado — a encomenda é salva, mas nada entra no caixa agora. Abra o caixa e use o botão de receber no card dela.
              </p>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-1.5">
                  {opcoesPagamento.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setPagoOpcao(o.id)}
                      className={`rounded-xl border-2 px-2.5 py-2 text-left transition ${pagoOpcao === o.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      <p className="text-sm font-black leading-tight text-slate-800">{o.titulo}</p>
                      <p className="text-[10px] text-slate-500">{o.sub}</p>
                    </button>
                  ))}
                </div>

                {pagoOpcao === 'outro' && (
                  <Input
                    inputMode="decimal"
                    value={pagoOutro}
                    onChange={(e) => setPagoOutro(e.target.value.replace(/[^0-9.,]/g, ''))}
                    placeholder={`Valor recebido (até ${brl(totais.total)})`}
                    className="h-9 text-sm"
                  />
                )}

                {pagoValor > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {formasPagamento.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setPagoForma(f.id)}
                        className={`rounded-full border-2 px-2.5 py-1 text-[11px] font-bold transition ${pagoForma === f.id ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                      >
                        {f.icon ? `${f.icon} ` : ''}{f.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex justify-between border-t border-dashed pt-2 text-xs">
                  <span className="text-slate-500">Entra no caixa</span>
                  <span className="font-bold tabular-nums text-emerald-700">{brl(pagoValor)}</span>
                </div>
                {faltaDepois > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Falta <span className="font-bold text-slate-700">{brl(faltaDepois)}</span> — o sistema cobra na hora que você marcar como entregue.
                  </p>
                )}
              </div>
            )}
          </Bloco>

          <Button
            onClick={salvar}
            disabled={!podeSalvar || salvando}
            className="h-11 w-full bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"
          >
            {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editando ? 'Salvar alterações' : 'Salvar encomenda'}
          </Button>
          {!podeSalvar && (
            <p className="-mt-1 text-center text-[11px] text-slate-400">
              Falta preencher: {[
                !nome.trim() && 'nome',
                !telefoneOk && 'telefone',
                totais.subtotal === 0 && 'algum item',
                !data && 'data',
                !hora && 'hora',
                tipoEntrega === 'delivery' && (rua.trim().length < 3 || !bairro.trim()) && 'endereço',
              ].filter(Boolean).join(', ')}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
