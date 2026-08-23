import { describe, expect, it } from 'vitest';

import { LIMITE_DE_AVISOS, avisosDoCardapio, type EntradaDosAvisos } from './avisos-do-cardapio';

/**
 * O que estes testes protegem: a única parte da tela que a dona lê todo dia.
 *
 * Aviso demais vira painel, e painel ninguém abre. Aviso de menos esconde o
 * telefonema que ainda pega a venda de hoje.
 */

const vazio: EntradaDosAvisos = {
  origens: [],
  portaFechada: { visitas: 0, fatia: 0, horas: [], dias: [] },
  buscas: [],
  carrinhosParados: 0,
  valorParado: 0,
  periodo: 'hoje',
};

const origem = (parcial: any) => ({
  origem: 'instagram',
  rotulo: 'Instagram',
  canal: 'instagram',
  pessoas: 0,
  olharam: 0,
  compraram: 0,
  pedidos: 0,
  receita: 0,
  ticket: 0,
  conversao: 0,
  ...parcial,
});

describe('avisosDoCardapio', () => {
  it('loja parada não inventa aviso', () => {
    expect(avisosDoCardapio(vazio)).toEqual([]);
  });

  it('dinheiro na sacola vem antes de qualquer análise', () => {
    const avisos = avisosDoCardapio({
      ...vazio,
      carrinhosParados: 3,
      valorParado: 350,
      origens: [origem({ pessoas: 40, receita: 900, pedidos: 12 })],
      portaFechada: { visitas: 30, fatia: 20, horas: [{ hora: 18, visitas: 28 }], dias: [{ dia: 3, visitas: 10 }] },
    });
    expect(avisos[0].id).toBe('carrinho-parado');
    expect(avisos[0].tom).toBe('acao');
    expect(avisos[0].texto).toContain('R$ 350,00');
  });

  it('avisa quando um canal traz gente e não traz pedido', () => {
    const avisos = avisosDoCardapio({
      ...vazio,
      periodo: 'os últimos 7 dias',
      origens: [origem({ pessoas: 30, pedidos: 0 })],
    });
    expect(avisos[0].texto).toBe(
      'Instagram trouxe 30 pessoas em os últimos 7 dias e nenhuma comprou. Vale rever o que esse link mostra primeiro.'
    );
  });

  it('uma pessoa só não é padrão: abaixo do piso não vira aviso', () => {
    const avisos = avisosDoCardapio({
      ...vazio,
      origens: [origem({ pessoas: 2, pedidos: 0 })],
      buscas: [{ termo: 'brigadeiro', pessoas: 1, vezes: 1 }],
      portaFechada: { visitas: 2, fatia: 3, horas: [{ hora: 22, visitas: 2 }], dias: [{ dia: 0, visitas: 2 }] },
    });
    expect(avisos).toEqual([]);
  });

  it('diz também o que está dando certo', () => {
    const avisos = avisosDoCardapio({
      ...vazio,
      periodo: 'os últimos 30 dias',
      origens: [origem({ origem: 'panfleto', rotulo: 'Panfleto', pessoas: 12, pedidos: 6, receita: 320 })],
    });
    expect(avisos[0].tom).toBe('bom');
    expect(avisos[0].texto).toContain('R$ 320,00');
  });

  it('porta fechada só vira aviso quando junta gente na mesma hora', () => {
    const avisos = avisosDoCardapio({
      ...vazio,
      portaFechada: {
        visitas: 40,
        fatia: 19,
        horas: [{ hora: 18, visitas: 28 }],
        dias: [{ dia: 3, visitas: 12 }],
      },
    });
    expect(avisos[0].texto).toContain('28 pessoas abriram o cardápio às 18h');
    expect(avisos[0].texto).toContain('quarta');
  });

  it('nunca passa de três — senão vira painel de novo', () => {
    const avisos = avisosDoCardapio({
      periodo: 'hoje',
      carrinhosParados: 2,
      valorParado: 200,
      origens: [
        origem({ origem: 'instagram', rotulo: 'Instagram', pessoas: 30, pedidos: 0 }),
        origem({ origem: 'panfleto', rotulo: 'Panfleto', pessoas: 10, pedidos: 4, receita: 400 }),
      ],
      portaFechada: { visitas: 20, fatia: 15, horas: [{ hora: 19, visitas: 9 }], dias: [{ dia: 1, visitas: 6 }] },
      buscas: [{ termo: 'coxinha', pessoas: 5, vezes: 9 }],
    });
    expect(avisos).toHaveLength(LIMITE_DE_AVISOS);
    expect(avisos.map((a) => a.id)).toEqual([
      'carrinho-parado',
      'origem-sem-venda-instagram',
      'origem-campea-panfleto',
    ]);
  });

  it('"direto ou sem marca" não vira canal de divulgação nenhum', () => {
    // Não dá para "insistir" em quem chegou sem marca — não é lugar nenhum.
    const avisos = avisosDoCardapio({
      ...vazio,
      origens: [origem({ origem: 'direto', rotulo: 'Direto ou sem marca', pessoas: 90, pedidos: 0, receita: 500 })],
    });
    expect(avisos).toEqual([]);
  });
});
