/**
 * Como a aba Relatórios se organiza para o período escolhido.
 *
 * A tela era a mesma em qualquer período: escolher "Hoje" mostrava o balancete
 * de seis meses, "X produtos sem nenhuma venda" e a lista do que não vendeu —
 * coisa de mês inteiro, fora do contexto de um dia. Aqui mora a régua: um dia
 * olha HORA a hora, até dois meses olha DIA a dia, mais que isso olha MÊS a
 * mês. E tudo sai das mesmas vendas (o caixa, via `vendasDoPeriodo`), para o
 * gráfico, os cartões e as listas nunca somarem fontes diferentes.
 *
 * Funções puras, sem Firestore e sem React.
 */

import { emDinheiro, somaDinheiro } from '@/lib/dinheiro';
import { CANAIS_EM_ORDEM, CANAL_LABELS, canalDaVenda, type CanalDaVenda } from '@/lib/order-channel';
import type { VendaDoPeriodo } from '@/lib/faturamento';
import type { ComparacaoDoRelatorio, JanelaDoRelatorio } from './periodo';

export type EscalaDoRelatorio = 'hora' | 'dia' | 'mes';

const DIA = 24 * 60 * 60 * 1000;

/** Um dia → hora; até ~2 meses → dia; mais (ou "todo o período") → mês. */
export function escalaDoPeriodo(janela: JanelaDoRelatorio, agora: Date = new Date()): EscalaDoRelatorio {
  if (!janela.inicio) return 'mes';
  const fim = janela.fim ? Math.min(janela.fim.getTime(), comecoDoDia(agora).getTime() + DIA) : agora.getTime();
  const dias = (fim - janela.inicio.getTime()) / DIA;
  if (dias <= 1.05) return 'hora';
  if (dias <= 62) return 'dia';
  return 'mes';
}

function comecoDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export type PontoDaSerie = {
  chave: string;
  rotulo: string;
  /** Rótulo completo, para o tooltip ("seg, 13/10"). */
  rotuloLongo: string;
  atual: number;
  anterior: number;
  vendas: number;
};

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ddmm = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/**
 * Hora a hora (um dia) ou dia a dia (até dois meses), com a comparação ao lado.
 *
 * No dia a dia o período anterior é alinhado pela POSIÇÃO: o 1º dia de agora ao
 * lado do 1º dia de lá. No hora a hora ficam só as horas em que a loja vendeu
 * (num dos dois dias) — 24 colunas com a madrugada vazia espremiam o resto.
 * O dia a dia para em hoje: dia que ainda não chegou não é dia sem venda.
 */
