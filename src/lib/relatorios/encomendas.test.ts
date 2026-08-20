import { describe, expect, it } from 'vitest';
import { encomendasComoVendas } from './encomendas';
import { janelaDoRelatorio } from './periodo';
import { rankingDeProdutos } from './ranking';

const AGORA = new Date(2026, 7, 20, 14, 30);
const TUDO = janelaDoRelatorio({ preset: 'tudo' }, AGORA);

const encomenda = (over: any = {}) => ({
  id: 'e1',
  status: 'confirmada',
  orderDateTime: new Date(2026, 7, 10, 12, 0).toISOString(),
  total: 240,
  bolo: { flavor: 'Olho de sogra', filling: 'Olho de sogra', size: '3 kg', weight: '3 kg', total: 240 },
  especialItems: [],
  tortasItems: [],
  docinhosItems: [],
  ...over,
});

describe('encomendasComoVendas', () => {
  it('deixa de fora a encomenda cancelada — o banco grava "cancelada", não "canceled"', () => {
    const vendas = encomendasComoVendas([
      encomenda({ id: 'a' }),
      encomenda({ id: 'b', status: 'cancelada', total: 500 }),
    ]);

    expect(vendas).toHaveLength(1);
    expect(vendas[0].id).toBe('a');
  });

  it('o bolo vira o SABOR vendido por peso, não uma linha por tamanho', () => {
    const vendas = encomendasComoVendas([
      encomenda({ id: 'a', bolo: { flavor: 'Olho de sogra', size: '3 kg', total: 240 } }),
      encomenda({ id: 'b', bolo: { flavor: 'Olho de sogra', size: '2 kg', total: 160 } }),
    ]);

    const r = rankingDeProdutos(vendas, { janela: TUDO });
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({
      nome: 'Bolo Olho de sogra',
      quantidade: 2,
      gramas: 5000,
      valor: 400,
      porPeso: true,
      origem: 'encomenda',
      categoria: 'Encomenda · Bolos',
    });
  });

  it('lê o peso do campo kg quando existe, e do rótulo quando não', () => {
    const [comKg] = encomendasComoVendas([encomenda({ bolo: { flavor: 'X', kg: 1.5, total: 100 } })]);
    const [comRotulo] = encomendasComoVendas([encomenda({ bolo: { flavor: 'X', weight: '2,5 kg', total: 100 } })]);
    expect(comKg.items![0].weightGrams).toBe(1500);
    expect(comRotulo.items![0].weightGrams).toBe(2500);
  });

  it('bolo por tamanho P/M/G não inventa quilo — vira unidade', () => {
    const [venda] = encomendasComoVendas([encomenda({ bolo: { filling: 'Brigadeiro', size: 'M', total: 200 } })]);
    expect(venda.items![0]).toMatchObject({ weightGrams: 0, saleUnit: 'un', name: 'Bolo Brigadeiro' });
  });

  it('usa os nomes que a LOJA deu às seções, não os nomes internos das listas', () => {
    // Na Gostinho de Céu o slot interno `tortas` chama "Brigadeiros".
    const catalogo = {
      products: [
        { kind: 'bolo', title: 'Bolo recheado' },
        { kind: 'tortas', title: 'Brigadeiros' },
        { kind: 'docinhos', title: 'Doces Finos' },
      ],
      tortas: [{ id: 'brigadeiro-trad', name: 'Brigadeiro', group: 'Brigadeiros Tradicionais' }],
      docinhos: [{ id: 'camafeu', name: 'Camafeu' }],
    };
    const vendas = encomendasComoVendas(
      [
        encomenda({
          tortasItems: [{ id: 'brigadeiro-trad', name: 'Brigadeiro', qty: 50, unitPrice: 1.4 }],
          docinhosItems: [{ id: 'camafeu', name: 'Camafeu', qty: 50, unitPrice: 2 }],
        }),
      ],
      { catalogo },
    );

    const grupos = vendas[0].items!.map((i) => i.grupo);
    // Item com seção própria usa a seção; sem ela, o título do slot.
    expect(grupos).toEqual(['Bolo recheado', 'Brigadeiros Tradicionais', 'Doces Finos']);
    expect(grupos).not.toContain('Tortas');
  });

  it('sem catálogo cai nos nomes de reserva em vez de quebrar', () => {
    const vendas = encomendasComoVendas([
      encomenda({ tortasItems: [{ id: 'x', name: 'Brigadeiro', qty: 50, unitPrice: 1.4 }] }),
    ]);
    expect(vendas[0].items!.map((i) => i.grupo)).toEqual(['Bolos', 'Tortas']);
  });

  it('docinho entra pelo slug do catálogo de encomenda, com prefixo que não colide com o cardápio', () => {
    const vendas = encomendasComoVendas([
      encomenda({
        bolo: null,
        total: 175,
        docinhosItems: [{ id: 'brigadeiro-tradicionais', name: 'Brigadeiro', qty: 50, unitPrice: 1.5 }],
      }),
    ]);

    expect(vendas[0].items![0]).toMatchObject({
      id: 'enc:brigadeiro-tradicionais',
      quantity: 50,
      origem: 'encomenda',
      grupo: 'Docinhos',
    });
  });

  it('produto de encomenda nunca é marcado como "fora do cardápio"', () => {
    const vendas = encomendasComoVendas([encomenda()]);
    const r = rankingDeProdutos(vendas, {
      janela: TUDO,
      catalogo: [{ id: 'p1', name: 'Coxinha', categoryId: 'c1' }],
      categorias: [{ id: 'c1', name: 'Salgados' }],
    });

    expect(r.linhas[0].foraDoCardapio).toBe(false);
    expect(r.linhas[0].origem).toBe('encomenda');
    // E não conta como produto do cardápio que deixou de vender.
    expect(r.semVenda.map((p) => p.nome)).toEqual(['Coxinha']);
  });

  it('encomenda e cardápio convivem no mesmo ranking sem se misturar', () => {
    const doCardapio = {
      id: 'v1',
      status: 'delivered',
      orderDateTime: new Date(2026, 7, 11, 12, 0).toISOString(),
      totalAmount: 30,
      items: [{ id: 'p1', name: 'Coxinha', quantity: 3, unitPrice: 10 }],
    };
    const r = rankingDeProdutos([doCardapio, ...encomendasComoVendas([encomenda()])], {
      janela: TUDO,
      catalogo: [{ id: 'p1', name: 'Coxinha', categoryId: 'c1' }],
      categorias: [{ id: 'c1', name: 'Salgados' }],
    });

    expect(r.linhas).toHaveLength(2);
    expect(r.linhas.map((l) => l.origem).sort()).toEqual(['cardapio', 'encomenda']);
    expect(r.totalValor).toBe(270);
  });

  it('encomenda sem id ou sem itens não vira linha fantasma', () => {
    expect(encomendasComoVendas([{ status: 'confirmada', total: 100 }])).toHaveLength(0);
    const vendas = encomendasComoVendas([encomenda({ bolo: null, docinhosItems: [{ name: '', qty: 1 }] })]);
    expect(vendas[0].items).toEqual([]);
  });

  it('aceita lixo no lugar da lista', () => {
    expect(encomendasComoVendas(null)).toEqual([]);
    expect(encomendasComoVendas(undefined)).toEqual([]);
  });
});
