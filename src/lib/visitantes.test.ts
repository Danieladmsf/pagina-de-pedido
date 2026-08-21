import { describe, expect, it } from 'vitest';

import {
  LIMITE_LINHA_DO_TEMPO,
  agruparPorPessoa,
  chaveDaPessoa,
  docIdVisitante,
  ehIdentificado,
  empilharEvento,
  estadoDoVisitante,
  eventosDaSessao,
  iniciais,
  ordenarPorOportunidade,
  rankingDeProdutos,
  resumirCarrinho,
  resumoDoDia,
  visitantesParaAvatares,
  type Visitante,
} from './visitantes';

/**
 * O que estes testes protegem: a fila de trabalho da dona.
 *
 * O número do placar já era confiável; o que faltava era saber QUEM está por
 * trás dele. Um erro aqui não quebra a tela — ele manda a dona ligar para a
 * pessoa errada, ou esconde o carrinho de R$ 80 que ela ia salvar.
 */

const INICIO = 1_800_000_000_000; // abertura do caixa
const DEPOIS = INICIO + 60_000;

function visitante(parcial: Partial<Visitante>): Visitante {
  return {
    id: 'loja__v1',
    storeId: 'loja',
    visitorId: 'v1',
    ultimaVez: DEPOIS,
    ...parcial,
  };
}

describe('docIdVisitante', () => {
  it('amarra loja e visitante no id do documento', () => {
    expect(docIdVisitante('loja', 'v1')).toBe('loja__v1');
  });
});

describe('iniciais', () => {
  it('usa primeiro e último nome', () => {
    expect(iniciais('Maria Aparecida Souza')).toBe('MS');
  });
  it('nome único vira duas letras', () => {
    expect(iniciais('Wanderson')).toBe('WA');
  });
  it('sem nome não inventa', () => {
    expect(iniciais('')).toBe('?');
    expect(iniciais(undefined)).toBe('?');
  });
});

describe('ehIdentificado', () => {
  it('quem deixou nome ou telefone tem rosto', () => {
    expect(ehIdentificado(visitante({ nome: 'Ana' }))).toBe(true);
    expect(ehIdentificado(visitante({ telefone: '16999998888' }))).toBe(true);
  });
  it('espaço em branco não é identidade', () => {
    expect(ehIdentificado(visitante({ nome: '   ' }))).toBe(false);
    expect(ehIdentificado(visitante({}))).toBe(false);
  });
});

describe('estadoDoVisitante', () => {
  it('carrinho com valor e sem pedido é oportunidade', () => {
    const v = visitante({ carrinho: { itens: [{ id: 'p1', nome: 'X', qtd: 1, valor: 30 }], valor: 30, emMs: DEPOIS } });
    expect(estadoDoVisitante(v, INICIO)).toBe('abandonou');
  });

  it('quem fechou o pedido sai da fila', () => {
    const v = visitante({
      carrinho: { itens: [{ id: 'p1', nome: 'X', qtd: 1, valor: 30 }], valor: 30, emMs: DEPOIS },
      ultimoPedidoMs: DEPOIS + 5_000,
    });
    expect(estadoDoVisitante(v, INICIO)).toBe('comprou');
  });

  it('voltou e montou OUTRO carrinho depois de comprar: é oportunidade de novo', () => {
    const v = visitante({
      carrinho: { itens: [{ id: 'p2', nome: 'Y', qtd: 1, valor: 50 }], valor: 50, emMs: DEPOIS + 10_000 },
      ultimoPedidoMs: DEPOIS,
    });
    expect(estadoDoVisitante(v, INICIO)).toBe('abandonou');
  });

  it('pedido de ONTEM não faz a pessoa contar como comprou hoje', () => {
    const v = visitante({ ultimoPedidoMs: INICIO - 86_400_000 });
    expect(estadoDoVisitante(v, INICIO)).toBe('passou');
  });

  it('abriu produtos e não montou carrinho', () => {
    const v = visitante({ linhaDoTempo: [{ tipo: 'viu', at: DEPOIS, produtoId: 'p1' }] });
    expect(estadoDoVisitante(v, INICIO)).toBe('olhou');
  });

  it('carrinho zerado (esvaziou tudo) não é oportunidade', () => {
    const v = visitante({ carrinho: { itens: [], valor: 0, emMs: DEPOIS } });
    expect(estadoDoVisitante(v, INICIO)).toBe('passou');
  });
});

