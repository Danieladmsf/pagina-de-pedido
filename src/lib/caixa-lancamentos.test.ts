import { describe, expect, it } from 'vitest';

import { agruparLancamentosCaixa } from './caixa-lancamentos';

/**
 * O caso que motivou isto: uma venda paga em duas formas gerava duas linhas com
 * o mesmo "#id" no título, e cada uma expandia a lista COMPLETA de itens — na
 * conferência parecia que o produto tinha dobrado. O dinheiro nunca dobrou, e
 * estes testes travam as duas coisas: a soma continua certa e a lista para de
 * repetir a venda.
 */

const venda = (id: string, titulo: string, valor: number, formaPagamento: string, extra: any = {}) =>
  ({ id, titulo, valor, formaPagamento, tipo: 'venda', ...extra }) as any;

describe('agruparLancamentosCaixa', () => {
  it('junta as formas de uma mesma venda numa linha só, somando os valores', () => {
    const linhas = agruparLancamentosCaixa([
      venda('a', 'PDV #WdsOe - Balcão', 50, 'dinheiro'),
      venda('b', 'PDV #WdsOe - Balcão', 28, 'pix'),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].partes.map((p) => p.formaPagamento)).toEqual(['dinheiro', 'pix']);
    expect(linhas[0].valor).toBe(78);
    // A linha nasce na posição — e com a identidade — da primeira parte.
    expect(linhas[0].key).toBe('a');
    expect(linhas[0].principal.id).toBe('a');
  });

  it('venda de uma forma só continua sendo uma linha simples', () => {
    const linhas = agruparLancamentosCaixa([venda('a', 'PDV #WdsOe - Balcão', 78, 'pix')]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].partes).toHaveLength(1);
    expect(linhas[0].valor).toBe(78);
  });

  it('não mistura vendas diferentes', () => {
    const linhas = agruparLancamentosCaixa([
      venda('a', 'PDV #AAAAA - Balcão', 10, 'pix'),
      venda('b', 'PDV #BBBBB - Balcão', 20, 'pix'),
      venda('c', 'PDV #AAAAA - Balcão', 5, 'dinheiro'),
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas[0].valor).toBe(15);
    expect(linhas[1].valor).toBe(20);
  });

  it('sangria, suprimento e abertura nunca agrupam', () => {
    const linhas = agruparLancamentosCaixa([
      { id: 'a', titulo: 'Abertura', valor: 100, tipo: 'abertura', formaPagamento: 'dinheiro' },
      { id: 'b', titulo: 'Sangria #AAAAA', valor: -50, tipo: 'sangria', formaPagamento: 'dinheiro' },
      { id: 'c', titulo: 'Sangria #AAAAA', valor: -30, tipo: 'sangria', formaPagamento: 'dinheiro' },
    ] as any);
    expect(linhas).toHaveLength(3);
  });

  it('mesa ANTIGA (sem id gravado) não tem "#" e fica separada', () => {
    // Sem o id no título não dá para saber se são a mesma venda — juntar seria
    // pior do que repetir. Vale para os lançamentos antigos, que não têm
    // `orderId`; os novos agrupam pelo id (teste abaixo).
    const linhas = agruparLancamentosCaixa([
      venda('a', 'Mesa 4 - Finalizada', 30, 'pix'),
      venda('b', 'Mesa 4 - Finalizada', 20, 'dinheiro'),
    ]);
    expect(linhas).toHaveLength(2);
  });

  it('mesa NOVA agrupa pelo orderId, mesmo com o título repetido', () => {
    const linhas = agruparLancamentosCaixa([
      venda('a', 'Mesa 4 - Finalizada', 30, 'pix', { orderId: 'ped1' }),
      venda('b', 'Mesa 4 - Finalizada', 20, 'dinheiro', { orderId: 'ped1' }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].valor).toBe(50);
  });

  it('mesma mesa em comandas diferentes continua sendo duas vendas', () => {
    // O caso que o título nunca soube distinguir: "Mesa 5 - Finalizada" se
    // repete o dia inteiro. O id separa.
    const linhas = agruparLancamentosCaixa([
      venda('a', 'Mesa 5 - Finalizada', 38.4, 'debito', { orderId: 'ped1' }),
      venda('b', 'Mesa 5 - Finalizada', 28.4, 'pix', { orderId: 'ped2' }),
    ]);
    expect(linhas).toHaveLength(2);
  });

  it('encomenda agrupa pelo encomendaId', () => {
    const linhas = agruparLancamentosCaixa([
      venda('a', 'Encomenda P07RO - Entrega (Camila)', 100, 'pix', { encomendaId: 'enc1' }),
      venda('b', 'Encomenda P07RO - Entrega (Camila)', 75, 'dinheiro', { encomendaId: 'enc1' }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].valor).toBe(175);
  });

  it('o id gravado vence o "#" do título quando os dois existem', () => {
    // Dois pedidos cujos ids começam igual (prefixo de 5 chars) agrupariam
    // errado pelo título. Com o id, cada um é ele mesmo.
    const linhas = agruparLancamentosCaixa([
      venda('a', 'PDV #abcde - Balcão', 10, 'pix', { orderId: 'abcdeXXXX' }),
      venda('b', 'PDV #abcde - Balcão', 20, 'pix', { orderId: 'abcdeYYYY' }),
    ]);
    expect(linhas).toHaveLength(2);
  });

  it('cancelada não se mistura com ativa da mesma venda', () => {
    // Estado misto não deveria acontecer (cancelar cancela todas as partes),
    // mas se acontecer precisa ficar VISÍVEL, não escondido numa linha só.
    const linhas = agruparLancamentosCaixa([
      venda('a', 'PDV #WdsOe - Balcão', 50, 'dinheiro', { canceled: true }),
      venda('b', 'PDV #WdsOe - Balcão', 28, 'pix'),
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas[0].principal.canceled).toBe(true);
    expect(linhas[1].principal.canceled).toBeUndefined();
  });

  it('canceladas da mesma venda agrupam entre si', () => {
    const linhas = agruparLancamentosCaixa([
      venda('a', 'PDV #WdsOe - Balcão', 50, 'dinheiro', { canceled: true }),
      venda('b', 'PDV #WdsOe - Balcão', 28, 'pix', { canceled: true }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].valor).toBe(78);
  });

  it('o total da lista continua sendo o total dos lançamentos', () => {
    // A garantia central: agrupar é só exibição, não pode mexer em dinheiro.
    const lancamentos = [
      venda('a', 'PDV #AAAAA - Balcão', 50, 'dinheiro'),
      venda('b', 'PDV #AAAAA - Balcão', 28, 'pix'),
      venda('c', 'PDV #BBBBB - Balcão', 17, 'credito'),
      venda('d', 'Mesa 2 - Finalizada', 40, 'pix'),
    ];
    const somaOriginal = lancamentos.reduce((s, l) => s + l.valor, 0);
    const somaAgrupada = agruparLancamentosCaixa(lancamentos).reduce((s, l) => s + l.valor, 0);
    expect(somaAgrupada).toBe(somaOriginal);
    expect(somaAgrupada).toBe(135);
  });

  it('lista vazia não quebra', () => {
    expect(agruparLancamentosCaixa([])).toEqual([]);
  });
});
