import { describe, expect, it } from 'vitest';

import {
  MOVEMENT_LABELS,
  StockMovementError,
  buildMovementsCsv,
  computeMovement,
  parseQuantity,
  type HistoryRow,
} from './stock-movements';

/**
 * O que estes testes protegem: a conta do estoque sair da cabeça da dona.
 *
 * Caso real (Gostinho de Céu, jul/2026). Ela repunha digitando o TOTAL: "tem 15
 * brigadeiros, tá saindo mais 15, eu atualizo para 30". Isso é ler um número,
 * somar de cabeça e reescrever — em cima de um valor que muda sozinho a cada
 * venda. Se saíssem 2 unidades entre o ler e o digitar, nasciam 2 unidades
 * fantasma. Foi assim que o ESPETÃO ficou marcando 3 no sistema com 0 na
 * prateleira.
 *
 * A regra: ela informa QUANTO entrou ou saiu; quem soma é o sistema, dentro da
 * transação. "Ajuste" continua existindo para a contagem física, e aí sim o
 * número digitado é o total.
 */

describe('parseQuantity', () => {
  it('aceita inteiro positivo', () => {
    expect(parseQuantity('15')).toBe(15);
    expect(parseQuantity(15)).toBe(15);
    expect(parseQuantity('0')).toBe(0);
  });

  it('recusa negativo, vazio e texto', () => {
    expect(parseQuantity('-3')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('   ')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity(null)).toBeNull();
  });

  it('trunca decimal', () => {
    expect(parseQuantity('4,9')).toBe(4);
    expect(parseQuantity('4.9')).toBe(4);
  });
});

describe('computeMovement — entrada', () => {
  it('SOMA ao que existe, em vez de substituir (o bug das unidades fantasma)', () => {
    // Ela vê 15 na tela e produz mais 15. Se 2 tiverem sido vendidas nesse meio
    // tempo, o estoque real é 13 — e a entrada de 15 tem que dar 28, não 30.
    expect(computeMovement('entrada', 13, 15)).toEqual({ stockAfter: 28, delta: 15 });
  });

  it('em produto sem controle, a entrada inicia o controle', () => {
    expect(computeMovement('entrada', null, 10)).toEqual({ stockAfter: 10, delta: 10 });
  });

  it('não aceita entrada de zero', () => {
    expect(() => computeMovement('entrada', 5, 0)).toThrow(StockMovementError);
  });
});

describe('computeMovement — saida', () => {
  it('subtrai do que existe', () => {
    expect(computeMovement('saida', 10, 4)).toEqual({ stockAfter: 6, delta: -4 });
  });

  it('deixa zerar exatamente', () => {
    expect(computeMovement('saida', 4, 4)).toEqual({ stockAfter: 0, delta: -4 });
  });

  it('NUNCA deixa negativo: barra saída maior que o estoque', () => {
    expect(() => computeMovement('saida', 3, 5)).toThrow(/Só há 3 unidade/);
  });

  it('não faz sentido em produto sem controle', () => {
    expect(() => computeMovement('saida', null, 1)).toThrow(/sem controle de estoque/);
  });
});

describe('"ajuste" foi aposentado', () => {
  /**
   * Digitar o TOTAL era o modelo antigo: sobrescreve a venda que entrou entre
   * contar e salvar — o mesmo mecanismo das unidades fantasma. Correção de
   * contagem agora é lançada como diferença (entrada ou saída). O tipo sobrevive
   * só como rótulo, porque já existem lançamentos gravados com ele.
   */
  it('não é aceito como movimentação nova', () => {
    expect(() => computeMovement('ajuste' as any, 3, 12)).toThrow(StockMovementError);
  });

  it('não cai calado na regra de saída', () => {
    expect(() => computeMovement('ajuste' as any, 10, 4)).toThrow(/inválido/i);
  });

  it('continua tendo rótulo, para o histórico antigo permanecer legível', () => {
    expect(MOVEMENT_LABELS.ajuste).toBe('Ajuste');
  });
});

describe('computeMovement — sem_controle', () => {
  /**
   * É a ÚNICA porta de saída do controle de estoque desde que o campo saiu do
   * cadastro do produto. Sem ela, começar a contar um produto por engano seria
   * irreversível pela interface.
   */
  it('desliga a contagem e devolve o que estava contado como saída', () => {
    expect(computeMovement('sem_controle', 12, 0)).toEqual({ stockAfter: null, delta: -12 });
  });

  it('funciona mesmo em produto que já estava sem controle', () => {
    expect(computeMovement('sem_controle', null, 0)).toEqual({ stockAfter: null, delta: 0 });
  });

  it('ignora a quantidade digitada', () => {
    expect(computeMovement('sem_controle', 5, 999)).toEqual({ stockAfter: null, delta: -5 });
  });
});

describe('computeMovement — validação geral', () => {
  it('recusa quantidade negativa em qualquer tipo', () => {
    expect(() => computeMovement('entrada', 5, -1)).toThrow(StockMovementError);
    expect(() => computeMovement('saida', 5, -1)).toThrow(StockMovementError);
  });
});

describe('buildMovementsCsv', () => {
  const rows: HistoryRow[] = [
    {
      id: '1',
      date: new Date('2026-07-29T14:00:00'),
      itemId: 'p1',
      itemName: 'Brigadeiro',
      kind: 'entrada',
      delta: 15,
      stockBefore: 13,
      stockAfter: 28,
      note: 'produção da tarde',
      userName: 'Camila',
    },
    {
      id: '2',
      date: new Date('2026-07-29T15:00:00'),
      itemId: 'p1',
      itemName: 'Brigadeiro',
      kind: 'venda',
      delta: -2,
      stockBefore: null,
      stockAfter: null,
      note: 'Pedido #4ZJB6',
      userName: 'Cardápio',
    },
  ];

  it('abre certo no Excel brasileiro (BOM + ponto-e-vírgula)', () => {
    const csv = buildMovementsCsv(rows, 'Gostinho de Céu');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Data;Hora;Produto;Tipo;Quantidade');
  });

  it('totaliza o que entrou e o que saiu', () => {
    const csv = buildMovementsCsv(rows, 'Loja');
    expect(csv).toContain('Total que entrou;15');
    expect(csv).toContain('Total que saiu;2');
  });

  it('mostra o sinal da movimentação e traduz o tipo', () => {
    const csv = buildMovementsCsv(rows, 'Loja');
    expect(csv).toContain('Entrada;+15');
    expect(csv).toContain('Venda;-2');
  });

  it('escapa ponto-e-vírgula da observação para não quebrar coluna', () => {
    const csv = buildMovementsCsv(
      [{ ...rows[0], note: 'quebrou; refiz' }],
      'Loja',
    );
    expect(csv).toContain('"quebrou; refiz"');
  });

  it('registra o periodo exportado no cabecalho', () => {
    const csv = buildMovementsCsv(rows, 'Loja', '01/07/2026 a 31/07/2026');
    expect(csv).toContain('Período;01/07/2026 a 31/07/2026');
  });

  it('aguenta lista vazia', () => {
    expect(() => buildMovementsCsv([], 'Loja')).not.toThrow();
  });
});
