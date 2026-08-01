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
