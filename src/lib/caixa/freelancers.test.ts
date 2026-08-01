import { describe, expect, it } from 'vitest';
import {
  chaveDoFreelancer,
  freelancersComSaldo,
  totalDoFreelancer,
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
