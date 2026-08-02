/**
 * Identidade do freelancer no caixa.
 *
 * O repasse do freelancer era gravado com o NOME no `destinatarioId`
 * (`destinatarioId: "Freela Teste"`), e era pelo nome que o "já pago" era
 * casado. Renomear alguém na Retaguarda fazia o vale sumir do abatimento e a
 * pessoa era paga duas vezes.
 *
 * Agora a chave é o id do cadastro. O nome continua sendo aceito **só na
 * leitura**, para os lançamentos que já estão no banco e para os freelancers
 * digitados na mão no fechamento (esses não têm cadastro, logo não têm id).
 * Como manda a convenção do projeto, o casamento por texto não escolhe destino
 * quando o nome está repetido: nesse caso o lançamento antigo fica de fora e
 * aparece para o dono decidir, em vez de virar abatimento no palpite.
 */

import { emDinheiro } from '@/lib/dinheiro';

export type FreelancerDoCaixa = {
  /** Id do cadastro em store_profiles.freelancers. Ausente = adicionado na mão. */
  id?: string;
  name: string;
  tipo: 'diaria' | 'comissao' | 'diaria_comissao';
  diaria: number;
  comissao: number;
  entregas: number;
};

export type LancamentoDeRepasse = {
  tipo?: string;
  destinatarioTipo?: string;
  destinatarioId?: string;
  valor: number;
  /** Timestamp do Firestore, Date, número ou ISO. Só para contar os dias. */
  data?: any;
  titulo?: string;
};

export type FreelancerComSaldo<T extends FreelancerDoCaixa = FreelancerDoCaixa> = T & {
  /** Id quando existe, nome como último recurso. Serve de key e de destinatarioId. */
  chave: string;
  total: number;
  jaPago: number;
  saldo: number;
};

/** Chave estável para gravar e para casar lançamentos. */
export function chaveDoFreelancer(f: { id?: string; name: string }): string {
  return f.id || f.name;
}

export function totalDoFreelancer(f: Pick<FreelancerDoCaixa, 'tipo' | 'diaria' | 'comissao' | 'entregas'>): number {
  const diaria = Number(f.diaria) || 0;
  const comissao = (Number(f.comissao) || 0) * (Number(f.entregas) || 0);
  if (f.tipo === 'diaria') return diaria;
  if (f.tipo === 'comissao') return comissao;
  return diaria + comissao;
}

const ehSangriaDeFreelancer = (l: LancamentoDeRepasse) =>
  l.tipo === 'sangria' && l.destinatarioTipo === 'freelancer' && !!l.destinatarioId;

/**
 * Quanto já foi adiantado a cada freelancer, com o saldo que resta.
 *
 * `lancamentos` são os do caixa da sessão; a lista de freelancers é a escala
 * do dia mais quem foi adicionado na mão.
 */
export function freelancersComSaldo<T extends FreelancerDoCaixa>(
  freelancers: T[],
  lancamentos: LancamentoDeRepasse[],
): FreelancerComSaldo<T>[] {
  // Nome repetido não resolve nada por texto: some do fallback de legado.
  const vezesPorNome = new Map<string, number>();
  for (const f of freelancers) vezesPorNome.set(f.name, (vezesPorNome.get(f.name) || 0) + 1);

  const sangrias = lancamentos.filter(ehSangriaDeFreelancer);

  return freelancers.map((f) => {
    const chave = chaveDoFreelancer(f);
    const nomeResolve = !!f.name && vezesPorNome.get(f.name) === 1;

    const jaPago = sangrias
      .filter((l) => l.destinatarioId === chave || (nomeResolve && l.destinatarioId === f.name))
      .reduce((soma, l) => soma + Math.abs(Number(l.valor) || 0), 0);

    const total = totalDoFreelancer(f);
    return { ...f, chave, total, jaPago, saldo: Math.max(0, total - jaPago) };
  });
}

// ─────────────────── Visão da Retaguarda (aba Freelance) ───────────────────

/** Cadastro cru de store_profiles.freelancers. */
export type FreelancerCadastrado = {
  id?: string;
  name: string;
  dailyRate?: number | string;
  workDays?: string[];
  active?: boolean;
};

