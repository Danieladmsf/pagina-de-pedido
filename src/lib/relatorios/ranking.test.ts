import { describe, expect, it } from 'vitest';
import { janelaDoRelatorio } from './periodo';
import { filtrarRanking, ordenarRanking, rankingDeProdutos } from './ranking';

const AGORA = new Date(2026, 7, 20, 14, 30);
const JANELA_DO_MES = janelaDoRelatorio({ preset: 'mes_atual' }, AGORA);
const TUDO = janelaDoRelatorio({ preset: 'tudo' }, AGORA);

const emAgosto = (dia: number) => new Date(2026, 7, dia, 12, 0).toISOString();

const venda = (over: any = {}) => ({
  id: 'v1',
  status: 'delivered',
  orderDateTime: emAgosto(10),
  totalAmount: 30,
  items: [{ id: 'p1', name: 'Coxinha', quantity: 2, unitPrice: 15 }],
  ...over,
});

const CATALOGO = [
  { id: 'p1', name: 'Coxinha', categoryId: 'c1' },
  { id: 'p2', name: 'Brigadeiro', categoryId: 'c2' },
  { id: 'p3', name: 'Bolo de pote', categoryId: 'c2' },
];
const CATEGORIAS = [
  { id: 'c1', name: 'Salgados' },
  { id: 'c2', name: 'Doces' },
];

describe('rankingDeProdutos', () => {
  it('soma quantidade e valor do mesmo produto em vendas diferentes', () => {
    const r = rankingDeProdutos(
      [
        venda({ id: 'a', items: [{ id: 'p1', name: 'Coxinha', quantity: 2, unitPrice: 15 }] }),
        venda({ id: 'b', items: [{ id: 'p1', name: 'Coxinha', quantity: 3, unitPrice: 15 }] }),
      ],
      { janela: JANELA_DO_MES, catalogo: CATALOGO, categorias: CATEGORIAS },
    );

    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ nome: 'Coxinha', quantidade: 5, valor: 75, vendas: 2, categoria: 'Salgados' });
  });

  it('agrupa pelo ID mesmo com o nome escrito de outro jeito, e mostra o nome do cardápio', () => {
    const r = rankingDeProdutos(
      [
        venda({ id: 'a', items: [{ id: 'p1', name: 'coxinha de frango', quantity: 1, unitPrice: 10 }] }),
        venda({ id: 'b', items: [{ id: 'p1', name: 'COXINHA', quantity: 1, unitPrice: 10 }] }),
      ],
      { janela: JANELA_DO_MES, catalogo: CATALOGO, categorias: CATEGORIAS },
    );

    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].nome).toBe('Coxinha');
    expect(r.linhas[0].quantidade).toBe(2);
  });

  it('linha de legado sem ID vira chave própria e não é casada com um produto do cardápio', () => {
    const r = rankingDeProdutos(
      [
        venda({ id: 'a', items: [{ id: 'p1', name: 'Coxinha', quantity: 1, unitPrice: 10 }] }),
        venda({ id: 'b', items: [{ name: 'Coxinha', quantity: 4, unitPrice: 10 }] }),
      ],
      { janela: JANELA_DO_MES, catalogo: CATALOGO, categorias: CATEGORIAS },
    );

    expect(r.linhas).toHaveLength(2);
    const semId = r.linhas.find((l) => l.produtoId === null);
    expect(semId).toMatchObject({
      quantidade: 4,
      foraDoCardapio: true,
      origem: 'cardapio',
      categoria: 'Fora do cardápio',
    });
  });

  it('venda cancelada não entra em nenhum total', () => {
    const r = rankingDeProdutos([venda({ status: 'canceled' })], { janela: JANELA_DO_MES, catalogo: CATALOGO });
    expect(r.linhas).toHaveLength(0);
    expect(r.vendasConsideradas).toBe(0);
    expect(r.totalValor).toBe(0);
  });

  it('venda fora da janela não entra', () => {
    const r = rankingDeProdutos([venda({ orderDateTime: new Date(2026, 6, 10).toISOString() })], {
      janela: JANELA_DO_MES,
      catalogo: CATALOGO,
    });
    expect(r.linhas).toHaveLength(0);
  });

  it('pedido do PDV antigo, sem createdAt, entra pelo orderDateTime', () => {
    const r = rankingDeProdutos([{ ...venda(), createdAt: undefined }], {
      janela: JANELA_DO_MES,
      catalogo: CATALOGO,
    });
    expect(r.vendasConsideradas).toBe(1);
  });

  it('pedido sem orderDateTime cai no createdAt do Firestore', () => {
    const r = rankingDeProdutos(
      [{ ...venda(), orderDateTime: undefined, createdAt: { toDate: () => new Date(2026, 7, 5, 9, 0) } }],
      { janela: JANELA_DO_MES, catalogo: CATALOGO },
    );
    expect(r.vendasConsideradas).toBe(1);
    expect(r.linhas[0].quantidade).toBe(2);
  });

  it('a participação das linhas fecha em 100% do faturamento de produtos', () => {
    const r = rankingDeProdutos(
      [
        venda({ id: 'a', items: [{ id: 'p1', name: 'Coxinha', quantity: 1, unitPrice: 30 }] }),
        venda({ id: 'b', items: [{ id: 'p2', name: 'Brigadeiro', quantity: 1, unitPrice: 10 }] }),
      ],
      { janela: JANELA_DO_MES, catalogo: CATALOGO, categorias: CATEGORIAS },
    );

    expect(r.totalValor).toBe(40);
    const soma = r.linhas.reduce((s, l) => s + l.participacao, 0);
    expect(soma).toBeCloseTo(1, 10);
    expect(r.linhas.find((l) => l.nome === 'Coxinha')!.participacao).toBeCloseTo(0.75, 10);
  });

  it('produto por peso soma os gramas e não infla a quantidade', () => {
    const r = rankingDeProdutos(
      [
        venda({
          id: 'a',
          items: [{ id: 'p3', name: 'Bolo de pote', quantity: 1, unitPrice: 42.5, saleUnit: 'kg', weightGrams: 850 }],
        }),
        venda({
          id: 'b',
          items: [{ id: 'p3', name: 'Bolo de pote', quantity: 1, unitPrice: 25, saleUnit: 'kg', weightGrams: 500 }],
        }),
      ],
      { janela: JANELA_DO_MES, catalogo: CATALOGO, categorias: CATEGORIAS },
    );

    expect(r.linhas[0]).toMatchObject({ porPeso: true, quantidade: 2, gramas: 1350, valor: 67.5 });
  });

  it('o mesmo produto em duas linhas da mesma venda conta uma venda só', () => {
    const r = rankingDeProdutos(
      [
        venda({
          id: 'a',
          items: [
            { id: 'p1', name: 'Coxinha', quantity: 1, unitPrice: 10 },
            { id: 'p1', name: 'Coxinha', quantity: 2, unitPrice: 10 },
          ],
        }),
      ],
      { janela: JANELA_DO_MES, catalogo: CATALOGO },
    );

    expect(r.linhas[0]).toMatchObject({ quantidade: 3, vendas: 1 });
  });

  it('lista os produtos do cardápio que não venderam, com a última venda do histórico', () => {
    const r = rankingDeProdutos(
      [
        venda({ id: 'a', items: [{ id: 'p1', name: 'Coxinha', quantity: 1, unitPrice: 10 }] }),
        // Brigadeiro só vendeu em julho: fora da janela, mas dentro do histórico.
        venda({
          id: 'b',
          orderDateTime: new Date(2026, 6, 3, 12, 0).toISOString(),
          items: [{ id: 'p2', name: 'Brigadeiro', quantity: 5, unitPrice: 3 }],
        }),
      ],
      { janela: JANELA_DO_MES, catalogo: CATALOGO, categorias: CATEGORIAS },
    );

    expect(r.semVenda.map((p) => p.nome)).toEqual(['Bolo de pote', 'Brigadeiro']);
    expect(r.semVenda.find((p) => p.nome === 'Bolo de pote')!.ultimaVenda).toBeNull();
    expect(r.semVenda.find((p) => p.nome === 'Brigadeiro')!.ultimaVenda).toEqual(new Date(2026, 6, 3, 12, 0));
  });

  it('produto renomeado no cardápio some do ranking pelo nome antigo mas mantém a soma', () => {
    const r = rankingDeProdutos(
      [venda({ id: 'a', items: [{ id: 'p1', name: 'Coxinha simples', quantity: 4, unitPrice: 5 }] })],
      { janela: TUDO, catalogo: [{ id: 'p1', name: 'Coxinha especial', categoryId: 'c1' }], categorias: CATEGORIAS },
    );

    expect(r.linhas[0]).toMatchObject({ nome: 'Coxinha especial', quantidade: 4, valor: 20 });
  });
});

