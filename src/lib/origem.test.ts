import { describe, expect, it } from 'vitest';

import {
  ORIGEM_DIRETA_LABEL,
  ORIGEM_TAMANHO_MAX,
  adicionarOrigem,
  agruparPorOrigem,
  campanhaDaOrigem,
  canalDaOrigem,
  extrairOrigem,
  montarOrigem,
  normalizarOrigem,
  rotuloDaOrigem,
} from './origem';

/**
 * O que estes testes protegem: a tabela de "de onde veio a venda".
 *
 * Erro aqui não quebra tela nenhuma — ele faz a dona desligar a divulgação
 * certa. Duas grafias da mesma campanha viram duas linhas com metade do valor
 * cada, e contar pelo último clique faz o WhatsApp levar o crédito do Instagram.
 */

describe('normalizarOrigem', () => {
  it('tira acento, espaço e maiúscula: a mesma campanha é uma linha só', () => {
    expect(normalizarOrigem('Post Dia das Mães')).toBe('post-dia-das-maes');
    expect(normalizarOrigem('  INSTAGRAM  ')).toBe('instagram');
    expect(normalizarOrigem('Teste 1')).toBe(normalizarOrigem('teste-1'));
  });

  it('não deixa sobrar hífen solto nem passar do limite gravado', () => {
    expect(normalizarOrigem('--instagram--')).toBe('instagram');
    expect(normalizarOrigem('a'.repeat(80)).length).toBe(ORIGEM_TAMANHO_MAX);
    expect(normalizarOrigem('#!@')).toBe('');
    expect(normalizarOrigem(null)).toBe('');
  });

  it('corte no limite não deixa hífen no fim', () => {
    const longa = `${'a'.repeat(ORIGEM_TAMANHO_MAX - 1)}-bcd`;
    expect(normalizarOrigem(longa).endsWith('-')).toBe(false);
  });
});

describe('canal e campanha', () => {
  it('separa o canal fechado da parte livre', () => {
    expect(canalDaOrigem('instagram-post-dia-das-maes')).toBe('instagram');
    expect(campanhaDaOrigem('instagram-post-dia-das-maes')).toBe('post-dia-das-maes');
    expect(canalDaOrigem('instagram')).toBe('instagram');
    expect(campanhaDaOrigem('instagram')).toBe('');
  });

  it('marca inventada não cria canal novo', () => {
    // Alguém mexendo no link não pode poluir a soma por canal.
    expect(canalDaOrigem('xyz-qualquer-coisa')).toBe('outro');
    expect(canalDaOrigem('')).toBe('');
  });

  it('monta a marca a partir do que a loja escolheu na tela', () => {
    expect(montarOrigem('instagram', 'Bio')).toBe('instagram-bio');
    expect(montarOrigem('instagram', '')).toBe('instagram');
    expect(montarOrigem('', 'bio')).toBe('');
  });

  it('escreve para a dona ler, não para o banco', () => {
    expect(rotuloDaOrigem('instagram-bio')).toBe('Instagram · bio');
    expect(rotuloDaOrigem('embalagem')).toBe('Embalagem');
    expect(rotuloDaOrigem('')).toBe(ORIGEM_DIRETA_LABEL);
  });
});

describe('no link', () => {
  it('acrescenta a marca sem atropelar o ?pedir', () => {
    expect(adicionarOrigem('https://x.com/loja-a1b2?pedir=de', 'Instagram')).toBe(
      'https://x.com/loja-a1b2?pedir=de&via=instagram'
    );
    expect(adicionarOrigem('https://x.com/loja-a1b2', 'panfleto')).toBe(
      'https://x.com/loja-a1b2?via=panfleto'
    );
  });

  it('não duplica a marca e respeita o hash', () => {
    expect(adicionarOrigem('https://x.com/loja?via=instagram', 'panfleto')).toBe(
      'https://x.com/loja?via=instagram'
    );
    expect(adicionarOrigem('https://x.com/loja#cardapio', 'qr')).toBe(
      'https://x.com/loja?via=qr#cardapio'
    );
  });

  it('sem origem o link fica intocado — é o link público de sempre', () => {
    expect(adicionarOrigem('https://x.com/loja', '')).toBe('https://x.com/loja');
  });

  it('lê a marca já normalizada da URL', () => {
    expect(extrairOrigem(new URLSearchParams('?via=Instagram'))).toBe('instagram');
    expect(extrairOrigem(new URLSearchParams('?pedir=de'))).toBe('');
  });
});

describe('agruparPorOrigem', () => {
  const pessoa = (parcial: any) => ({ linhaDoTempo: [], ...parcial });

  it('conta pela PRIMEIRA origem: o último clique não rouba o crédito', () => {
    // Descobriu a loja no Instagram e voltou pelo link do WhatsApp. Quem
    // trouxe essa pessoa foi o Instagram.
    const linhas = agruparPorOrigem([
      pessoa({ origemPrimeira: 'instagram', origemUltima: 'whatsapp', pedidos: 1 }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].origem).toBe('instagram');
    expect(linhas[0].pedidos).toBe(1);
  });

  it('quem chegou sem marca vira uma linha honesta, não some da conta', () => {
    const linhas = agruparPorOrigem([pessoa({}), pessoa({})]);
    expect(linhas[0].origem).toBe('direto');
    expect(linhas[0].pessoas).toBe(2);
    expect(linhas[0].rotulo).toBe(ORIGEM_DIRETA_LABEL);
  });

  it('mede o funil por origem e ordena por quem trouxe pedido', () => {
    const linhas = agruparPorOrigem([
      pessoa({ origemPrimeira: 'instagram', linhaDoTempo: [{ tipo: 'viu' }] }),
      pessoa({ origemPrimeira: 'instagram', pedidos: 2 }),
      pessoa({
        origemPrimeira: 'panfleto',
        carrinho: { itens: [{ id: 'p1' }], valor: 40 },
      }),
    ]);
    expect(linhas[0]).toMatchObject({
      origem: 'instagram',
      pessoas: 2,
      olharam: 1,
      pedidos: 1,
      conversao: 50,
    });
    expect(linhas[1]).toMatchObject({ origem: 'panfleto', carrinhos: 1, pedidos: 0 });
  });
});
