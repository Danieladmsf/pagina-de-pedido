'use client';

import React, { useMemo, useState } from 'react';
import type { RegistrarLancamento } from '@/hooks/useCaixa';
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { CurrencyInput } from '@/components/ui/currency-input';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { brl, normalizeSearch } from '@/lib/utils';
import {
  dueDateFor,
  formatBrazilPhone,
  getPhoneVariants,
  creditPhonesAreEqual,
  isCreditEnabled,
  normalizeCreditPhone,
} from '@/lib/customer-credit';
import {
  buildItemsCsv,
  buildStatement,
  buildStatementCsv,
  exportFileName,
  missingOrderRefs,
  statementTotals,
  type CreditTransaction,
  type StatementRow,
} from '@/lib/prazo-statement';
import { encomendaComoPedido } from '@/lib/encomendas/pedido';
import { printExtratoPrazo } from '@/lib/prazo-receipt';
import { FiltroPeriodo } from '@/components/admin/FiltroPeriodo';
import { dentroDaJanela, janelaDoPeriodo, type PeriodoSelecionado } from '@/lib/periodo';
import { ContactAvatar } from '@/components/shared/ContactAvatar';
import { WhatsAppIcon } from '@/components/shared/WhatsAppIcon';
import { makeProfilePhotoLoader } from '@/lib/wapi/profile-photo';

interface PrazoPageProps {
  db: any;
  user: any;
  /** Documento do cliente (com id) — a página é montada por cliente. */
  cliente: any;
  onBack: () => void;
  onEditCliente?: (cliente: any) => void;
  registrarLancamento?: RegistrarLancamento;
  caixaAberto?: boolean;
  /** Dentro da Ficha do Cliente o cabeçalho (avatar, nome, voltar) já existe
   *  na casca — repetir daria dois títulos na mesma tela. Nada de lógica muda. */
  semCabecalho?: boolean;
}

type PeriodoId = '30' | '90' | 'ano' | 'tudo';
type TipoFiltro = 'todos' | 'compras' | 'pagamentos';

const PERIODOS: { id: PeriodoId; label: string; dias: number | null }[] = [
  { id: '30', label: '30 dias', dias: 30 },
  { id: '90', label: '90 dias', dias: 90 },
  { id: 'ano', label: '12 meses', dias: 365 },
  { id: 'tudo', label: 'Tudo', dias: null },
];

const FORMAS_RECEBIMENTO = [
  { id: 'pix', label: 'PIX' },
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'debito', label: 'Débito' },
  { id: 'credito', label: 'Crédito' },
];

const KpiCard = ({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'slate',
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint?: React.ReactNode;
  tone?: 'slate' | 'rose' | 'emerald' | 'indigo' | 'amber';
}) => {
  const tones: Record<string, string> = {
    slate: 'text-slate-700 bg-slate-100',
    rose: 'text-rose-600 bg-rose-100',
    emerald: 'text-emerald-600 bg-emerald-100',
    indigo: 'text-indigo-600 bg-indigo-100',
    amber: 'text-amber-600 bg-amber-100',
  };
  return (
    <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-black tabular-nums text-slate-800">{value}</p>
      {hint && <div className="mt-0.5 text-[11px] font-medium text-slate-500">{hint}</div>}
    </div>
  );
};

/**
 * Teto de uma faixa "o id começa com X" no Firestore: o último caractere
 * Unicode de uso comum. Escrito por código porque, solto no meio da linha,
 * ele é invisível no editor.
 */
const FIM_DA_FAIXA_DE_ID = String.fromCharCode(0xf8ff);

/**
 * Página do Prazo de um cliente (antes um modal de 420px que só listava o
 * extrato). Aqui o dono tem a conta inteira numa tela: saldo reconstruído pelo
 * extrato, filtros por período, recebimento, exportação e impressão.
 *
 * O saldo mostrado vem SEMPRE do extrato (lib/prazo-statement). O campo
 * `creditBalance` do cadastro é só um contador de leitura rápida — quando os
 * dois divergem a página avisa e oferece o acerto, em vez de escolher um
 * número em silêncio.
 */
