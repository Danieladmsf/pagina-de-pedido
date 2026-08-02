import { describe, expect, it } from 'vitest';
import {
  chaveDoFreelancer,
  freelancersComSaldo,
  nomeNoTitulo,
  repassesDeFreelancers,
  totalDoFreelancer,
  type FreelancerCadastrado,
  type FreelancerDoCaixa,
  type LancamentoDeRepasse,
} from './freelancers';

const diarista = (over: Partial<FreelancerDoCaixa> = {}): FreelancerDoCaixa => ({
  id: 'freela-1',
  name: 'Freela Teste',
  tipo: 'diaria',
  diaria: 70.5,
  comissao: 0,
  entregas: 0,
  ...over,
});

const vale = (destinatarioId: string, valor: number): LancamentoDeRepasse => ({
  tipo: 'sangria',
  destinatarioTipo: 'freelancer',
  destinatarioId,
  valor: -Math.abs(valor),
});

describe('chaveDoFreelancer', () => {
  it('usa o id do cadastro', () => {
    expect(chaveDoFreelancer({ id: 'freela-1', name: 'Ana' })).toBe('freela-1');
  });

  it('cai no nome só para quem foi digitado na mão', () => {
    expect(chaveDoFreelancer({ name: 'Ajudante do sábado' })).toBe('Ajudante do sábado');
  });
});

describe('totalDoFreelancer', () => {
  it('cobre as três formas de pagamento', () => {
    expect(totalDoFreelancer({ tipo: 'diaria', diaria: 70.5, comissao: 5, entregas: 4 })).toBe(70.5);
    expect(totalDoFreelancer({ tipo: 'comissao', diaria: 70.5, comissao: 5, entregas: 4 })).toBe(20);
    expect(totalDoFreelancer({ tipo: 'diaria_comissao', diaria: 70.5, comissao: 5, entregas: 4 })).toBe(90.5);
  });

  it('campo vazio não vira NaN', () => {
    expect(totalDoFreelancer({ tipo: 'diaria_comissao', diaria: NaN as any, comissao: undefined as any, entregas: 3 })).toBe(0);
  });
});

describe('freelancersComSaldo', () => {
  it('abate o vale gravado pelo id', () => {
    const [f] = freelancersComSaldo([diarista()], [vale('freela-1', 20)]);
    expect(f.jaPago).toBe(20);
    expect(f.saldo).toBe(50.5);
    expect(f.chave).toBe('freela-1');
  });

  it('abate o vale legado, gravado pelo NOME', () => {
    // Foi assim que a sessão 2 de 01/08/2026 ficou gravada.
    const [f] = freelancersComSaldo([diarista()], [vale('Freela Teste', 20)]);
    expect(f.jaPago).toBe(20);
    expect(f.saldo).toBe(50.5);
  });

  it('soma id novo e nome antigo sem contar duas vezes o mesmo lançamento', () => {
    const [f] = freelancersComSaldo([diarista()], [vale('Freela Teste', 20), vale('freela-1', 10)]);
    expect(f.jaPago).toBe(30);
    expect(f.saldo).toBe(40.5);
  });

  it('renomear na Retaguarda não perde o vale do dia', () => {
    // Mesmo id, nome novo: o abatimento continua de pé.
    const [f] = freelancersComSaldo([diarista({ name: 'Freela Renomeado' })], [vale('freela-1', 20)]);
    expect(f.jaPago).toBe(20);
    expect(f.saldo).toBe(50.5);
  });

  it('nome repetido não escolhe dono para o lançamento legado', () => {
    const lista = freelancersComSaldo(
      [diarista({ id: 'freela-1' }), diarista({ id: 'freela-2' })],
      [vale('Freela Teste', 20)],
    );
    // Nenhum dos dois pode abater: seria palpite. O saldo fica cheio nos dois
    // e o dono resolve olhando o extrato.
    expect(lista.map((f) => f.jaPago)).toEqual([0, 0]);
    expect(lista.map((f) => f.saldo)).toEqual([70.5, 70.5]);
  });

  it('nome repetido ainda abate o que foi gravado pelo id', () => {
    const lista = freelancersComSaldo(
      [diarista({ id: 'freela-1' }), diarista({ id: 'freela-2' })],
      [vale('freela-1', 20)],
    );
    expect(lista.map((f) => f.jaPago)).toEqual([20, 0]);
  });

  it('freelancer digitado na mão continua funcionando pelo nome', () => {
    const [f] = freelancersComSaldo(
      [{ name: 'Ajudante', tipo: 'diaria', diaria: 100, comissao: 0, entregas: 0 }],
      [vale('Ajudante', 40)],
    );
    expect(f.jaPago).toBe(40);
    expect(f.saldo).toBe(60);
  });

  it('não confunde com sangria de motoboy nem com despesa avulsa', () => {
    const [f] = freelancersComSaldo([diarista()], [
      { tipo: 'sangria', destinatarioTipo: 'motoboy', destinatarioId: 'freela-1', valor: -50 },
      { tipo: 'sangria', valor: -80 },
      { tipo: 'venda', destinatarioTipo: 'freelancer', destinatarioId: 'freela-1', valor: 25 },
    ]);
    expect(f.jaPago).toBe(0);
    expect(f.saldo).toBe(70.5);
  });

  it('pagou mais que o devido: saldo para em zero, não fica negativo', () => {
    const [f] = freelancersComSaldo([diarista()], [vale('freela-1', 90)]);
    expect(f.jaPago).toBe(90);
    expect(f.saldo).toBe(0);
  });
});

