import { beforeEach, describe, expect, it } from 'vitest';

import {
  FANTASMA_TTL_MS,
  LIMPEZA_POR_RODADA,
  ONLINE_TTL_MS,
  _limparMarcasEmMemoria,
  classificarSessoes,
  ehIdDeLojaResolvido,
  marcarVisitaDaSessao,
  paraMillis,
  CHAVE_DISPOSITIVO_INTERNO,
  CHAVE_VISITOR_ID,
  ehVisitaDaPropriaLoja,
  marcarDispositivoDaLoja,
  obterVisitorId,
} from './audience';

/**
 * O que estes testes protegem: o número de clientes online e o placar de visitas.
 *
 * Casos reais medidos em 12/08/2026, antes da correção:
 * - 2.954 documentos em `active_sessions`, TODOS mortos, o mais antigo de 28/05.
 *   Ninguém limpava, e o painel lia 1.834 deles de uma vez só na Lima Limão
 *   para contar quem estava online.
 * - Sessões gravadas com `storeId: "2cdrdn"` (o slug curto do link, não o
 *   ownerId): esses clientes nunca eram contados por ninguém.
 * - `lastActive` vinha do relógio do celular do cliente.
 */

const agora = 1_800_000_000_000;

describe('paraMillis', () => {
  it('aceita o número antigo e o Timestamp novo', () => {
    expect(paraMillis(agora)).toBe(agora);
    expect(paraMillis({ toDate: () => new Date(agora) })).toBe(agora);
    expect(paraMillis({ seconds: agora / 1000 })).toBe(agora);
  });

  it('devolve null para lixo', () => {
    expect(paraMillis(undefined)).toBeNull();
    expect(paraMillis(null)).toBeNull();
    expect(paraMillis('ontem')).toBeNull();
    expect(paraMillis(NaN)).toBeNull();
  });
});

describe('classificarSessoes', () => {
  it('conta quem pingou dentro da janela', () => {
    const { online } = classificarSessoes(
      [
        { id: 'a', lastActive: agora - 5_000 },
        { id: 'b', lastActive: agora - ONLINE_TTL_MS + 1 },
      ],
      agora
    );
    expect(online).toEqual(['a', 'b']);
  });

  it('para de contar quem passou do TTL — o número cai sozinho', () => {
    const { online } = classificarSessoes([{ id: 'a', lastActive: agora - ONLINE_TTL_MS - 1 }], agora);
    expect(online).toEqual([]);
  });

  it('celular com relógio adiantado não fica online para sempre', () => {
    const { online } = classificarSessoes([{ id: 'a', lastActive: agora + 48 * 3600_000 }], agora);
    expect(online).toEqual([]);
  });

  it('sessão velha vira fantasma para faxina, mas a recém-expirada não', () => {
    const { online, fantasmas } = classificarSessoes(
      [
        { id: 'morta', lastActive: agora - FANTASMA_TTL_MS - 1 },
        { id: 'so-expirada', lastActive: agora - ONLINE_TTL_MS - 1 },
      ],
      agora
    );
    expect(online).toEqual([]);
    expect(fantasmas).toEqual(['morta']);
  });

  it('limita a faxina por rodada', () => {
    const muitas = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, lastActive: agora - FANTASMA_TTL_MS - 1 }));
    expect(classificarSessoes(muitas, agora).fantasmas).toHaveLength(LIMPEZA_POR_RODADA);
  });

  it('ignora sessão sem lastActive legível em vez de apagar', () => {
    const { online, fantasmas } = classificarSessoes([{ id: 'a' }, { id: 'b', lastActive: null }], agora);
    expect(online).toEqual([]);
    expect(fantasmas).toEqual([]);
  });
});

describe('ehIdDeLojaResolvido', () => {
  it('recusa o slug curto que vazava para o banco', () => {
    expect(ehIdDeLojaResolvido('2cdrdn')).toBe(false);
    expect(ehIdDeLojaResolvido('pdv')).toBe(false);
    expect(ehIdDeLojaResolvido('')).toBe(false);
    expect(ehIdDeLojaResolvido(null)).toBe(false);
  });

  it('aceita o uid da loja', () => {
    expect(ehIdDeLojaResolvido('5Hg3VG3qYAZNsobVnReK9aPntjx1')).toBe(true);
  });
});