export function PrazoPage({ db, user, cliente, onBack, onEditCliente, registrarLancamento, caixaAberto, semCabecalho = false }: PrazoPageProps) {
  const { toast } = useToast();
  const ownerId = user?.uid;

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendingWhats, setSendingWhats] = useState(false);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [estornandoId, setEstornandoId] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [periodo, setPeriodo] = useState<PeriodoSelecionado>({ preset: 'tudo' });
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos');

  // Configuração do prazo (mesmos campos da ficha do cliente, editáveis aqui).
  const [configOpen, setConfigOpen] = useState(false);
  const [configEnabled, setConfigEnabled] = useState(!!isCreditEnabled(cliente));
  const [configLimit, setConfigLimit] = useState(String(Number(cliente?.creditLimit) || 0));
  const [configPayDay, setConfigPayDay] = useState(cliente?.creditPayDay ? String(cliente.creditPayDay) : '');
  const [savingConfig, setSavingConfig] = useState(false);

  // Pedidos do cliente em duas levas: os que a busca por telefone trouxe e os
  // resgatados pelo id que o próprio extrato carrega (ver o efeito abaixo).
  const [ordersPorTelefone, setOrdersPorTelefone] = useState<any[]>([]);
  const [ordersPorId, setOrdersPorId] = useState<any[]>([]);
  const [encomendasDoCliente, setEncomendasDoCliente] = useState<any[]>([]);
  const [telefoneResolvido, setTelefoneResolvido] = useState(false);
  const pedidosBuscadosRef = React.useRef<Set<string>>(new Set());
  const clienteBuscadoRef = React.useRef<string | undefined>(cliente?.id);

  const loadPhoto = useMemo(() => makeProfilePhotoLoader(user, user.uid), [user]);
  const phoneDigits = normalizeCreditPhone(cliente?.celular || '');
  // O celular é a única chave entre esta conta, o pedido e o cadastro. Sem ele
  // o Prazo não pode nem ser ligado (ver handleSaveConfig).
  const semTelefone = phoneDigits.length < 10;

  // ─── Dados ───

  const transactionsQuery = useMemoFirebase(() => {
    if (!db || !cliente?.id) return null;
    return query(collection(db, 'clientes', cliente.id, 'credit_transactions'), orderBy('date', 'desc'));
  }, [db, cliente?.id]);
  const { data: transactionsRaw, isLoading: transactionsLoading } = useCollection<CreditTransaction>(transactionsQuery);
  const transactions = useMemo(() => (transactionsRaw || []) as CreditTransaction[], [transactionsRaw]);

  const storeProfileRef = useMemoFirebase(() => (db && ownerId ? doc(db, 'store_profiles', ownerId) : null), [db, ownerId]);
  const { data: storeProfile } = useDoc<any>(storeProfileRef);

  // Pedidos do cliente: `clienteId` é a fonte primária; telefone fica somente
  // como fallback para o histórico anterior à migração.
  React.useEffect(() => {
    pedidosBuscadosRef.current = new Set();
    clienteBuscadoRef.current = cliente?.id;
    setOrdersPorId([]);
    setTelefoneResolvido(false);
    if (!db || !ownerId || !cliente?.id) { setOrdersPorTelefone([]); setTelefoneResolvido(true); return; }
    let cancelled = false;
    (async () => {
      const byId = new Map<string, any>();
      try {
        const linkedSnap = await getDocs(query(
          collection(db, 'orders'),
          where('ownerId', '==', ownerId),
          where('clienteId', '==', cliente.id),
        ));
        linkedSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
      } catch (err) {
        console.error('[PrazoPage] Erro ao carregar pedidos por clienteId:', err);
      }

      try {
        const variants = getPhoneVariants(cliente.celular || '').slice(0, 30);
        if (variants.length > 0) {
          const legacySnap = await getDocs(query(
            collection(db, 'orders'),
            where('ownerId', '==', ownerId),
            where('customerPhone', 'in', variants),
          ));
          legacySnap.docs.forEach((d) => {
            const data: any = d.data() || {};
            // Um pedido já ligado a OUTRO cliente nunca volta a ser capturado
            // por um telefone antigo coincidente.
            if (
              (!data.clienteId || data.clienteId === cliente.id)
              && creditPhonesAreEqual(String(data.customerPhone || ''), cliente.celular || '')
            ) {
              byId.set(d.id, { id: d.id, ...data });
            }
          });
        }
      } catch (err) {
        console.error('[PrazoPage] Erro ao carregar pedidos legados por telefone:', err);
      } finally {
        if (!cancelled) {
          setOrdersPorTelefone([...byId.values()]);
          setTelefoneResolvido(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [db, ownerId, cliente?.id, cliente?.celular]);

  // Encomendas do cliente (só na confeitaria): a compra a prazo de uma encomenda
  // aponta para `encomendas`, não para `orders`, e sem isto ela apareceria no
  // extrato sem poder abrir. Entram na MESMA lista, lidas como pedido.
  const temEncomendas = storeProfile?.theme === 'confeitaria';
  React.useEffect(() => {
    if (!db || !ownerId || !temEncomendas || !cliente?.id) { setEncomendasDoCliente([]); return; }
    let cancelled = false;
    (async () => {
      const byId = new Map<string, any>();
      try {
        const linkedSnap = await getDocs(query(
          collection(db, 'encomendas'),
          where('ownerId', '==', ownerId),
          where('clienteId', '==', cliente.id),
        ));
        linkedSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
      } catch (err) {
        console.error('[PrazoPage] Erro ao carregar encomendas por clienteId:', err);
      }
      try {
        const variants = getPhoneVariants(cliente.celular || '').slice(0, 30);
        if (variants.length > 0) {
          const legacySnap = await getDocs(query(
            collection(db, 'encomendas'),
            where('ownerId', '==', ownerId),
            where('customerPhone', 'in', variants),
          ));
          legacySnap.docs.forEach((d) => {
            const data: any = d.data() || {};
            if (
              (!data.clienteId || data.clienteId === cliente.id)
              && creditPhonesAreEqual(String(data.customerPhone || ''), cliente.celular || '')
            ) {
              byId.set(d.id, { id: d.id, ...data });
            }
          });
        }
      } catch (err) {
        console.error('[PrazoPage] Erro ao carregar encomendas legadas por telefone:', err);
      } finally {
        if (!cancelled) setEncomendasDoCliente([...byId.values()]);
      }
    })();
    return () => { cancelled = true; };
  }, [db, ownerId, temEncomendas, cliente?.id, cliente?.celular]);

  const orders = useMemo(() => {
    const porId = new Map<string, any>();
    for (const pedido of [...ordersPorTelefone, ...ordersPorId]) {
      if (pedido?.id) porId.set(pedido.id, pedido);
    }
    for (const enc of encomendasDoCliente) {
      const comoPedido = encomendaComoPedido(enc);
      if (comoPedido) porId.set(comoPedido.id, comoPedido);
    }
    return [...porId.values()];
  }, [ordersPorTelefone, ordersPorId, encomendasDoCliente]);

  // Resgate pelo id do pedido: a busca por telefone só acha os formatos que ela
  // conhece, e o PDV grava o telefone como foi digitado ("(16)992156780"). Sem
  // isto, a compra fica sem pedido e não abre para mostrar o que foi vendido —
  // some da tela justamente a informação que o cliente veio conferir.
  //
  // Duas cautelas que parecem detalhe e não são (custaram um "não abre" em
  // produção): só roda DEPOIS que a busca por telefone terminou, para saber o
  // que de fato falta; e o resultado que chega não é descartado quando o efeito
  // reroda. Descartar era o bug — a marca de "já buscado" impedia a segunda
  // tentativa, e o pedido ficava perdido para sempre.
  React.useEffect(() => {
    if (!db || !ownerId || !telefoneResolvido || transactions.length === 0) return;

    const { ids, prefixes } = missingOrderRefs(transactions, orders);
    const idsNovos = ids.filter((id) => !pedidosBuscadosRef.current.has(id));
    const prefixosNovos = prefixes.filter((prefixo) => !pedidosBuscadosRef.current.has(`#${prefixo}`));
    if (idsNovos.length === 0 && prefixosNovos.length === 0) return;
    // Marca antes de buscar: pedido apagado nunca é encontrado, e sem a marca o
    // efeito voltaria a buscá-lo a cada render.
    idsNovos.forEach((id) => pedidosBuscadosRef.current.add(id));
    prefixosNovos.forEach((prefixo) => pedidosBuscadosRef.current.add(`#${prefixo}`));

    const clienteDaBusca = cliente?.id;
    (async () => {
      const encontrados: any[] = [];
      await Promise.all([
        ...idsNovos.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'orders', id));
            // Confere o dono: o id vem de um lançamento, não da query.
            if (snap.exists() && snap.data()?.ownerId === ownerId) {
              encontrados.push({ id: snap.id, ...snap.data() });
            }
          } catch (err) {
            console.error('[PrazoPage] Erro ao buscar pedido por id:', err);
          }
        }),
        ...prefixosNovos.map(async (prefixo) => {
          try {
            // Faixa de ids que começam com o prefixo — é assim que o Firestore
            // faz "começa com": do prefixo até ele mais o fim da faixa.
            const snap = await getDocs(query(
              collection(db, 'orders'),
              where('ownerId', '==', ownerId),
              where(documentId(), '>=', prefixo),
              where(documentId(), '<', prefixo + FIM_DA_FAIXA_DE_ID),
            ));
            snap.docs.forEach((d) => encontrados.push({ id: d.id, ...d.data() }));
          } catch (err) {
            console.error('[PrazoPage] Erro ao buscar pedido pelo prefixo do extrato:', err);
          }
        }),
      ]);
      // O que chegou continua valendo mesmo se o efeito ja rerodou; so nao vale
      // se a tela ja e de outro cliente (o pedido nao seria dele).
      if (encontrados.length > 0 && clienteBuscadoRef.current === clienteDaBusca) {
        setOrdersPorId((anteriores) => [...anteriores, ...encontrados]);
      }
    })();
  }, [db, ownerId, telefoneResolvido, transactions, orders, cliente?.id]);

  // ─── Extrato + totais ───

  const allRows = useMemo(() => buildStatement(transactions, orders), [transactions, orders]);
  const totals = useMemo(() => statementTotals(allRows), [allRows]);

  const saldo = totals.balance;
  const limite = Number(cliente?.creditLimit) || 0;
  const payDay = Number(cliente?.creditPayDay) || 0;
  const disponivel = limite > 0 ? Math.max(0, limite - saldo) : 0;
  const prazoAtivo = isCreditEnabled(cliente);
  const primeiroNome = (cliente?.nome || 'cliente').trim().split(' ')[0] || 'cliente';

  // Saldo negativo NÃO é dívida: é dinheiro a favor do cliente (pagamento
  // lançado duas vezes ou acima da conta). Enquanto isso aparecia como
  // "Saldo devedor -R$ 24,00", o dono lançava de novo o número que estava na
  // tela e a conta afundava (-24, -48, -96). Aqui os dois lados ficam com
  // nome, cor e texto diferentes.
  const creditoAFavor = saldo < -0.009 ? -saldo : 0;

  // Saldo do cadastro x saldo do extrato: divergência é sinal de gravação pela
  // metade (o débito entrou e o increment falhou, ou o contrário).
  const saldoCadastro = Number(cliente?.creditBalance) || 0;
  const divergencia = Math.abs(saldoCadastro - saldo) > 0.009;

  const vencimento = useMemo(() => {
    if (!totals.debtSince || payDay <= 0) return null;
    const due = dueDateFor(totals.debtSince, payDay);
    const vencida = new Date() > due;
    const dias = Math.round((due.getTime() - Date.now()) / 86400000);
    return {
      due,
      vencida,
      texto: vencida
        ? `Vencida em ${due.toLocaleDateString('pt-BR')}`
        : `Vence em ${due.toLocaleDateString('pt-BR')}${dias >= 0 ? ` (${dias === 0 ? 'hoje' : `${dias} dia${dias > 1 ? 's' : ''}`})` : ''}`,
    };
  }, [totals.debtSince, payDay]);

  // Filtros da lista (a linha guarda o saldo do momento, então filtrar não
  // reescreve o histórico — some da tela, não da conta).
  const filteredRows = useMemo(() => {
    const janela = janelaDoPeriodo(periodo);
    const term = normalizeSearch(searchTerm.trim());

    return allRows.filter(({ tx, order }) => {
      if (tipoFiltro === 'compras' && tx.type !== 'debit') return false;
      if (tipoFiltro === 'pagamentos' && tx.type !== 'credit') return false;
      if (!dentroDaJanela(tx.date, janela)) return false;
      if (term) {
        const itens = (order?.items || []).map((item: any) => item?.name).join(' ');
        if (!normalizeSearch(`${tx.description || ''} ${itens}`).includes(term)) return false;
      }
      return true;
    });
  }, [allRows, periodo, tipoFiltro, searchTerm]);

  // Na tela o mais recente vem primeiro; no arquivo/cupom, ordem cronológica.
  const visibleRows = useMemo(() => [...filteredRows].reverse(), [filteredRows]);
  const filtrosAtivos = periodo.preset !== 'tudo' || tipoFiltro !== 'todos' || !!searchTerm.trim();
  const totaisFiltro = useMemo(() => {
    return filteredRows.reduce(
      (acc, { tx }) => {
        const amount = Number(tx.amount) || 0;
        if (tx.type === 'debit') acc.compras += amount;
        else acc.pagamentos += amount;
        return acc;
      },
      { compras: 0, pagamentos: 0 },
    );
  }, [filteredRows]);

  // ─── Ações ───

  const handleReceivePayment = async () => {
    const amount = Number(paymentAmount.replace(',', '.'));
    if (!db || !cliente?.id) return;
    if (Number.isNaN(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Valor inválido' });
      return;
    }
    if (caixaAberto === false) {
      toast({ variant: 'destructive', title: 'Caixa fechado', description: 'Abra o caixa para registrar o recebimento.' });
      return;
    }
    if (!registrarLancamento) {
      toast({
        variant: 'destructive',
        title: 'Caixa indisponível',
        description: 'Não foi possível preparar o lançamento conjunto. Nenhuma baixa foi feita.',
      });
      return;
    }

    // Conta sem dívida não aceita baixa. Sem esta trava, cada nova baixa virava
    // crédito a favor do cliente — foi assim que uma dívida de R$ 24 já paga
    // acumulou R$ 96 de pagamentos e R$ 96 de PIX que nunca entrou no caixa.
    if (saldo <= 0.009) {
      toast({
        variant: 'destructive',
        title: 'Não há dívida para abater',
        description: creditoAFavor > 0
          ? `A conta de ${primeiroNome} está quitada e ainda sobram ${brl(creditoAFavor)} a favor dela. Lançar pagamento agora só aumentaria esse crédito.`
          : `A conta de ${primeiroNome} já está quitada.`,
      });
      return;
    }

    // Mesmo valor recebido há poucos minutos é quase sempre a mesma baixa
    // lançada de novo, porque a primeira "não pareceu" ter funcionado.
    const repetido = transactions.find((tx) => tx.type === 'credit'
      && Math.abs((Number(tx.amount) || 0) - amount) < 0.009
      && Date.now() - Date.parse(tx.date || '') < 15 * 60 * 1000);
    if (repetido) {
      const hora = new Date(repetido.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      if (!confirm(`Você já recebeu ${brl(amount)} de ${primeiroNome} hoje às ${hora}.\n\nLançar de novo soma os dois pagamentos na conta dela. Continuar?`)) return;
    }

    // Receber mais do que a dívida pode ser adiantamento, mas nunca em silêncio.
    if (amount > saldo + 0.009) {
      const sobra = amount - saldo;
      if (!confirm(`${primeiroNome} deve ${brl(saldo)} e você está lançando ${brl(amount)}.\n\nVão sobrar ${brl(sobra)} de crédito a favor dela, que viram desconto nas próximas compras.\n\nLançar assim mesmo?`)) return;
    }

    setIsSubmitting(true);
    try {
      const forma = FORMAS_RECEBIMENTO.find((f) => f.id === paymentMethod)?.label || paymentMethod;
      const creditRef = doc(collection(db, 'clientes', cliente.id, 'credit_transactions'));
      const batch = writeBatch(db);
      batch.set(creditRef, {
        id: creditRef.id,
        type: 'credit',
        amount,
        date: new Date().toISOString(),
        description: `Pagamento recebido (${forma})`,
        paymentMethod,
        channel: 'acerto',
      });
      batch.update(doc(db, 'clientes', cliente.id), { creditBalance: increment(-amount) });
      await registrarLancamento({
        tipo: 'venda',
        titulo: `Acerto de Prazo - ${cliente.nome || 'Cliente'}`,
        valor: amount,
        formaPagamento: paymentMethod,
        clienteId: cliente.id,
        creditTxId: creditRef.id,
      }, {
        batch,
        transactionId: `prazo_${cliente.id}_${creditRef.id}`,
      });
      // Crédito, contador do cliente e linha do caixa confirmam juntos. Se o
      // commit falhar, nada entra e uma nova tentativa não duplica pagamento.
      await batch.commit();

      toast({ title: 'Pagamento registrado!', description: `${brl(amount)} baixado da conta de ${cliente.nome || 'cliente'}.` });
      setPaymentAmount('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Estorno de um lançamento: entra um contra-lançamento com a mesma data de
   * hoje em vez de apagar a linha original. Venda cancelada no caixa NÃO volta
   * sozinha aqui, e apagar o histórico esconderia o motivo da conta ter mudado.
   */
  const handleEstornar = async (row: StatementRow) => {
    const { tx } = row;
    const amount = Number(tx.amount) || 0;
    if (!db || !cliente?.id || amount <= 0) return;
    const isDebit = tx.type === 'debit';
    const label = isDebit ? 'compra' : 'pagamento';
    if (!confirm(`Estornar ${label} de ${brl(amount)}?\n\nEntra um lançamento contrário no extrato (a linha original continua lá).`)) return;

    setEstornandoId(tx.id);
    try {
      const transRef = doc(collection(db, 'clientes', cliente.id, 'credit_transactions'));
      const batch = writeBatch(db);
      batch.set(transRef, {
        id: transRef.id,
        type: isDebit ? 'credit' : 'debit',
        amount,
        date: new Date().toISOString(),
        description: `Estorno - ${tx.description || (isDebit ? 'Compra' : 'Pagamento')}`,
        channel: 'estorno',
        reversalOf: tx.id,
      });
      batch.update(doc(db, 'clientes', cliente.id), {
        creditBalance: increment(isDebit ? -amount : amount),
      });
      await batch.commit();
      toast({ title: 'Estorno lançado', description: `${brl(amount)} ${isDebit ? 'retirados da' : 'devolvidos à'} conta.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setEstornandoId(null);
    }
  };

  /** Acerta o contador do cadastro pelo extrato (o extrato é a fonte). */
  const handleCorrigirSaldo = async () => {
    if (!db || !cliente?.id) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'clientes', cliente.id), { creditBalance: saldo });
      toast({ title: 'Saldo corrigido', description: `Cadastro atualizado para ${brl(saldo)} (valor do extrato).` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!db || !cliente?.id) return;
    // Aqui era possível ligar o Prazo de um cadastro sem celular (o formulário
    // de Clientes já exige o número). Prazo ativo sem telefone é conta órfã: a
    // venda a prazo procura o cliente pelo número, não acha, abre o cadastro
    // rápido e a dívida vai para uma segunda ficha.
    if (configEnabled && phoneDigits.length < 10) {
      toast({
        variant: 'destructive',
        title: 'Falta o celular deste cliente',
        description: 'Sem o número a venda a prazo não encontra este cadastro e a dívida acaba em outro cliente. Adicione o celular em "Cadastro" e ative o Prazo depois.',
      });
      return;
    }
    setSavingConfig(true);
    try {
      await setDoc(doc(db, 'clientes', cliente.id), {
        creditEnabled: configEnabled,
        creditLimit: Number(configLimit) || 0,
        creditPayDay: Number(configPayDay) || 0,
      }, { merge: true });
      toast({ title: 'Prazo atualizado!' });
      setConfigOpen(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro', description: err.message });
    } finally {
      setSavingConfig(false);
    }
  };

  const baixarArquivo = (conteudo: string, nome: string) => {
    const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportCustomer = { nome: cliente?.nome, celular: formatBrazilPhone(phoneDigits) || cliente?.celular };

  const handleExportExtrato = () => {
    if (filteredRows.length === 0) {
      toast({ variant: 'destructive', title: 'Nada para exportar', description: 'Nenhum lançamento no filtro atual.' });
      return;
    }
    baixarArquivo(buildStatementCsv(filteredRows, exportCustomer), exportFileName('extrato-prazo', cliente?.nome));
    toast({ title: 'Extrato exportado', description: `${filteredRows.length} lançamento(s) na planilha.` });
  };

  const handleExportItens = () => {
    const comPedido = filteredRows.filter((row) => row.tx.type === 'debit' && row.order);
    if (comPedido.length === 0) {
      toast({ variant: 'destructive', title: 'Nada para exportar', description: 'Nenhuma compra com pedido vinculado no filtro atual.' });
      return;
    }
    baixarArquivo(buildItemsCsv(filteredRows, exportCustomer), exportFileName('itens-prazo', cliente?.nome));
    toast({ title: 'Itens exportados', description: `${comPedido.length} compra(s) detalhada(s).` });
  };

  const handlePrint = () => {
    printExtratoPrazo({
      storeInfo: storeProfile,
      cliente: exportCustomer,
      rows: filteredRows,
      saldo,
      vencimento: vencimento?.texto,
      periodo: janelaDoPeriodo(periodo).rotulo,
      pixKey: storeProfile?.creditPixKey || '',
      pixName: storeProfile?.creditPixName || '',
    });
  };

  const handleSendWhatsApp = async () => {
    if (!user) return;
    if (phoneDigits.length < 10) {
      toast({ variant: 'destructive', title: 'Telefone inválido', description: 'Cliente sem telefone válido para enviar no WhatsApp.' });
      return;
    }
    const SEP = '━━━━━━━━━━━━━━';
    const blocos = [...filteredRows].reverse().map(({ tx, order }) => {
      const data = new Date(tx.date).toLocaleDateString('pt-BR');
      if (tx.type !== 'debit') {
        return `${SEP}\n✅ ${data} · ${tx.description || 'Pagamento recebido'}\n− ${brl(tx.amount)}`;
      }
      const itens = (order?.items || []).map((item: any) => {
        const addons = (item.addons?.length > 0) ? ` (${item.addons.map((a: any) => a.name).join(', ')})` : '';
        return `${item.quantity}x ${item.name}${addons}`;
      });
      let bloco = `${SEP}\n🛒 ${data} · ${tx.description || 'Compra'}`;
      if (itens.length > 0) bloco += `\n${itens.join('\n')}`;
      bloco += `\nSubtotal: ${brl(tx.amount)}`;
      return bloco;
    });

    let msg = '🧾 *EXTRATO DA SUA CONTA*\n';
    if (cliente?.nome) msg += `\n👤 *${cliente.nome}*\n`;
    if (blocos.length > 0) msg += `\n${blocos.join('\n')}\n${SEP}\n`;
    // Conta quitada (ou com crédito sobrando) não pede pagamento nem manda PIX.
    if (creditoAFavor > 0) {
      msg += `\n✅ *CONTA QUITADA*\n💚 Crédito a favor: *${brl(creditoAFavor)}* — vira desconto na próxima compra`;
    } else if (saldo <= 0.009) {
      msg += '\n✅ *CONTA QUITADA* — nada a pagar 🙌';
    } else {
      msg += `\n💰 *SALDO DEVEDOR: ${brl(saldo)}*`;
      if (vencimento) msg += `\n🗓️ ${vencimento.texto}`;
      const pixKey = storeProfile?.creditPixKey || '';
      const pixName = storeProfile?.creditPixName || '';
      if (pixKey || pixName) {
        msg += '\n\n📲 *Pague via PIX*';
        if (pixKey) msg += `\n🔑 ${pixKey}`;
        if (pixName) msg += `\n🏦 ${pixName}`;
      }
      msg += '\n\nEnvie o comprovante por aqui após o pagamento 🙏';
    }

    setSendingWhats(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/wapi/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ empresaId: ownerId, phone: phoneDigits, message: msg, type: 'credit_statement' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) throw new Error(data?.error || 'A integração do WhatsApp recusou o envio.');
      toast({ title: 'Extrato enviado no WhatsApp!' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Não foi possível enviar', description: err?.message || 'Falha ao enviar pelo WhatsApp.' });
    } finally {
      setSendingWhats(false);
    }
  };

  // ─── Render ───

  const iniciais = (cliente?.nome || '?').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const endereco = [cliente?.bairro, cliente?.cidade].filter(Boolean).join(' - ');

  return (
    <div className="flex h-full min-h-0 w-full max-w-[1400px] mx-auto flex-col gap-4 pt-4 pb-2">
      {/* Cabeçalho */}
      {!semCabecalho && <header className="shrink-0 px-2">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para clientes
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <ContactAvatar
            phone={cliente?.celular || ''}
            initials={iniciais}
            loadPhoto={loadPhoto}
            className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-black tracking-tight text-slate-800">{cliente?.nome || 'Cliente'}</h1>
              <Badge
                variant="secondary"
                className={prazoAtivo
                  ? 'border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700'
                  : 'border-slate-200 bg-slate-100 text-[10px] text-slate-500'}
              >
                {prazoAtivo ? 'Prazo ativo' : 'Prazo desativado'}
              </Badge>
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {formatBrazilPhone(phoneDigits) || cliente?.celular || 'Sem telefone'}
              {endereco ? ` · ${endereco}` : ''}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendWhatsApp}
              disabled={sendingWhats}
              className="h-8 gap-1.5 border-[#25D366]/40 text-xs font-bold text-[#128C4A] hover:bg-[#25D366]/10"
            >
              {sendingWhats ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WhatsAppIcon className="h-3.5 w-3.5" />}
              {sendingWhats ? 'Enviando…' : 'Enviar extrato'}
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} className="h-8 gap-1.5 text-xs font-bold">
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExtrato} className="h-8 gap-1.5 text-xs font-bold border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              <Download className="h-3.5 w-3.5" /> Extrato (CSV)
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportItens} className="h-8 gap-1.5 text-xs font-bold border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              <Download className="h-3.5 w-3.5" /> Itens (CSV)
            </Button>
            {onEditCliente && (
              <Button variant="ghost" size="sm" onClick={() => onEditCliente(cliente)} className="h-8 gap-1.5 text-xs font-bold text-amber-600 hover:bg-amber-50">
                <Pencil className="h-3.5 w-3.5" /> Cadastro
              </Button>
            )}
          </div>
        </div>
      </header>}

      {/* Indicadores */}
      <div className="grid shrink-0 grid-cols-2 gap-3 px-2 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          icon={Wallet}
          tone={saldo > 0.009 ? 'rose' : 'emerald'}
          label={creditoAFavor > 0 ? 'Crédito a favor' : 'Saldo devedor'}
          value={brl(creditoAFavor > 0 ? creditoAFavor : saldo)}
          hint={creditoAFavor > 0
            ? <span className="font-bold text-emerald-700">A loja deve este valor a ela</span>
            : (vencimento
              ? <span className={vencimento.vencida ? 'font-bold text-rose-600' : 'text-amber-600'}>{vencimento.texto}</span>
              : (saldo > 0.009 ? 'Sem dia de pagamento definido' : 'Conta quitada'))}
        />
        <KpiCard
          icon={TrendingUp}
          tone="indigo"
          label="Limite"
          value={limite > 0 ? brl(limite) : 'Sem limite'}
          hint={limite > 0 ? `Disponível ${brl(disponivel)}` : 'Compras a prazo sem teto'}
        />
        <KpiCard
          icon={ShoppingBag}
          tone="slate"
          label="Total comprado"
          value={brl(totals.totalPurchases)}
          hint={`${totals.purchaseCount} compra${totals.purchaseCount === 1 ? '' : 's'} · ticket ${brl(totals.averageTicket)}`}
        />
        <KpiCard
          icon={TrendingDown}
          tone="emerald"
          label="Total pago"
          value={brl(totals.totalPaid)}
          hint={totals.lastPaymentAt ? `Último em ${totals.lastPaymentAt.toLocaleDateString('pt-BR')}` : 'Nenhum pagamento ainda'}
        />
        <KpiCard
          icon={CalendarDays}
          tone="amber"
          label="Devendo desde"
          value={totals.debtSince ? totals.debtSince.toLocaleDateString('pt-BR') : '—'}
          hint={totals.lastPurchaseAt ? `Última compra em ${totals.lastPurchaseAt.toLocaleDateString('pt-BR')}` : 'Sem compras a prazo'}
        />
      </div>

      {creditoAFavor > 0 && (
        <div className="mx-2 shrink-0 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
          <p className="font-bold">Conta quitada, com {brl(creditoAFavor)} sobrando a favor de {primeiroNome}.</p>
          <p className="text-emerald-800">
            Acontece quando um pagamento é lançado duas vezes ou acima da dívida. Esse valor vai virar
            desconto na próxima compra a prazo. Se foi engano, use o estorno (↺) na linha do pagamento
            errado — o lançamento original continua no extrato.
          </p>
        </div>
      )}

      {divergencia && (
        <div className="mx-2 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
          <div className="min-w-0 flex-1 text-xs text-amber-900">
            <p className="font-bold">O saldo guardado no cadastro não bate com o extrato.</p>
            <p className="text-amber-800">
              Cadastro: <span className="font-bold">{brl(saldoCadastro)}</span> · Extrato (vale este):{' '}
              <span className="font-bold">{brl(saldo)}</span>. Costuma acontecer quando uma gravação foi interrompida no meio.
            </p>
          </div>
          <Button size="sm" onClick={handleCorrigirSaldo} disabled={isSubmitting} className="h-8 bg-amber-600 text-xs font-bold text-white hover:bg-amber-700">
            Acertar cadastro pelo extrato
          </Button>
        </div>
      )}

      {/* Corpo: ações à esquerda, extrato à direita */}
      <div className="grid min-h-0 flex-1 gap-4 px-2 lg:grid-cols-[320px_1fr]">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto custom-scrollbar pb-1">
          {/* Receber pagamento */}
          <section className="rounded-2xl border bg-white shadow-sm">
            <header className="flex items-center gap-2 border-b bg-gradient-to-r from-emerald-50 to-white px-4 py-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <h2 className="text-sm font-bold text-slate-800">Receber pagamento</h2>
            </header>
            <div className="space-y-2.5 p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor</Label>
                  <CurrencyInput
                    className="h-9 bg-white text-sm font-bold"
                    placeholder="0,00"
                    value={Number(paymentAmount.replace(',', '.')) || 0}
                    onChange={(val) => setPaymentAmount(val.toString())}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Forma</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    {FORMAS_RECEBIMENTO.map((forma) => (
                      <option key={forma.id} value={forma.id}>{forma.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {saldo > 0.009 && (
                <button
                  type="button"
                  onClick={() => setPaymentAmount(saldo.toFixed(2))}
                  className="w-full rounded-lg border border-dashed border-emerald-300 py-1.5 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
                >
                  Quitar tudo — {brl(saldo)}
                </button>
              )}

              <Button
                className="h-9 w-full bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
                onClick={handleReceivePayment}
                disabled={isSubmitting || !paymentAmount}
              >
                {isSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                Dar baixa
              </Button>

              {caixaAberto === false && (
                <p className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-600">
                  Caixa fechado — abra o caixa para registrar o recebimento.
                </p>
              )}
            </div>
          </section>

          {/* Configuração do prazo */}
          <section className="rounded-2xl border bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setConfigOpen((v) => !v)}
              className="flex w-full items-center gap-2 border-b px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              <Receipt className="h-4 w-4 text-indigo-600" />
              <h2 className="flex-1 text-sm font-bold text-slate-800">Condições do prazo</h2>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${configOpen ? 'rotate-180' : ''}`} />
            </button>
            {!configOpen ? (
              <div className="space-y-1 px-4 py-2.5 text-xs text-slate-600">
                <p>Limite: <span className="font-bold text-slate-800">{limite > 0 ? brl(limite) : 'sem limite'}</span></p>
                <p>Dia de pagamento: <span className="font-bold text-slate-800">{payDay > 0 ? `dia ${payDay}` : 'não definido'}</span></p>
              </div>
            ) : (
              <div className="space-y-3 p-3">
                <div className="flex items-center justify-between gap-3 rounded-lg bg-indigo-50/60 px-3 py-2">
                  <div>
                    <Label htmlFor="prazo-ativo" className="cursor-pointer text-xs font-bold text-indigo-900">Prazo ativo</Label>
                    <p className="text-[10px] leading-tight text-indigo-700/80">
                      {semTelefone
                        ? 'Cadastre o celular deste cliente para liberar o Prazo.'
                        : 'Permite fechar vendas a prazo para este cliente.'}
                    </p>
                  </div>
                  <Switch
                    id="prazo-ativo"
                    checked={!semTelefone && configEnabled}
                    onCheckedChange={setConfigEnabled}
                    disabled={semTelefone}
                    title={semTelefone ? 'Cadastre o celular do cliente para liberar o Prazo' : undefined}
                    className="scale-90 data-[state=checked]:bg-indigo-600 disabled:opacity-40"
                  />
                </div>
                {semTelefone && (
                  <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] font-medium leading-snug text-amber-800">
                    Sem celular a venda a prazo não acha este cadastro: o PDV abre um cadastro novo e a
                    dívida vai para lá, separada deste histórico. Use <span className="font-bold">Cadastro</span> no
                    topo da tela para incluir o número.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Limite (R$)</Label>
                    <CurrencyInput
                      value={Number(configLimit) || 0}
                      onChange={(val) => setConfigLimit(val.toString())}
                      placeholder="0,00"
                      className="h-8 bg-white text-xs"
                    />
                    <p className="text-[9px] text-slate-400">0 = sem limite</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Dia de pagamento</Label>
                    <Input
                      value={configPayDay}
                      onChange={(e) => setConfigPayDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                      placeholder="Ex: 10"
                      className="h-8 bg-white text-xs"
                    />
                    <p className="text-[9px] text-slate-400">Bloqueia após vencer</p>
                  </div>
                </div>
                <Button size="sm" onClick={handleSaveConfig} disabled={savingConfig} className="h-8 w-full bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700">
                  {savingConfig ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                  Salvar condições
                </Button>
              </div>
            )}
          </section>
        </div>

        {/* Extrato */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-white shadow-sm">
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-gradient-to-r from-slate-50 to-white px-4 py-2.5">
            <Receipt className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-800">Extrato</h2>
            <div className="relative ml-2 min-w-[160px] flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar lançamento ou item..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
            <div className="flex rounded-lg bg-slate-100 p-0.5">
              {([['todos', 'Todos'], ['compras', 'Compras'], ['pagamentos', 'Pagamentos']] as [TipoFiltro, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTipoFiltro(id)}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${tipoFiltro === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {filtrosAtivos && (
              <button
                type="button"
                onClick={() => { setSearchTerm(''); setPeriodo({ preset: 'tudo' }); setTipoFiltro('todos'); }}
                className="flex items-center gap-1 text-[11px] font-bold text-slate-400 transition-colors hover:text-rose-600"
              >
                <X className="h-3 w-3" /> Limpar
              </button>
            )}
          </header>

          {/* Resumo do que está filtrado */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-slate-50/70 px-4 py-1.5 text-[11px] font-medium text-slate-500">
            <span>{filteredRows.length} lançamento{filteredRows.length === 1 ? '' : 's'}</span>
            <span>Compras <span className="font-bold text-rose-600 tabular-nums">{brl(totaisFiltro.compras)}</span></span>
            <span>Pagamentos <span className="font-bold text-emerald-600 tabular-nums">{brl(totaisFiltro.pagamentos)}</span></span>
            {filtrosAtivos && <span className="text-slate-400">(o saldo de cada linha é sempre o da conta inteira)</span>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            {transactionsLoading && transactions.length === 0 ? (
              <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
            ) : visibleRows.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm text-slate-400">
                {allRows.length === 0 ? 'Nenhuma compra a prazo neste cliente ainda.' : 'Nenhum lançamento no filtro atual.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2 text-left">Data</th>
                    <th className="px-2 py-2 text-left">Lançamento</th>
                    <th className="px-2 py-2 text-right">Compra</th>
                    <th className="px-2 py-2 text-right">Pagamento</th>
                    <th className="px-2 py-2 text-right">Saldo</th>
                    <th className="px-4 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleRows.map(({ tx, order, balanceAfter }) => {
                    const isDebit = tx.type === 'debit';
                    const canExpand = !!(order && (order.items || []).length > 0);
                    const isExpanded = expandedTxId === tx.id;
                    const data = new Date(tx.date);
                    return (
                      <React.Fragment key={tx.id}>
                        <tr
                          className={`transition-colors hover:bg-slate-50/70 ${canExpand ? 'cursor-pointer' : ''}`}
                          onClick={canExpand ? () => setExpandedTxId(isExpanded ? null : tx.id) : undefined}
                        >
                          <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                            {Number.isNaN(data.getTime()) ? '-' : (
                              <>
                                <span className="font-semibold text-slate-700">{data.toLocaleDateString('pt-BR')}</span>
                                <span className="ml-1 text-slate-400">{data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                              </>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              {canExpand && <ChevronDown className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                              <span className="text-xs font-semibold text-slate-700">
                                {tx.description || (isDebit ? 'Compra' : 'Pagamento')}
                              </span>
                              {!isDebit && tx.paymentMethod && (
                                <Badge variant="outline" className="h-4 px-1 text-[9px] font-bold uppercase text-slate-500">{tx.paymentMethod}</Badge>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-bold tabular-nums text-rose-600">
                            {isDebit ? brl(tx.amount) : ''}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-bold tabular-nums text-emerald-600">
                            {isDebit ? '' : brl(tx.amount)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-bold tabular-nums text-slate-700">
                            {brl(balanceAfter)}
                          </td>
                          <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-slate-400 hover:text-rose-600"
                              title="Estornar lançamento"
                              disabled={estornandoId === tx.id}
                              onClick={() => handleEstornar({ tx, order, balanceAfter })}
                            >
                              {estornandoId === tx.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RotateCcw className="h-3.5 w-3.5" />}
                            </Button>
                          </td>
                        </tr>
                        {isExpanded && order && (
                          <tr className="bg-slate-50/70">
                            <td />
                            <td colSpan={5} className="px-2 pb-3">
                              <div className="space-y-0.5 rounded-lg border bg-white px-3 py-2">
                                {(order.items || []).map((item: any, i: number) => (
                                  <div key={i} className="flex justify-between gap-3 text-[11px] text-slate-600">
                                    <span className="min-w-0">
                                      {item.quantity}x {item.name}
                                      {(item.addons?.length > 0) ? ` (${item.addons.map((a: any) => a.name).join(', ')})` : ''}
                                    </span>
                                    <span className="shrink-0 tabular-nums text-slate-400">
                                      {brl(((item.unitPrice ?? item.price) || 0) * (item.quantity || 1))}
                                    </span>
                                  </div>
                                ))}
                                {order.deliveryFee > 0 && order.payDeliveryToMotoboy !== true && (
                                  <div className="mt-0.5 flex justify-between border-t border-dashed border-slate-200 pt-0.5 text-[11px] text-slate-400">
                                    <span>Frete</span>
                                    <span className="tabular-nums">{brl(order.deliveryFee)}</span>
                                  </div>
                                )}
                                {typeof order.totalAmount === 'number' && (
                                  <div className="mt-0.5 flex justify-between border-t border-slate-200 pt-0.5 text-[11px] font-bold text-slate-600">
                                    <span>Total do pedido</span>
                                    <span className="tabular-nums">{brl(order.totalAmount)}</span>
                                  </div>
                                )}
                                {order.status === 'canceled' && (
                                  <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600">
                                    Este pedido foi cancelado — se a dívida não deveria existir, use o estorno.
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
