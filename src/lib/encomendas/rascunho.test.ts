import { describe, expect, it } from 'vitest';
import { fromStoreWorkingHours } from './schedule';
import { abasComMudanca, aposGravar, igual, montarGravacao, rascunhoDoPerfil } from './rascunho';

// Simula o ciclo real: a gravação entra no perfil (merge raso por campo de
// `encomendas`) e o Firestore devolve as chaves em outra ordem, sem undefined.
function embaralha(v: any): any {
  if (Array.isArray(v)) return v.map(embaralha);
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const k of Object.keys(v).reverse()) if (v[k] !== undefined) o[k] = embaralha(v[k]);
    return o;
  }
  return v;
}
const reler = (perfil: any, gravacao: any) =>
  embaralha({ ...perfil, encomendas: { ...(perfil.encomendas || {}), ...JSON.parse(JSON.stringify(gravacao)) } });

const perfil: any = {
  creditPixKey: 'pix-do-cartao',
  encomendas: {
    sinalPercent: 40,
    catalog: {
      tortas: [{ id: 'a', name: 'Banoffe', price: 55, group: 'P' }],
      deliveryTimes: ['10:00', '14:00'],
    },
  },
};

describe('igual', () => {
  it('ignora a ordem das chaves, em qualquer nível', () => {
    expect(igual({ a: 1, b: { c: [1, { x: 1, y: 2 }] } }, { b: { c: [1, { y: 2, x: 1 }] }, a: 1 })).toBe(true);
  });
  it('trata undefined como ausente', () => {
    expect(igual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(igual({ a: { b: undefined } }, { a: {} })).toBe(true);
  });
  it('enxerga diferença de valor, de tamanho de lista e de ordem da lista', () => {
    expect(igual({ a: 1 }, { a: 2 })).toBe(false);
    expect(igual([1, 2], [1, 2, 3])).toBe(false);
    expect(igual([1, 2], [2, 1])).toBe(false);
    expect(igual({ a: 0 }, { a: undefined })).toBe(false);
  });
});

describe('montarGravacao', () => {
  it('sem edição não grava nada', () => {
    const s = rascunhoDoPerfil(perfil);
    expect(montarGravacao(s, s)).toEqual({});
  });

  it('grava só o campo que mudou', () => {
    const s = rascunhoDoPerfil(perfil);
    const g = montarGravacao({ ...s, minDays: 5 }, s);
    expect(g).toEqual({ minDays: 5 });
    expect(g).not.toHaveProperty('content');
    expect(g).not.toHaveProperty('catalog');
  });

  it('limita o sinal a 0-100 e o prazo a inteiro >= 0', () => {
    const s = rascunhoDoPerfil(perfil);
    expect(montarGravacao({ ...s, sinalPercent: 250 }, s).sinalPercent).toBe(100);
    expect(montarGravacao({ ...s, sinalPercent: -5 }, s).sinalPercent).toBe(0);
    expect(montarGravacao({ ...s, minDays: 2.7 }, s).minDays).toBe(2);
    expect(montarGravacao({ ...s, minDays: -3 }, s).minDays).toBe(0);
  });

  it('catálogo vai inteiro, sem undefined e sem horário de entrega vazio', () => {
    const s = rascunhoDoPerfil(perfil);
    const cat = { ...s.catalog, deliveryTimes: ['10:00', '', '  ', '16:00'], tortas: [{ id: 'a', name: 'Banoffe', price: 60, priceCento: undefined }] };
    const g = montarGravacao({ ...s, catalog: cat }, s);
    expect(g.catalog?.deliveryTimes).toEqual(['10:00', '16:00']);
    expect(Object.keys(g.catalog!.tortas[0])).not.toContain('priceCento');
    expect(Object.keys(g)).toEqual(['catalog']);
  });

  it('só uma linha de horário vazia não vira gravação', () => {
    const s = rascunhoDoPerfil(perfil);
    const atual = { ...s, catalog: { ...s.catalog, deliveryTimes: [...s.catalog.deliveryTimes, ''] } };
    expect(montarGravacao(atual, s)).toEqual({});
    expect(igual(aposGravar(atual, {}), s)).toBe(true);
  });

  it('vínculo com o cardápio atualiza o retrato do item ao gravar', () => {
    const s = rascunhoDoPerfil({ encomendas: { catalog: { tortas: [{ id: 'a', productId: 'p1', name: 'Velho', price: 1 }] } } });
    const atual = { ...s, minDays: 9, catalog: { ...s.catalog, tortas: [{ ...s.catalog.tortas[0], desc: 'x' }] } };
    const g = montarGravacao(atual, s, [{ id: 'p1', name: 'Novo', price: 70 }]);
    expect(g.catalog?.tortas[0]).toMatchObject({ name: 'Novo', price: 70 });
  });
});

describe('ciclo salvar → reler', () => {
  it('depois de gravar e reler com chaves fora de ordem, nada fica sujo', () => {
    const s = rascunhoDoPerfil(perfil);
    const atual = {
      ...s,
      sinalPercent: 150,
      pixKey: 'nova',
      weekHours: s.weekHours.map((d, i) => (i === 3 ? { ...d, closed: true } : d)),
      content: { ...s.content, heroTitle: 'Outro título' },
      catalog: {
        ...s.catalog,
        deliveryTimes: ['09:00', ''],
        tortas: [{ id: 'a', name: 'Banoffe', price: 55, group: 'P', priceCento: undefined, enabled: undefined }],
      },
    };
    const g = montarGravacao(atual, s);
    const rascunhoDepois = aposGravar(atual, g);
    const salvo2 = rascunhoDoPerfil(reler(perfil, g));
    expect(igual(rascunhoDepois, salvo2)).toBe(true);
    expect(Object.values(abasComMudanca(rascunhoDepois, salvo2)).some(Boolean)).toBe(false);
  });

  it('fallback da chave PIX do cartão não suja e não é gravado', () => {
    const s = rascunhoDoPerfil({ creditPixKey: 'pix-do-cartao' });
    expect(s.pixKey).toBe('pix-do-cartao');
    expect(montarGravacao(s, s)).toEqual({});
    expect(abasComMudanca(s, s).pagamento).toBe(false);
    // gravando OUTRO campo, a chave emprestada continua sem ser gravada
    expect(montarGravacao({ ...s, minDays: 1 }, s)).toEqual({ minDays: 1 });
  });

  it('perfil nulo gera os defaults de hoje', () => {
    const s = rascunhoDoPerfil(null);
    expect(s).toMatchObject({ enabled: true, showInApp: false, pickupOnly: false, sinalPercent: 30, pixKey: '', minDays: 3, weekDays: [], scheduleMode: 'text' });
  });
});

describe('horário seguindo a loja', () => {
  const workingHours = [{ day: 'Segunda', open: '08:00', close: '12:00', isClosed: false }];
  const copia = [0, 1, 2, 3, 4, 5, 6].map(() => ({ closed: false, open: '09:00', close: '18:00' }));
  it('o rascunho guarda a cópia salva; sair do modo "loja" grava o horário da loja', () => {
    const s = rascunhoDoPerfil({ workingHours, encomendas: { scheduleMode: 'store', weekHours: copia } });
    expect(s.weekHours[1]).toEqual({ closed: false, open: '09:00', close: '18:00' });
    const daLoja = fromStoreWorkingHours(workingHours)!;
    const g = montarGravacao({ ...s, scheduleMode: 'week', weekHours: daLoja }, s);
    expect(g.weekHours?.[1]).toMatchObject({ open: '08:00', close: '12:00' });
  });
});

describe('abasComMudanca', () => {
  const s = rascunhoDoPerfil(perfil);
  it('separa as abas pelos campos certos', () => {
    expect(abasComMudanca({ ...s, minDays: 7 }, s)).toEqual({ agenda: true, produtos: false, pagamento: false, pagina: false });
    expect(abasComMudanca({ ...s, catalog: { ...s.catalog, deliveryTimes: ['08:00'] } }, s)).toEqual({ agenda: true, produtos: false, pagamento: false, pagina: false });
    expect(abasComMudanca({ ...s, catalog: { ...s.catalog, platePrice: 99 } }, s)).toEqual({ agenda: false, produtos: true, pagamento: false, pagina: false });
    expect(abasComMudanca({ ...s, pickupOnly: true }, s).pagamento).toBe(true);
    expect(abasComMudanca({ ...s, showInApp: true }, s).pagina).toBe(true);
  });
  it('o liga/desliga não pertence a nenhuma aba', () => {
    expect(abasComMudanca({ ...s, enabled: false }, s)).toEqual({ agenda: false, produtos: false, pagamento: false, pagina: false });
  });
});