describe('nomeNoTitulo', () => {
  it('lê o nome dos dois títulos que o caixa grava', () => {
    expect(nomeNoTitulo('Adiantamento / Vale para Freelancer: Ana Paula')).toBe('Ana Paula');
    expect(nomeNoTitulo('Freelancer: Ana Paula (diaria)')).toBe('Ana Paula');
  });

  it('devolve vazio no que não reconhece', () => {
    expect(nomeNoTitulo('Sangria de Caixa')).toBe('');
    expect(nomeNoTitulo(undefined)).toBe('');
  });
});

describe('repassesDeFreelancers', () => {
  const cadastro: FreelancerCadastrado[] = [
    { id: 'freela-1', name: 'Freela Teste', dailyRate: 70.5, active: true },
    { id: 'freela-2', name: 'Ana', dailyRate: 100, active: false },
  ];
  const em = (dia: string, hora = '12:00') => new Date(`2026-08-${dia}T${hora}:00`);

  const pagamento = (destinatarioId: string, valor: number, data: Date, titulo?: string): LancamentoDeRepasse => ({
    tipo: 'sangria',
    destinatarioTipo: 'freelancer',
    destinatarioId,
    valor: -Math.abs(valor),
    data,
    titulo,
  });

  it('a equipe aparece mesmo sem movimento no período', () => {
    const lista = repassesDeFreelancers(cadastro, []);
    expect(lista.map((r) => r.name)).toEqual(['Ana', 'Freela Teste']);
    expect(lista.every((r) => r.pago === 0 && r.cadastrado)).toBe(true);
    expect(lista.find((r) => r.name === 'Ana')?.ativo).toBe(false);
  });

  it('soma o que saiu da gaveta e conta os dias distintos', () => {
    const lista = repassesDeFreelancers(cadastro, [
      pagamento('freela-1', 25, em('01', '19:00')),
      pagamento('freela-1', 45.5, em('01', '20:00')),
      pagamento('freela-1', 70.5, em('02')),
    ]);
    const f = lista[0];
    expect(f.name).toBe('Freela Teste');
    expect(f.pago).toBe(141);
    expect(f.diasComPagamento).toBe(2);
    expect(f.lancamentos).toHaveLength(3);
  });

  it('pagamento de quem não está no cadastro não some da tela', () => {
    // Freelancer digitado na mão no fechamento: destinatarioId é o nome.
    const lista = repassesDeFreelancers(cadastro, [
      pagamento('Ajudante do sábado', 80, em('01'), 'Freelancer: Ajudante do sábado (diaria)'),
    ]);
    const avulso = lista.find((r) => !r.cadastrado);
    expect(avulso?.name).toBe('Ajudante do sábado');
    expect(avulso?.pago).toBe(80);
  });

  it('freelancer excluído do cadastro aparece com o nome do título, não com o id', () => {
    const lista = repassesDeFreelancers([], [
      pagamento('0.4728349271046599', 70.5, em('01'), 'Adiantamento / Vale para Freelancer: Freela Teste'),
    ]);
    expect(lista).toHaveLength(1);
    expect(lista[0].name).toBe('Freela Teste');
    expect(lista[0].cadastrado).toBe(false);
    // O agrupamento continua sendo pelo id — o nome é só para ler.
    expect(lista[0].chave).toBe('0.4728349271046599');
  });

  it('lançamento legado pelo nome cai no cadastro certo', () => {
    const lista = repassesDeFreelancers(cadastro, [pagamento('Freela Teste', 20, em('01'))]);
    const f = lista.find((r) => r.chave === 'freela-1');
    expect(f?.pago).toBe(20);
    expect(lista.filter((r) => !r.cadastrado)).toHaveLength(0);
  });

  it('nome repetido no cadastro: legado vira avulso em vez de escolher um dono', () => {
    const repetido: FreelancerCadastrado[] = [
      { id: 'a', name: 'Ana', dailyRate: 100 },
      { id: 'b', name: 'Ana', dailyRate: 120 },
    ];
    const lista = repassesDeFreelancers(repetido, [pagamento('Ana', 50, em('01'))]);
    expect(lista.filter((r) => r.cadastrado).every((r) => r.pago === 0)).toBe(true);
    expect(lista.find((r) => !r.cadastrado)?.pago).toBe(50);
  });

  it('ignora sangria de motoboy e despesa avulsa', () => {
    const lista = repassesDeFreelancers(cadastro, [
      { tipo: 'sangria', destinatarioTipo: 'motoboy', destinatarioId: 'freela-1', valor: -50, data: em('01') },
      { tipo: 'sangria', valor: -80, data: em('01') },
    ]);
    expect(lista.every((r) => r.pago === 0)).toBe(true);
    expect(lista).toHaveLength(2);
  });

  it('ordena por quem recebeu mais, depois por nome', () => {
    const lista = repassesDeFreelancers(cadastro, [pagamento('freela-2', 30, em('01'))]);
    expect(lista.map((r) => r.name)).toEqual(['Ana', 'Freela Teste']);
  });

  it('valor somado não arrasta resíduo de ponto flutuante', () => {
    const lista = repassesDeFreelancers([cadastro[0]], [
      pagamento('freela-1', 7.67, em('01')),
      pagamento('freela-1', 0.1, em('01')),
      pagamento('freela-1', 0.2, em('01')),
    ]);
    expect(lista[0].pago).toBe(7.97);
  });

  it('lançamento sem data não inventa um dia trabalhado', () => {
    const lista = repassesDeFreelancers([cadastro[0]], [
      { tipo: 'sangria', destinatarioTipo: 'freelancer', destinatarioId: 'freela-1', valor: -40 },
    ]);
    expect(lista[0].pago).toBe(40);
    expect(lista[0].diasComPagamento).toBe(0);
  });
});