describe('ordenarPorOportunidade', () => {
  it('carrinho maior primeiro, depois quem só olhou, e quem comprou por último', () => {
    const comprou = visitante({ id: 'a', ultimoPedidoMs: DEPOIS });
    const carrinhoPequeno = visitante({
      id: 'b',
      carrinho: { itens: [{ id: 'p', nome: 'p', qtd: 1, valor: 20 }], valor: 20, emMs: DEPOIS },
    });
    const carrinhoGrande = visitante({
      id: 'c',
      carrinho: { itens: [{ id: 'p', nome: 'p', qtd: 1, valor: 90 }], valor: 90, emMs: DEPOIS },
    });
    const olhou = visitante({ id: 'd', linhaDoTempo: [{ tipo: 'viu', at: DEPOIS, produtoId: 'p' }] });

    const fila = ordenarPorOportunidade([comprou, carrinhoPequeno, olhou, carrinhoGrande], INICIO);
    expect(fila.map((v) => v.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('no mesmo patamar, quem deixou telefone vem antes — é para quem dá pra ligar', () => {
    const anonimo = visitante({
      id: 'anon',
      carrinho: { itens: [{ id: 'p', nome: 'p', qtd: 1, valor: 50 }], valor: 50, emMs: DEPOIS },
    });
    const conhecida = visitante({
      id: 'ana',
      nome: 'Ana',
      telefone: '16999998888',
      carrinho: { itens: [{ id: 'p', nome: 'p', qtd: 1, valor: 50 }], valor: 50, emMs: DEPOIS },
    });
    expect(ordenarPorOportunidade([anonimo, conhecida], INICIO).map((v) => v.id)).toEqual(['ana', 'anon']);
  });
});

describe('visitantesParaAvatares', () => {
  it('só gente com nome, mais recente primeiro, no máximo 4', () => {
    const lista = [
      visitante({ id: '1', nome: 'Um', ultimaVez: INICIO + 1 }),
      visitante({ id: '2' }),
      visitante({ id: '3', nome: 'Três', ultimaVez: INICIO + 3 }),
      visitante({ id: '4', nome: 'Quatro', ultimaVez: INICIO + 4 }),
      visitante({ id: '5', nome: 'Cinco', ultimaVez: INICIO + 5 }),
      visitante({ id: '6', nome: 'Seis', ultimaVez: INICIO + 6 }),
    ];
    expect(visitantesParaAvatares(lista).map((v) => v.id)).toEqual(['6', '5', '4', '3']);
  });
});

describe('resumoDoDia', () => {
  it('conta pessoas, oportunidades e conversão', () => {
    const lista = [
      visitante({ id: '1', nome: 'Ana', ultimoPedidoMs: DEPOIS }),
      visitante({ id: '2', carrinho: { itens: [{ id: 'p', nome: 'p', qtd: 1, valor: 30.5 }], valor: 30.5, emMs: DEPOIS } }),
      visitante({ id: '3', carrinho: { itens: [{ id: 'p', nome: 'p', qtd: 1, valor: 19.5 }], valor: 19.5, emMs: DEPOIS } }),
      visitante({ id: '4', linhaDoTempo: [{ tipo: 'viu', at: DEPOIS, produtoId: 'p' }] }),
    ];
    const r = resumoDoDia(lista, INICIO);
    expect(r).toMatchObject({
      pessoas: 4,
      identificadas: 1,
      comprando: 1,
      abandonados: 2,
      valorAbandonado: 50,
      olhando: 1,
      conversao: 25,
    });
  });

  it('sem ninguém não divide por zero', () => {
    expect(resumoDoDia([], INICIO).conversao).toBe(0);
  });
});

describe('resumirCarrinho', () => {
  it('soma adicionais e multiplica pela quantidade', () => {
    const carrinho = resumirCarrinho([
      { id: 'p1', name: 'Marmita', price: 20, quantity: 2, customization: { addons: [{ id: 'a', price: 2.5 }] } },
    ]);
    expect(carrinho.valor).toBe(45);
    expect(carrinho.itens[0]).toEqual({ id: 'p1', nome: 'Marmita', qtd: 2, valor: 45 });
  });

  it('preço promocional manda no valor', () => {
    expect(resumirCarrinho([{ id: 'p', name: 'X', price: 30, promoPrice: 20, quantity: 1 }]).valor).toBe(20);
  });

  it('ignora linha sem quantidade e aguenta carrinho vazio', () => {
    expect(resumirCarrinho([{ id: 'p', name: 'X', price: 10, quantity: 0 }]).itens).toHaveLength(0);
    expect(resumirCarrinho(null).valor).toBe(0);
  });
});

describe('empilharEvento', () => {
  it('não repete o mesmo produto duas vezes seguidas', () => {
    const um = empilharEvento([], { tipo: 'viu', at: 1, produtoId: 'p1' });
    const dois = empilharEvento(um, { tipo: 'viu', at: 2, produtoId: 'p1' });
    expect(dois).toHaveLength(1);
  });

  it('produto diferente entra', () => {
    const um = empilharEvento([], { tipo: 'viu', at: 1, produtoId: 'p1' });
    expect(empilharEvento(um, { tipo: 'viu', at: 2, produtoId: 'p2' })).toHaveLength(2);
  });

  it('corta pelo começo para o documento não crescer sem fim', () => {
    let linha = [] as any[];
    for (let i = 0; i < LIMITE_LINHA_DO_TEMPO + 10; i++) {
      linha = empilharEvento(linha, { tipo: 'viu', at: i, produtoId: `p${i}` });
    }
    expect(linha).toHaveLength(LIMITE_LINHA_DO_TEMPO);
    expect(linha[linha.length - 1].produtoId).toBe(`p${LIMITE_LINHA_DO_TEMPO + 9}`);
  });
});

describe('eventosDaSessao', () => {
  it('alinha o relógio do cliente pela hora do servidor', () => {
    // Celular 3 horas adiantado: sem o ajuste, os eventos cairiam fora da sessão.
    const desvio = 3 * 3600_000;
    const v = visitante({
      ultimaVez: DEPOIS,
      linhaDoTempo: [
        { tipo: 'viu', at: DEPOIS + desvio - 10_000, produtoId: 'p1' },
        { tipo: 'viu', at: DEPOIS + desvio, produtoId: 'p2' },
      ],
    });
    const eventos = eventosDaSessao(v, INICIO);
    expect(eventos).toHaveLength(2);
    expect(eventos[0].produtoId).toBe('p2'); // mais novo primeiro
    expect(eventos[0].at).toBe(DEPOIS);
  });

  it('deixa de fora o que é de antes da abertura do caixa', () => {
    const v = visitante({
      ultimaVez: DEPOIS,
      linhaDoTempo: [
        { tipo: 'viu', at: DEPOIS - 86_400_000, produtoId: 'ontem' },
        { tipo: 'viu', at: DEPOIS, produtoId: 'hoje' },
      ],
    });
    expect(eventosDaSessao(v, INICIO).map((e) => e.produtoId)).toEqual(['hoje']);
  });
});

describe('rankingDeProdutos', () => {
  it('separa cliques de pessoas e mostra o que está parado no carrinho', () => {
    const lista = [
      visitante({
        id: 'a',
        linhaDoTempo: [
          { tipo: 'viu', at: 1, produtoId: 'p1', produtoNome: 'Bolo' },
          { tipo: 'viu', at: 2, produtoId: 'p2', produtoNome: 'Torta' },
          { tipo: 'viu', at: 3, produtoId: 'p1', produtoNome: 'Bolo' },
        ],
        carrinho: { itens: [{ id: 'p1', nome: 'Bolo', qtd: 2, valor: 80 }], valor: 80, emMs: DEPOIS },
      }),
      visitante({
        id: 'b',
        linhaDoTempo: [{ tipo: 'viu', at: 1, produtoId: 'p1', produtoNome: 'Bolo' }],
      }),
    ];
    const ranking = rankingDeProdutos(lista);
    expect(ranking[0]).toMatchObject({ id: 'p1', nome: 'Bolo', vistas: 3, pessoas: 2, noCarrinho: 2, valorParado: 80 });
    expect(ranking[1]).toMatchObject({ id: 'p2', vistas: 1, pessoas: 1, noCarrinho: 0 });
  });
});

describe('agruparPorPessoa', () => {
  it('junta as aberturas do link do WhatsApp numa pessoa só', () => {
    // O caso real: sete documentos da mesma cliente no mesmo dia, cada um com
    // um visitorId (o webview do WhatsApp perde o storage a cada clique) — e
    // sete vezes a mesma foto empilhada no placar.
    const lista = [1, 2, 3, 4].map((n) =>
      visitante({
        id: `loja__v${n}`,
        visitorId: `v${n}`,
        ultimaVez: DEPOIS + n * 60_000,
        nome: 'Agda Ezequiel',
        telefone: '16991644249',
        clienteId: 'loja_16991644249',
        viaLink: true,
      })
    );
    const pessoas = agruparPorPessoa(lista);
    expect(pessoas).toHaveLength(1);
    expect(pessoas[0].id).toBe('loja__v4'); // representante é a visita mais recente
    expect(pessoas[0].sessoes).toBe(4); // cada abertura continua contando
    expect(visitantesParaAvatares(pessoas)).toHaveLength(1);
  });

  it('não junta anônimos: sem identidade, cada navegador é uma pessoa', () => {
    const lista = [
      visitante({ id: 'a', visitorId: 'va' }),
      visitante({ id: 'b', visitorId: 'vb' }),
    ];
    expect(agruparPorPessoa(lista)).toHaveLength(2);
  });

  it('casa o telefone com e sem o +55 e ignora a formatação', () => {
    expect(chaveDaPessoa(visitante({ telefone: '5516991644249' }))).toBe(
      chaveDaPessoa(visitante({ telefone: '(16) 99164-4249' }))
    );
  });

  it('nome não é chave: dois cadastros diferentes não viram um', () => {
    const lista = [
      visitante({ id: 'a', visitorId: 'va', nome: 'Maria Silva', telefone: '16991111111' }),
      visitante({ id: 'b', visitorId: 'vb', nome: 'Maria Silva', telefone: '16992222222' }),
    ];
    expect(agruparPorPessoa(lista)).toHaveLength(2);
  });

  it('telefone digitado em qualquer visita derruba o "provável" do link', () => {
    const lista = [
      visitante({ id: 'a', visitorId: 'va', telefone: '16991644249', viaLink: true, ultimaVez: DEPOIS + 60_000 }),
      visitante({ id: 'b', visitorId: 'vb', telefone: '16991644249', viaLink: false, nome: 'Agda' }),
    ];
    const [pessoa] = agruparPorPessoa(lista);
    expect(pessoa.viaLink).toBe(false);
    expect(pessoa.nome).toBe('Agda'); // nome cheio não é apagado pelo doc sem nome
  });

  it('soma a linha do tempo alinhando o relógio de cada aparelho', () => {
    const lista = [
      visitante({
        id: 'a',
        visitorId: 'va',
        telefone: '16991644249',
        ultimaVez: DEPOIS,
        // Celular adiantado em um dia: sem o alinhamento, "Bolo" iria para o fim.
        linhaDoTempo: [{ tipo: 'viu', at: DEPOIS + 86_400_000, produtoId: 'p1', produtoNome: 'Bolo' }],
      }),
      visitante({
        id: 'b',
        visitorId: 'vb',
        telefone: '16991644249',
        ultimaVez: DEPOIS + 120_000,
        linhaDoTempo: [{ tipo: 'viu', at: DEPOIS + 120_000, produtoId: 'p2', produtoNome: 'Torta' }],
      }),
    ];
    const [pessoa] = agruparPorPessoa(lista);
    expect((pessoa.linhaDoTempo || []).map((e) => e.produtoId)).toEqual(['p1', 'p2']);
    expect(eventosDaSessao(pessoa, INICIO).map((e) => e.produtoId)).toEqual(['p2', 'p1']);
  });

  it('mantém a sacola parada quando ela é da visita mais recente', () => {
    const lista = [
      visitante({
        id: 'a',
        visitorId: 'va',
        telefone: '16991644249',
        ultimaVez: DEPOIS,
        ultimoPedidoMs: DEPOIS,
        ultimoPedidoId: 'ped1',
        pedidos: 1,
      }),
      visitante({
        id: 'b',
        visitorId: 'vb',
        telefone: '16991644249',
        ultimaVez: DEPOIS + 120_000,
        carrinho: { itens: [{ id: 'p1', nome: 'Bolo', qtd: 1, valor: 40 }], valor: 40, emMs: DEPOIS + 120_000 },
      }),
    ];
    const [pessoa] = agruparPorPessoa(lista);
    expect(estadoDoVisitante(pessoa, INICIO)).toBe('abandonou');
    expect(pessoa.carrinho?.valor).toBe(40);
    expect(pessoa.ultimoPedidoId).toBe('ped1'); // o pedido não se perde no caminho
  });

  it('descarta a sacola que virou pedido numa abertura posterior', () => {
    const lista = [
      visitante({
        id: 'a',
        visitorId: 'va',
        telefone: '16991644249',
        ultimaVez: DEPOIS,
        carrinho: { itens: [{ id: 'p1', nome: 'Bolo', qtd: 1, valor: 40 }], valor: 40, emMs: DEPOIS },
      }),
      visitante({
        id: 'b',
        visitorId: 'vb',
        telefone: '16991644249',
        ultimaVez: DEPOIS + 120_000,
        // Relógio do outro aparelho atrasado (ainda dentro da sessão de caixa):
        // quem decide qual das duas visitas veio depois é a hora do servidor.
        ultimoPedidoMs: DEPOIS - 30_000,
        ultimoPedidoValor: 40,
        pedidos: 1,
      }),
    ];
    const [pessoa] = agruparPorPessoa(lista);
    expect(estadoDoVisitante(pessoa, INICIO)).toBe('comprou');
    expect(pessoa.carrinho?.itens).toEqual([]);
  });

  it('o resumo passa a contar gente, não aberturas de cardápio', () => {
    const lista = [1, 2, 3].map((n) =>
      visitante({ id: `v${n}`, visitorId: `v${n}`, telefone: '16991644249', nome: 'Agda' })
    );
    expect(resumoDoDia(lista, INICIO).pessoas).toBe(3);
    expect(resumoDoDia(agruparPorPessoa(lista), INICIO).pessoas).toBe(1);
  });
});
