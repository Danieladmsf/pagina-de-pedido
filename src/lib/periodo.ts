/**
 * Janela de tempo dos filtros de período (extrato do Prazo e compras da ficha).
 *
 * Os atalhos são janelas CORRIDAS (30 dias = 30×24h para trás), como sempre
 * foram. O personalizado é por DIA de calendário: quem escolhe "01/07 até
 * 31/07" espera o mês inteiro, incluindo tudo que aconteceu no dia 31 — por
 * isso o fim é o começo do dia seguinte, não o mesmo instante.
 *
 * Pura de propósito: é a mesma regra em duas telas, e o rótulo que ela devolve
 * é o que sai impresso no papel.
 */

export type PeriodoPreset = '30' | '90' | 'ano' | 'tudo' | 'custom';

export type PeriodoSelecionado = {
  preset: PeriodoPreset;
  /** 'AAAA-MM-DD' do input de data. */
  de?: string;
  ate?: string;
};

export type JanelaDePeriodo = {
  /** Timestamp inicial (inclusivo) ou null quando não há limite. */
  inicio: number | null;
  /** Timestamp final (exclusivo) ou null quando não há limite. */
  fim: number | null;
  /** Texto pronto para a tela e para o cupom. */
  rotulo: string;
};

export const PERIODOS_PADRAO: { id: PeriodoPreset; label: string; dias: number | null }[] = [
  { id: '30', label: '30 dias', dias: 30 },
  { id: '90', label: '90 dias', dias: 90 },
  { id: 'ano', label: '12 meses', dias: 365 },
  { id: 'tudo', label: 'Tudo', dias: null },
  { id: 'custom', label: 'Personalizado', dias: null },
];

const DIA = 24 * 60 * 60 * 1000;
const comecoDoDia = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const dataBR = (t: number) => new Date(t).toLocaleDateString('pt-BR');

export function janelaDoPeriodo(sel: PeriodoSelecionado, agora = Date.now()): JanelaDePeriodo {
  const preset = sel?.preset || 'tudo';

  if (preset === 'custom') {
    const de = sel.de ? comecoDoDia(sel.de) : null;
    // Fim EXCLUSIVO no começo do dia seguinte: sem isso, escolher "até 31/07"
    // perderia tudo que aconteceu depois da meia-noite do dia 31.
    const ate = sel.ate ? comecoDoDia(sel.ate) + DIA : null;

    if (de === null && ate === null) return { inicio: null, fim: null, rotulo: 'Tudo' };
    if (de !== null && ate !== null && de >= ate) {
      // Datas invertidas: em vez de devolver lista vazia sem explicação, a
      // janela vira o dia escolhido como início.
      return { inicio: de, fim: de + DIA, rotulo: dataBR(de) };
    }
    if (de === null) return { inicio: null, fim: ate, rotulo: `até ${dataBR(ate! - DIA)}` };
    if (ate === null) return { inicio: de, fim: null, rotulo: `desde ${dataBR(de)}` };
    return {
      inicio: de,
      fim: ate,
      rotulo: de === ate - DIA ? dataBR(de) : `${dataBR(de)} a ${dataBR(ate - DIA)}`,
    };
  }

  const opcao = PERIODOS_PADRAO.find((p) => p.id === preset);
  if (!opcao?.dias) return { inicio: null, fim: null, rotulo: 'Tudo' };
  return { inicio: agora - opcao.dias * DIA, fim: null, rotulo: opcao.label };
}

/** O registro (data ISO) cai dentro da janela? Sem data, fica de fora. */
export function dentroDaJanela(dataIso: string | undefined, janela: JanelaDePeriodo): boolean {
  if (janela.inicio === null && janela.fim === null) return true;
  const t = Date.parse(dataIso || '');
  if (Number.isNaN(t)) return false;
  if (janela.inicio !== null && t < janela.inicio) return false;
  if (janela.fim !== null && t >= janela.fim) return false;
  return true;
}
