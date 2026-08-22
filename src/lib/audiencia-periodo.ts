/**
 * O período que a tela de Visitantes está olhando, e o movimento do cardápio
 * dia a dia dentro dele.
 *
 * Antes a tela só existia dentro da sessão de caixa aberta: com o caixa fechado
 * ela ficava em branco, dizendo que "não há período para comparar". Mas há —
 * `store_visits` é append-only e guarda TODAS as visitas com a data. Na Gostinho
 * de Céu são 618 visitas em 11 dias que nunca apareceram para ninguém, porque a
 * loja passa a maior parte do tempo com o caixa fechado.
 *
 * Dois cuidados que o dado real impõe:
 *
 * 1. `visitorId` só passou a ser gravado na visita em 20/08/2026. Antes disso dá
 *    para contar VISITAS, nunca PESSOAS — e um "0 pessoas" ao lado de "144
 *    visitas" seria lido como erro. Por isso cada dia diz se sabe ou não.
 * 2. A série não começa antes do primeiro dia com visita. Pedir 30 dias numa
 *    loja com 11 dias de histórico encheria o gráfico de zeros que nunca
 *    aconteceram.
 *
 * Funções puras, sem Firestore e sem React.
 */

import { janelaDoRelatorio, type JanelaDoRelatorio } from '@/lib/relatorios/periodo';
import { paraMillis } from '@/lib/visitantes';

export type PresetDaAudiencia = 'sessao' | 'hoje' | 'ontem' | '7d' | '30d' | 'custom';

export type PeriodoDaAudiencia = {
  preset: PresetDaAudiencia;
  de?: string;
  ate?: string;
};

/** A `sessao` só entra na lista quando existe caixa aberto. */
export const PRESETS_DA_AUDIENCIA: { id: PresetDaAudiencia; label: string }[] = [
  { id: 'sessao', label: 'Sessão de caixa' },
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'custom', label: 'Escolher dia' },
];

const DIA = 24 * 60 * 60 * 1000;

function comecoDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const dataBR = (d: Date) => d.toLocaleDateString('pt-BR');

export function janelaDaAudiencia(
  periodo: PeriodoDaAudiencia,
  opcoes: { caixaAbertoEm?: Date | null; agora?: Date } = {},
): JanelaDoRelatorio {
  const agora = opcoes.agora || new Date();
  const hoje = comecoDoDia(agora);
  const amanha = new Date(hoje.getTime() + DIA);

  switch (periodo?.preset) {
    case 'sessao': {
      const inicio = opcoes.caixaAbertoEm ?? null;
      // Caixa fechado com "sessão" escolhida cai em Hoje: melhor mostrar o
      // movimento do dia do que uma tela em branco.
      if (!inicio) return janelaDaAudiencia({ preset: 'hoje' }, opcoes);
      const mesmoDia = comecoDoDia(inicio).getTime() === hoje.getTime();
      const hora = inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return {
        inicio,
        fim: null,
        rotulo: 'Sessão de caixa',
        // Caixa que virou a meia-noite: sem a data, a dona lê a noite inteira
        // como se fosse só o movimento de hoje.
        descricao: mesmoDia ? `desde hoje às ${hora}` : `desde ${dataBR(inicio)} às ${hora}`,
      };
    }
    case 'ontem': {
      const inicio = new Date(hoje.getTime() - DIA);
      return { inicio, fim: hoje, rotulo: 'Ontem', descricao: dataBR(inicio) };
    }
    case '7d':
    case '30d':
    case 'custom':
      return janelaDoRelatorio({ preset: periodo.preset, de: periodo.de, ate: periodo.ate }, agora);
    case 'hoje':
    default:
      return { inicio: hoje, fim: amanha, rotulo: 'Hoje', descricao: dataBR(hoje) };
  }
}

export type VisitaCrua = {
  id?: string;
  at?: unknown;
  visitorId?: string;
};

