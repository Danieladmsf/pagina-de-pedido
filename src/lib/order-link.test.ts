import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VARIANT_CODE,
  ORDER_LINK_VARIANTS,
  buildOrderLinkPath,
  buildOrderLinkPathForCode,
  cardsToCode,
  codeToCards,
  getAvailableVariants,
  getMessageVariantCode,
  resolveCardsFromParam,
} from './order-link';

// Confeitaria com encomendas ligadas e WhatsApp cadastrado: oferece tudo.
const lojaCompleta = {
  theme: 'confeitaria',
  encomendas: { enabled: true },
  general: { whatsapp: '(16) 99363-8485' },
};

// Loja comum: sem encomendas, mas com WhatsApp.
const lojaSimples = {
  theme: 'marmitaria',
  general: { whatsapp: '(16) 99279-5946' },
};

// Loja sem nada além do cardápio.
const lojaSemContato = { theme: 'pizzaria', general: {} };

describe('codigo da variante', () => {
  it('serializa na ordem canonica, nao na ordem em que foi escrito', () => {
    expect(cardsToCode(['whatsapp', 'menu'])).toBe('dw');
    expect(cardsToCode(['encomendas', 'whatsapp', 'menu'])).toBe('dew');
  });

  it('le o codigo ignorando ordem, caixa e letra desconhecida', () => {
    expect(codeToCards('ed')).toEqual(['menu', 'encomendas']);
    expect(codeToCards('DEW')).toEqual(['menu', 'encomendas', 'whatsapp']);
    expect(codeToCards('dzx')).toEqual(['menu']);
    expect(codeToCards('')).toEqual([]);
  });
});

describe('variantes disponiveis por loja', () => {
  it('a confeitaria com WhatsApp ve todas as combinacoes', () => {
    expect(getAvailableVariants(lojaCompleta)).toHaveLength(ORDER_LINK_VARIANTS.length);
  });

  it('some com as combinacoes que envolvem encomenda fora da confeitaria', () => {
    const codes = getAvailableVariants(lojaSimples).map((variant) => variant.code);

    expect(codes).toEqual(['d', 'dw']);
  });

  it('sem WhatsApp cadastrado, sobra so o cardapio', () => {
    const codes = getAvailableVariants(lojaSemContato).map((variant) => variant.code);

    expect(codes).toEqual(['d']);
  });

  it('confeitaria com encomendas desligadas perde as combinacoes de encomenda', () => {
    const codes = getAvailableVariants({ ...lojaCompleta, encomendas: { enabled: false } })
      .map((variant) => variant.code);

    expect(codes).toEqual(['d', 'dw']);
  });
});

describe('getMessageVariantCode', () => {
  it('sem nada salvo, mantem o comportamento historico (cardapio direto)', () => {
    for (const profile of [undefined, null, {}, { orderLink: {} }]) {
      expect(getMessageVariantCode(profile)).toBe(DEFAULT_VARIANT_CODE);
    }
  });

  it('descarta a opcao que a loja nao oferece mais', () => {
    // Salvou "delivery + encomendas" e depois trocou de modalidade.
    expect(getMessageVariantCode({ ...lojaSimples, orderLink: { messageVariant: 'de' } })).toBe('d');
  });

  it('nunca deixa o link apontar so para o WhatsApp', () => {
    expect(getMessageVariantCode({ ...lojaCompleta, orderLink: { messageVariant: 'w' } })).toBe('d');
  });

  it('migra o formato antigo { mode, cards }', () => {
    expect(getMessageVariantCode({ ...lojaCompleta, orderLink: { mode: 'menu' } })).toBe('d');
    expect(getMessageVariantCode({ ...lojaCompleta, orderLink: { mode: 'encomendas' } })).toBe('e');
    expect(
      getMessageVariantCode({
        ...lojaCompleta,
        orderLink: { mode: 'choice', cards: { menu: true, encomendas: true, whatsapp: false } },
      }),
    ).toBe('de');
  });
});

describe('montagem do endereco', () => {
  const base = 'https://app.com/loja-a1b2';

  it('uma opcao so vai direto ao destino, sem tela de escolha', () => {
    expect(buildOrderLinkPathForCode(base, 'd', lojaCompleta)).toBe(base);
    expect(buildOrderLinkPathForCode(base, 'e', lojaCompleta)).toBe(`${base}/encomendas`);
  });

  it('duas ou mais opcoes viram parametro na URL', () => {
    expect(buildOrderLinkPathForCode(base, 'de', lojaCompleta)).toBe(`${base}?pedir=de`);
    expect(buildOrderLinkPathForCode(base, 'dew', lojaCompleta)).toBe(`${base}?pedir=dew`);
  });

  it('poda a opcao indisponivel antes de montar', () => {
    // "delivery + encomendas" numa loja sem encomendas sobra só delivery.
    expect(buildOrderLinkPathForCode(base, 'de', lojaSimples)).toBe(base);
    // "delivery + encomendas + whatsapp" vira "delivery + whatsapp".
    expect(buildOrderLinkPathForCode(base, 'dew', lojaSimples)).toBe(`${base}?pedir=dw`);
  });

  it('o {link} das mensagens usa a variante salva', () => {
    expect(buildOrderLinkPath(base, { ...lojaCompleta, orderLink: { messageVariant: 'de' } })).toBe(`${base}?pedir=de`);
    expect(buildOrderLinkPath(base, lojaCompleta)).toBe(base);
  });
});

describe('resolveCardsFromParam', () => {
  it('sem parametro, nao abre tela nenhuma', () => {
    expect(resolveCardsFromParam(null, lojaCompleta)).toEqual([]);
    expect(resolveCardsFromParam('', lojaCompleta)).toEqual([]);
  });

  it('devolve os cards na ordem canonica', () => {
    expect(resolveCardsFromParam('wd', lojaCompleta)).toEqual(['menu', 'whatsapp']);
  });

  it('uma opcao so nao e escolha: o cliente ve o cardapio', () => {
    expect(resolveCardsFromParam('d', lojaCompleta)).toEqual([]);
    // Link antigo pedindo encomenda numa loja que nao faz mais.
    expect(resolveCardsFromParam('de', lojaSimples)).toEqual([]);
  });

  it('aceita o ?pedir=1 da primeira versao como "tudo que a loja oferece"', () => {
    expect(resolveCardsFromParam('1', lojaCompleta)).toEqual(['menu', 'encomendas', 'whatsapp']);
    expect(resolveCardsFromParam('1', lojaSimples)).toEqual(['menu', 'whatsapp']);
    expect(resolveCardsFromParam('1', lojaSemContato)).toEqual([]);
  });
});
