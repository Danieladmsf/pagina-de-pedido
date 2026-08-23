import { describe, expect, it } from 'vitest';

import { receitaPorOrigem, type PessoaComOrigem, type VendaLigavel } from './receita-por-origem';

/**
 * O que estes testes protegem: a resposta para "onde vale a pena divulgar".
 *
 * Errar aqui não quebra tela — faz a dona cortar o canal que traz dinheiro, ou
 * pagar por um que não traz. E a soma tem que fechar: origens + sem
 * identificação = faturamento do período.
 */

const pessoa = (p: Partial<PessoaComOrigem> & { id: string }): PessoaComOrigem => ({ ...p, id: p.id });
const venda = (v: VendaLigavel): VendaLigavel => v;

describe('receitaPorOrigem', () => {
  it('conta a venda que fechou em OUTRO canal para a origem que trouxe a pessoa', () => {
    // O caso real da Gostinho: veio pelo Instagram, olhou o cardápio e fechou
    // no balcão. O cardápio não "converteu", mas o Instagram vendeu.
    const resultado = receitaPorOrigem(
      [pessoa({ id: 'v1', clienteId: 'cli1', origemPrimeira: 'instagram' })],
      [venda({ id: 'p1', clienteId: 'cli1', total: 80 })]
    );
    expect(resultado.linhas[0]).toMatchObject({
      origem: 'instagram',
      pedidos: 1,
      receita: 80,
      ticket: 80,
      compraram: 1,
      conversao: 100,
    });
    expect(resultado.pedidosSoltos).toBe(0);
  });

  it('a conta fecha: origens mais sem identificação = faturamento', () => {
    const resultado = receitaPorOrigem(
      [pessoa({ id: 'v1', clienteId: 'cli1', origemPrimeira: 'instagram' })],
      [
        venda({ id: 'p1', clienteId: 'cli1', total: 80 }),
        venda({ id: 'p2', total: 40 }), // balcão, sem cliente
        venda({ id: 'p3', clienteId: 'quem-nunca-visitou', total: 25 }),
      ]
    );
    const somaDasLinhas = resultado.linhas.reduce((s, l) => s + l.receita, 0);
    expect(somaDasLinhas).toBe(80);
    expect(resultado.receitaSolta).toBe(65);
    expect(somaDasLinhas + resultado.receitaSolta).toBe(145);
    expect(resultado.pedidosSoltos).toBe(2);
  });

  it('casa pelo telefone quando não há id, sem se importar com a formatação', () => {
    const resultado = receitaPorOrigem(
      [pessoa({ id: 'v1', telefone: '16991644249', origemPrimeira: 'panfleto' })],
      [venda({ id: 'p1', telefone: '(16) 99164-4249', total: 30 })]
    );
    expect(resultado.linhas[0]).toMatchObject({ origem: 'panfleto', receita: 30 });
  });

  it('id manda no telefone', () => {
    // Mesmo pedido com id de uma pessoa e telefone de outra: vence o id.
    const resultado = receitaPorOrigem(
      [
        pessoa({ id: 'v1', clienteId: 'cli1', origemPrimeira: 'instagram' }),
        pessoa({ id: 'v2', telefone: '16991644249', origemPrimeira: 'panfleto' }),
      ],
      [venda({ id: 'p1', clienteId: 'cli1', telefone: '16991644249', total: 50 })]
    );
    const instagram = resultado.linhas.find((l) => l.origem === 'instagram');
    const panfleto = resultado.linhas.find((l) => l.origem === 'panfleto');
    expect(instagram?.receita).toBe(50);
    expect(panfleto?.receita).toBe(0);
  });

  it('telefone repetido em duas pessoas não escolhe dono no chute', () => {
    const resultado = receitaPorOrigem(
      [
        pessoa({ id: 'v1', telefone: '16991644249', origemPrimeira: 'instagram' }),
        pessoa({ id: 'v2', telefone: '16991644249', origemPrimeira: 'panfleto' }),
      ],
      [venda({ id: 'p1', telefone: '16991644249', total: 50 })]
    );
    expect(resultado.pedidosSoltos).toBe(1);
    expect(resultado.receitaLigada).toBe(0);
  });

  it('conta pela PRIMEIRA origem: o último clique não leva o crédito', () => {
    const resultado = receitaPorOrigem(
      [pessoa({ id: 'v1', clienteId: 'cli1', origemPrimeira: 'instagram-bio', origemUltima: 'whatsapp' })],
      [venda({ id: 'p1', clienteId: 'cli1', total: 60 })]
    );
    expect(resultado.linhas[0].origem).toBe('instagram-bio');
    expect(resultado.linhas[0].rotulo).toBe('Instagram · bio');
  });

  it('quem chegou sem marca aparece como "direto", não some', () => {
    const resultado = receitaPorOrigem(
      [pessoa({ id: 'v1', clienteId: 'cli1' })],
      [venda({ id: 'p1', clienteId: 'cli1', total: 20 })]
    );
    expect(resultado.linhas[0].origem).toBe('direto');
    expect(resultado.linhas[0].receita).toBe(20);
  });

  it('ticket é por pedido e a pessoa que comprou duas vezes conta uma vez', () => {
    const resultado = receitaPorOrigem(
      [
        pessoa({ id: 'v1', clienteId: 'cli1', origemPrimeira: 'instagram' }),
        pessoa({ id: 'v2', clienteId: 'cli2', origemPrimeira: 'instagram' }),
      ],
      [
        venda({ id: 'p1', clienteId: 'cli1', total: 100 }),
        venda({ id: 'p2', clienteId: 'cli1', total: 50 }),
      ]
    );
    expect(resultado.linhas[0]).toMatchObject({
      pessoas: 2,
      pedidos: 2,
      receita: 150,
      ticket: 75,
      compraram: 1,
      conversao: 50, // uma das duas pessoas comprou
    });
  });

  it('ordena pelo que trouxe mais dinheiro', () => {
    const resultado = receitaPorOrigem(
      [
        pessoa({ id: 'v1', clienteId: 'c1', origemPrimeira: 'instagram' }),
        pessoa({ id: 'v2', clienteId: 'c2', origemPrimeira: 'embalagem' }),
        pessoa({ id: 'v3', clienteId: 'c3', origemPrimeira: 'facebook' }),
      ],
      [
        venda({ clienteId: 'c1', total: 10 }),
        venda({ clienteId: 'c2', total: 300 }),
      ]
    );
    expect(resultado.linhas.map((l) => l.origem)).toEqual(['embalagem', 'instagram', 'facebook']);
  });

  it('centavos não viram dízima na soma', () => {
    const resultado = receitaPorOrigem(
      [pessoa({ id: 'v1', clienteId: 'c1', origemPrimeira: 'instagram' })],
      [venda({ clienteId: 'c1', total: 18.9 }), venda({ clienteId: 'c1', total: 0.1 })]
    );
    expect(resultado.linhas[0].receita).toBe(19);
    expect(resultado.linhas[0].ticket).toBe(9.5);
  });
});