export type DiaDeMovimento = {
  /** 'AAAA-MM-DD'. */
  chave: string;
  /** '18/08', para o eixo do gráfico. */
  rotulo: string;
  /** 'terça, 18/08/2026', para o tooltip. */
  rotuloLongo: string;
  inicio: Date;
  visitas: number;
  /** Navegadores distintos no dia. Só vale quando `sabePessoas`. */
  pessoas: number;
  /** Alguma visita do dia trouxe `visitorId`. Antes de 20/08/2026, nenhuma trazia. */
  sabePessoas: boolean;
  ehHoje: boolean;
};

export type MovimentoDoCardapio = {
  dias: DiaDeMovimento[];
  totalVisitas: number;
  /** Pessoas distintas no período inteiro (não é a soma dos dias). */
  totalPessoas: number;
  sabePessoas: boolean;
  melhorDia: DiaDeMovimento | null;
  mediaPorDia: number;
};

const chaveDoDia = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function movimentoPorDia(
  visitas: VisitaCrua[] | null | undefined,
  janela: JanelaDoRelatorio,
  agora: Date = new Date(),
): MovimentoDoCardapio {
  const lista = Array.isArray(visitas) ? visitas : [];
  const porDia = new Map<string, { visitas: number; ids: Set<string>; comId: number }>();
  const todosOsIds = new Set<string>();
  let primeira: Date | null = null;
  let ultima: Date | null = null;
  let comIdNoPeriodo = 0;

  for (const visita of lista) {
    const millis = paraMillis(visita?.at);
    if (millis === null) continue;
    const data = new Date(millis);
    if (janela.inicio && data < janela.inicio) continue;
    if (janela.fim && data >= janela.fim) continue;

    if (!primeira || data < primeira) primeira = data;
    if (!ultima || data > ultima) ultima = data;

    const chave = chaveDoDia(data);
    const atual = porDia.get(chave) || { visitas: 0, ids: new Set<string>(), comId: 0 };
    atual.visitas += 1;
    const visitorId = String(visita?.visitorId || '').trim();
    if (visitorId) {
      atual.ids.add(visitorId);
      atual.comId += 1;
      todosOsIds.add(visitorId);
      comIdNoPeriodo += 1;
    }
    porDia.set(chave, atual);
  }

  if (!primeira) {
    return { dias: [], totalVisitas: 0, totalPessoas: 0, sabePessoas: false, melhorDia: null, mediaPorDia: 0 };
  }

  // A série termina no fim da janela, mas nunca antes da última visita nem
  // depois de hoje: janela aberta ("desde a abertura do caixa") vai até hoje.
  const hoje = comecoDoDia(agora);
  const limite = janela.fim ? comecoDoDia(new Date(janela.fim.getTime() - 1)) : hoje;
  const ultimoDia = comecoDoDia(ultima as Date);
  const fim = limite < ultimoDia ? ultimoDia : limite;

  const dias: DiaDeMovimento[] = [];
  const cursor = comecoDoDia(primeira);

  while (cursor <= fim) {
    const chave = chaveDoDia(cursor);
    const dados = porDia.get(chave) || { visitas: 0, ids: new Set<string>(), comId: 0 };
    dias.push({
      chave,
      rotulo: cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      rotuloLongo: cursor.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      inicio: new Date(cursor),
      visitas: dados.visitas,
      pessoas: dados.ids.size,
      sabePessoas: dados.comId > 0,
      ehHoje: chave === chaveDoDia(hoje),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const comVisita = dias.filter((d) => d.visitas > 0);
  const totalVisitas = dias.reduce((soma, d) => soma + d.visitas, 0);

  return {
    dias,
    totalVisitas,
    totalPessoas: todosOsIds.size,
    // Se nenhuma visita do período trouxe id, "pessoas" não é zero: é
    // desconhecido, e a tela precisa saber a diferença.
    sabePessoas: comIdNoPeriodo > 0,
    melhorDia: comVisita.length ? comVisita.reduce((a, b) => (b.visitas > a.visitas ? b : a)) : null,
    mediaPorDia: dias.length ? Math.round((totalVisitas / dias.length) * 10) / 10 : 0,
  };
}