describe('ordenarRanking e filtrarRanking', () => {
  const base = rankingDeProdutos(
    [
      venda({ id: 'a', items: [{ id: 'p1', name: 'Coxinha', quantity: 10, unitPrice: 5 }] }),
      venda({ id: 'b', items: [{ id: 'p2', name: 'Brigadeiro', quantity: 2, unitPrice: 100 }] }),
    ],
    { janela: JANELA_DO_MES, catalogo: CATALOGO, categorias: CATEGORIAS },
  );

  it('ordena por quantidade e por faturamento e dá listas diferentes', () => {
    expect(ordenarRanking(base.linhas, 'quantidade').map((l) => l.nome)).toEqual(['Coxinha', 'Brigadeiro']);
    expect(ordenarRanking(base.linhas, 'valor').map((l) => l.nome)).toEqual(['Brigadeiro', 'Coxinha']);
    expect(ordenarRanking(base.linhas, 'nome').map((l) => l.nome)).toEqual(['Brigadeiro', 'Coxinha']);
  });

  it('não mexe no array original', () => {
    const antes = base.linhas.map((l) => l.nome);
    ordenarRanking(base.linhas, 'valor');
    expect(base.linhas.map((l) => l.nome)).toEqual(antes);
  });

  it('busca ignora acento e caixa, e também acha pela categoria', () => {
    expect(filtrarRanking(base.linhas, 'BRIGADEIRO').map((l) => l.nome)).toEqual(['Brigadeiro']);
    expect(filtrarRanking(base.linhas, 'salgados').map((l) => l.nome)).toEqual(['Coxinha']);
    expect(filtrarRanking(base.linhas, '')).toHaveLength(2);
  });
});
