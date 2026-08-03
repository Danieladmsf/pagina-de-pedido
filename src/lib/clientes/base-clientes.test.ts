import { describe, expect, it } from 'vitest';
import { resumoDaBaseDeClientes } from './base-clientes';

const agora = new Date(2026, 7, 3, 10, 0, 0); // 03/08/2026

describe('resumoDaBaseDeClientes', () => {
  it('conta ativo por compra nos últimos 30 dias', () => {
    const r = resumoDaBaseDeClientes([
      { ultimoPedido: '02/08/2026' },  // ontem
      { ultimoPedido: '10/07/2026' },  // 24 dias
      { ultimoPedido: '01/07/2026' },  // 33 dias — fora
      { ultimoPedido: '' },            // nunca comprou
      {},
    ], agora);
    expect(r).toMatchObject({ total: 5, ativos: 2 });
  });

  it('conta novo pelo mês do cadastro, não pelos últimos 30 dias', () => {
    const r = resumoDaBaseDeClientes([
      { clienteDesde: '01/08/2026' },  // este mês
      { clienteDesde: '03/08/2026' },  // hoje
      { clienteDesde: '31/07/2026' },  // mês passado, mesmo tendo 3 dias
      { clienteDesde: '03/08/2025' },  // mesmo mês, ano errado
    ], agora);
    expect(r.novosNoMes).toBe(2);
  });

  it('lê a data em pt-BR, que é como o cadastro grava', () => {
    // "10/07/2026" com `new Date()` puro vira 7 de outubro ou data inválida.
    const r = resumoDaBaseDeClientes([{ ultimoPedido: '10/07/2026', clienteDesde: '10/07/2026' }], agora);
    expect(r.ativos).toBe(1);
    expect(r.novosNoMes).toBe(0);
  });

  it('usa createdAt (ISO) quando não há clienteDesde', () => {
    const r = resumoDaBaseDeClientes([{ createdAt: '2026-08-02T15:37:01.418Z' }], agora);
    expect(r.novosNoMes).toBe(1);
  });

  it('base vazia não quebra', () => {
    expect(resumoDaBaseDeClientes([], agora)).toEqual({ total: 0, ativos: 0, novosNoMes: 0 });
    expect(resumoDaBaseDeClientes(null as any, agora)).toEqual({ total: 0, ativos: 0, novosNoMes: 0 });
  });
});