export type RepasseDeFreelancer = {
  chave: string;
  name: string;
  /** false = pagamento avulso: quem recebeu não está (ou não está mais) no cadastro. */
  cadastrado: boolean;
  ativo: boolean;
  diaria: number;
  /** Total que saiu da gaveta para essa pessoa no período. */
  pago: number;
  /** Dias de calendário distintos com algum pagamento. */
  diasComPagamento: number;
  lancamentos: LancamentoDeRepasse[];
};

const emMs = (data: any): number => {
  if (!data) return 0;
  const d = data?.toDate?.() ?? data;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};

const diaDoLancamento = (l: LancamentoDeRepasse): string => {
  const t = emMs(l.data);
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * Nome só para MOSTRAR quando quem recebeu não está no cadastro.
 * Nunca serve para ligar nada — o vínculo é sempre `destinatarioId`.
 */
export function nomeNoTitulo(titulo?: string): string {
  if (!titulo) return '';
  const vale = titulo.match(/Vale para Freelancer:\s*(.+)$/i);
  if (vale) return vale[1].trim();
  const acerto = titulo.match(/^Freelancer:\s*(.+?)\s*\([^)]*\)\s*$/i);
  if (acerto) return acerto[1].trim();
  return '';
}

/**
 * Quanto cada freelancer recebeu no período, para a aba Freelance.
 *
 * Começa pelo cadastro (a equipe aparece mesmo sem movimento) e agrupa os
 * pagamentos por `destinatarioId`. Pagamento de quem não está no cadastro
 * — freelancer digitado na mão no fechamento, ou alguém que foi excluído —
 * vira um cartão próprio marcado como avulso: dinheiro que saiu da gaveta não
 * pode sumir da tela só porque o cadastro mudou.
 *
 * Não inventa "quanto ainda se deve" em período histórico: sem saber que dias
 * a pessoa trabalhou, isso seria chute. O saldo do dia é do fechamento.
 */
export function repassesDeFreelancers(
  cadastrados: FreelancerCadastrado[],
  lancamentos: LancamentoDeRepasse[],
): RepasseDeFreelancer[] {
  const vezesPorNome = new Map<string, number>();
  for (const f of cadastrados) vezesPorNome.set(f.name, (vezesPorNome.get(f.name) || 0) + 1);

  const grupos = new Map<string, RepasseDeFreelancer>();
  for (const f of cadastrados) {
    const chave = chaveDoFreelancer(f);
    grupos.set(chave, {
      chave,
      name: f.name,
      cadastrado: true,
      ativo: f.active !== false,
      diaria: Number(f.dailyRate) || 0,
      pago: 0,
      diasComPagamento: 0,
      lancamentos: [],
    });
  }

  // Nome resolve legado só quando é único no cadastro.
  const porNome = new Map<string, RepasseDeFreelancer>();
  for (const f of cadastrados) {
    if (f.name && vezesPorNome.get(f.name) === 1) {
      const grupo = grupos.get(chaveDoFreelancer(f));
      if (grupo) porNome.set(f.name, grupo);
    }
  }

  for (const l of lancamentos) {
    if (!ehSangriaDeFreelancer(l)) continue;
    const id = l.destinatarioId as string;
    const dono = grupos.get(id) || porNome.get(id);
    if (dono) {
      dono.lancamentos.push(l);
      continue;
    }
    const avulso = grupos.get(id) || {
      chave: id,
      name: nomeNoTitulo(l.titulo) || id,
      cadastrado: false,
      ativo: false,
      diaria: 0,
      pago: 0,
      diasComPagamento: 0,
      lancamentos: [],
    };
    avulso.lancamentos.push(l);
    grupos.set(id, avulso);
  }

  return [...grupos.values()]
    .map((g) => {
      const dias = new Set(g.lancamentos.map(diaDoLancamento).filter(Boolean));
      return {
        ...g,
        pago: emDinheiro(g.lancamentos.reduce((s, l) => s + Math.abs(Number(l.valor) || 0), 0)),
        diasComPagamento: dias.size,
        lancamentos: [...g.lancamentos].sort((a, b) => emMs(b.data) - emMs(a.data)),
      };
    })
    .sort((a, b) => b.pago - a.pago || a.name.localeCompare(b.name, 'pt-BR'));
}
