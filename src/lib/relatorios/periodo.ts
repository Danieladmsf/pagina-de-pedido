/**
 * Janela de tempo da aba Relatórios.
 *
 * Por que não reaproveitar `lib/periodo`: lá as janelas são CORRIDAS (30 dias =
 * 30×24h para trás), o que serve para o extrato do Prazo mas não responde "quanto
 * eu vendi em julho". Relatório de dono de loja fala em MÊS DE CALENDÁRIO — "mês
 * passado", "últimos 6 meses" — e uma janela corrida mistura duas metades de
 * meses diferentes no mesmo número. Mexer em `PERIODOS_PADRAO` mudaria junto as
 * telas do Prazo e da ficha do cliente, que não é o que se pediu.
 *
 * Função pura, sem Firestore e sem React: o rótulo que ela devolve é o mesmo que
 * aparece na tela e no cabeçalho do CSV.
 */

export type PresetDoRelatorio =
  | '7d'
  | '30d'
  | 'mes_atual'
  | 'mes_passado'
  | '3m'
  | '6m'
  | '12m'
  | 'tudo'
  | 'custom';

export type PeriodoDoRelatorio = {
  preset: PresetDoRelatorio;
  /** 'AAAA-MM-DD' do input de data (só no personalizado). */
  de?: string;
  ate?: string;
};

export type JanelaDoRelatorio = {
  /** Início inclusivo, ou null quando não há limite. */
  inicio: Date | null;
  /** Fim EXCLUSIVO, ou null quando não há limite. */
  fim: Date | null;
  /** Nome curto do período, para o crachá da tela. */
  rotulo: string;
  /** As datas de verdade, para o cabeçalho do arquivo exportado. */
  descricao: string;
};

export const PRESETS_DO_RELATORIO: { id: PresetDoRelatorio; label: string }[] = [
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'mes_atual', label: 'Mês atual' },
  { id: 'mes_passado', label: 'Mês passado' },
  { id: '3m', label: '3 meses' },
  { id: '6m', label: '6 meses' },
  { id: '12m', label: '12 meses' },
  { id: 'tudo', label: 'Tudo' },
  { id: 'custom', label: 'Personalizado' },
];

const DIA = 24 * 60 * 60 * 1000;

function comecoDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function somarDias(d: Date, dias: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + dias);
  return x;
}

/** Primeiro instante do mês, `deslocamento` meses para frente (ou para trás). */
function primeiroDoMes(d: Date, deslocamento = 0): Date {
  return new Date(d.getFullYear(), d.getMonth() + deslocamento, 1);
}

const dataBR = (d: Date) => d.toLocaleDateString('pt-BR');

function nomeDoMes(d: Date): string {
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/**
 * Texto com as datas concretas da janela.
 *
 * O fim é limitado a hoje de propósito: escolher "Mês atual" no dia 20 não pode
 * escrever "até 31/08" num arquivo que só tem venda até o dia 20.
 */
function descrever(inicio: Date | null, fim: Date | null, agora: Date): string {
  if (!inicio && !fim) return 'todo o histórico';
  const ultimoDia = fim ? new Date(Math.min(fim.getTime() - DIA, comecoDoDia(agora).getTime())) : comecoDoDia(agora);
  if (!inicio) return `até ${dataBR(ultimoDia)}`;
  if (comecoDoDia(inicio).getTime() === comecoDoDia(ultimoDia).getTime()) return dataBR(inicio);
  return `${dataBR(inicio)} a ${dataBR(ultimoDia)}`;
}

export function janelaDoRelatorio(
  periodo: PeriodoDoRelatorio,
  agora: Date = new Date(),
): JanelaDoRelatorio {
  const preset = periodo?.preset || 'mes_atual';
  const hoje = comecoDoDia(agora);
  const amanha = somarDias(hoje, 1);

  const montar = (inicio: Date | null, fim: Date | null, rotulo: string): JanelaDoRelatorio => ({
    inicio,
    fim,
    rotulo,
    descricao: descrever(inicio, fim, agora),
  });

  switch (preset) {
    case '7d':
      return montar(somarDias(hoje, -6), amanha, 'Últimos 7 dias');
    case '30d':
      return montar(somarDias(hoje, -29), amanha, 'Últimos 30 dias');
    case 'mes_atual':
      return montar(primeiroDoMes(agora), primeiroDoMes(agora, 1), nomeDoMes(agora));
    case 'mes_passado': {
      const inicio = primeiroDoMes(agora, -1);
      return montar(inicio, primeiroDoMes(agora), nomeDoMes(inicio));
    }
    case '3m':
      return montar(primeiroDoMes(agora, -2), primeiroDoMes(agora, 1), 'Últimos 3 meses');
    case '6m':
      return montar(primeiroDoMes(agora, -5), primeiroDoMes(agora, 1), 'Últimos 6 meses');
    case '12m':
      return montar(primeiroDoMes(agora, -11), primeiroDoMes(agora, 1), 'Últimos 12 meses');
    case 'tudo':
      return montar(null, null, 'Todo o período');
    case 'custom': {
      const de = periodo.de ? new Date(`${periodo.de}T00:00:00`) : null;
      // Fim exclusivo no começo do dia seguinte: sem isso, "até 31/07" perderia
      // tudo que foi vendido depois da meia-noite do dia 31.
      const ate = periodo.ate ? somarDias(new Date(`${periodo.ate}T00:00:00`), 1) : null;

      if (!de && !ate) return montar(null, null, 'Todo o período');
      // Datas invertidas viram o dia escolhido como início, em vez de devolver
      // uma tela vazia sem explicação.
      if (de && ate && de >= ate) return montar(de, somarDias(de, 1), dataBR(de));
      const janela = montar(de, ate, 'Personalizado');
      return { ...janela, rotulo: janela.descricao };
    }
  }
}

/** A venda cai dentro da janela? Sem data legível, fica de fora. */
export function dentroDaJanela(data: Date | null, janela: JanelaDoRelatorio): boolean {
  if (!data) return false;
  if (janela.inicio && data < janela.inicio) return false;
  if (janela.fim && data >= janela.fim) return false;
  return true;
}