describe('marcarVisitaDaSessao', () => {
  function storageFalso(): Storage {
    const dados = new Map<string, string>();
    return {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => void dados.set(k, v),
      removeItem: (k: string) => void dados.delete(k),
      clear: () => dados.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  beforeEach(() => _limparMarcasEmMemoria());

  it('conta a primeira visita e ignora o recarregamento', () => {
    const s = storageFalso();
    expect(marcarVisitaDaSessao(s, 'loja')).toBe(true);
    expect(marcarVisitaDaSessao(s, 'loja')).toBe(false);
    expect(marcarVisitaDaSessao(s, 'loja')).toBe(false);
  });

  it('conta lojas diferentes separadamente', () => {
    const s = storageFalso();
    expect(marcarVisitaDaSessao(s, 'loja-a')).toBe(true);
    expect(marcarVisitaDaSessao(s, 'loja-b')).toBe(true);
  });

  it('não conta duas vezes quando o storage está bloqueado', () => {
    const quebrado = {
      getItem: () => {
        throw new Error('modo privado');
      },
      setItem: () => {
        throw new Error('modo privado');
      },
    } as unknown as Storage;
    expect(marcarVisitaDaSessao(quebrado, 'loja')).toBe(true);
    expect(marcarVisitaDaSessao(quebrado, 'loja')).toBe(false);
  });

  it('funciona sem storage nenhum (SSR)', () => {
    expect(marcarVisitaDaSessao(null, 'loja')).toBe(true);
    expect(marcarVisitaDaSessao(null, 'loja')).toBe(false);
  });
});

describe('obterVisitorId', () => {
  function storageFalso(): Storage {
    const dados = new Map<string, string>();
    return {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => void dados.set(k, v),
      removeItem: (k: string) => void dados.delete(k),
      clear: () => dados.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  it('mantém o mesmo id entre visitas do mesmo navegador', () => {
    const s = storageFalso();
    const primeiro = obterVisitorId(s);
    expect(primeiro).toBeTruthy();
    expect(obterVisitorId(s)).toBe(primeiro);
    expect(s.getItem(CHAVE_VISITOR_ID)).toBe(primeiro);
  });

  it('navegadores diferentes recebem ids diferentes', () => {
    expect(obterVisitorId(storageFalso())).not.toBe(obterVisitorId(storageFalso()));
  });

  it('storage bloqueado ainda devolve um id estável na visita', () => {
    const quebrado = {
      getItem: () => { throw new Error('modo privado'); },
      setItem: () => { throw new Error('modo privado'); },
    } as unknown as Storage;
    const id = obterVisitorId(quebrado);
    expect(id).toBeTruthy();
    expect(obterVisitorId(quebrado)).toBe(id);
  });
});

describe('ehVisitaDaPropriaLoja', () => {
  function storageFalso(): Storage {
    const dados = new Map<string, string>();
    return {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => void dados.set(k, v),
      removeItem: (k: string) => void dados.delete(k),
      clear: () => dados.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  const LOJA = '5Hg3VG3qYAZNsobVnReK9aPntjx1';

  it('cliente comum continua contando', () => {
    expect(ehVisitaDaPropriaLoja(storageFalso(), LOJA, null)).toBe(false);
  });

  it('dono logado NESTA loja não conta como visita', () => {
    expect(ehVisitaDaPropriaLoja(storageFalso(), LOJA, LOJA)).toBe(true);
  });

  it('dono de OUTRA loja olhando o cardápio é cliente como qualquer um', () => {
    expect(ehVisitaDaPropriaLoja(storageFalso(), LOJA, 'gT3lDZMY7uR2pV8NDxc5a5UOYkP2')).toBe(false);
  });

  it('aparelho reconhecido continua de fora depois de deslogar', () => {
    const s = storageFalso();
    marcarDispositivoDaLoja(s, LOJA);
    expect(ehVisitaDaPropriaLoja(s, LOJA, null)).toBe(true);
    // ...mas só para a loja que o marcou.
    expect(ehVisitaDaPropriaLoja(s, 'outra-loja-qualquer', null)).toBe(false);
  });

  it('storage com lixo não derruba a checagem', () => {
    const s = storageFalso();
    s.setItem(CHAVE_DISPOSITIVO_INTERNO, '{nao é json}');
    expect(ehVisitaDaPropriaLoja(s, LOJA, null)).toBe(false);
  });
});