export function serieDoPeriodo(dados: {
  escala: 'hora' | 'dia';
  janela: JanelaDoRelatorio;
  comparacao: ComparacaoDoRelatorio | null;
  vendas: VendaDoPeriodo[];
  anteriores: VendaDoPeriodo[];
  agora?: Date;
}): PontoDaSerie[] {
  const { escala, janela, comparacao, vendas, anteriores } = dados;
  const agora = dados.agora || new Date();

  if (escala === 'hora') {
    const horas: PontoDaSerie[] = Array.from({ length: 24 }, (_, h) => {
      const rotulo = `${String(h).padStart(2, '0')}h`;
      return { chave: rotulo, rotulo, rotuloLongo: `${rotulo} às ${String(h).padStart(2, '0')}h59`, atual: 0, anterior: 0, vendas: 0 };
    });
    for (const v of vendas) {
      if (v.quando == null) continue;
      const p = horas[new Date(v.quando).getHours()];
      p.atual = somaDinheiro(p.atual, v.valor);
      p.vendas += 1;
    }
    for (const v of anteriores) {
      if (v.quando == null) continue;
      const p = horas[new Date(v.quando).getHours()];
      p.anterior = somaDinheiro(p.anterior, v.valor);
    }
    const usadas = horas.map((p, i) => (p.atual > 0 || p.anterior > 0 ? i : -1)).filter((i) => i >= 0);
    if (!usadas.length) return [];
    return horas.slice(Math.min(...usadas), Math.max(...usadas) + 1);
  }

  if (!janela.inicio) return [];
  const inicio = comecoDoDia(janela.inicio);
  const ultimo = Math.min((janela.fim ? janela.fim.getTime() : agora.getTime()) - 1, comecoDoDia(agora).getTime() + DIA - 1);
  const pontos: PontoDaSerie[] = [];
  const indice = new Map<string, number>();
  const chave = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  for (let d = new Date(inicio); d.getTime() <= ultimo; d.setDate(d.getDate() + 1)) {
    indice.set(chave(d), pontos.length);
    pontos.push({
      chave: chave(d),
      rotulo: pontos.length < 14 && ultimo - inicio.getTime() < 14 * DIA ? `${DIAS_CURTOS[d.getDay()]} ${d.getDate()}` : ddmm(d),
      rotuloLongo: `${DIAS_CURTOS[d.getDay()]}, ${ddmm(d)}`,
      atual: 0,
      anterior: 0,
      vendas: 0,
    });
  }
  for (const v of vendas) {
    if (v.quando == null) continue;
    const i = indice.get(chave(new Date(v.quando)));
    if (i == null) continue;
    pontos[i].atual = somaDinheiro(pontos[i].atual, v.valor);
    pontos[i].vendas += 1;
  }
  if (comparacao) {
    const base = comecoDoDia(comparacao.inicio).getTime();
    for (const v of anteriores) {
      if (v.quando == null) continue;
      const i = Math.floor((comecoDoDia(new Date(v.quando)).getTime() - base) / DIA + 0.5);
      if (i >= 0 && i < pontos.length) pontos[i].anterior = somaDinheiro(pontos[i].anterior, v.valor);
    }
  }
  return pontos;
}

export type FatiaDoCanal = { canal: CanalDaVenda; rotulo: string; valor: number; vendas: number };

/** Por onde a venda entrou (balcão, delivery, mesa, encomenda...), na ordem fixa das telas. */
export function vendasPorCanal(vendas: VendaDoPeriodo[]): FatiaDoCanal[] {
  const mapa = new Map<CanalDaVenda, { valor: number; vendas: number }>();
  for (const v of vendas) {
    // Encomenda não tem orderType; venda avulsa (direto no caixa) é balcão.
    const doc = v.origem === 'encomenda' ? { origem: 'encomenda' } : v.documento || { source: 'pdv' };
    const canal = canalDaVenda(doc);
    const atual = mapa.get(canal) || { valor: 0, vendas: 0 };
    atual.valor = somaDinheiro(atual.valor, v.valor);
    atual.vendas += 1;
    mapa.set(canal, atual);
  }
  return CANAIS_EM_ORDEM.filter((c) => mapa.has(c)).map((c) => ({ canal: c, rotulo: CANAL_LABELS[c], ...mapa.get(c)! }));
}

export type LinhaDaVendaDoDia = {
  chave: string;
  hora: string;
  quando: number | null;
  cliente: string;
  canal: string;
  formas: string;
  valor: number;
  itens: number;
};

/** As vendas do dia, uma a uma, da mais recente para a mais antiga. */
export function vendasUmaAUma(vendas: VendaDoPeriodo[]): LinhaDaVendaDoDia[] {
  return [...vendas]
    .sort((a, b) => (b.quando ?? 0) - (a.quando ?? 0))
    .map((v, i) => {
      const doc: any = v.documento || {};
      const canalDoc = v.origem === 'encomenda' ? { origem: 'encomenda' } : v.documento || { source: 'pdv' };
      const nome = String(doc.customerName || doc.clienteNome || doc.nome || '').trim();
      const itens = (Array.isArray(doc.items) ? doc.items : []).reduce((s: number, it: any) => s + (Number(it?.quantity) || 1), 0);
      return {
        chave: v.vinculo || `avulsa-${i}`,
        hora: v.quando != null ? new Date(v.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—',
        quando: v.quando,
        cliente: nome && !/^cliente balc[aã]o$/i.test(nome) ? nome : v.origem === 'avulsa' ? 'Venda avulsa' : 'Não informado',
        canal: CANAL_LABELS[canalDaVenda(canalDoc)],
        formas: v.formas.join(' + ') || '—',
        valor: emDinheiro(v.valor),
        itens,
      };
    });
}
