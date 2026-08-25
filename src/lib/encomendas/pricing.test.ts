import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG, type EncomendaCatalog } from './catalog';
import {
  calcularTotais,
  linhasDe,
  montarEncomenda,
  precoDoAdicional,
  resolverBolo,
  selecaoDaEncomenda,
  selecaoVazia,
  skuTotal,
} from './pricing';

// Catálogo no formato da loja real: bolo por kg + Baby de preço fixo.
const cat: EncomendaCatalog = {
  ...DEFAULT_CATALOG,
  cakes: [
    { id: 'choc', name: 'Chocolate', pricePerKg: 80 },
    { id: 'ninho', name: 'Ninho', pricePerKg: 90 },
  ],
  cakeWeights: [
    { id: 'baby', label: 'Baby', fixedPrice: 55, packaging: 16, shapes: ['redondo'] },
    { id: '1kg', label: '1 kg', kg: 1, packaging: 16, shapes: ['redondo', 'quadrado'] },
    { id: '3kg', label: '3 kg', kg: 3, shapes: ['redondo'] },
  ],
  cakeExtras: [
    { id: 'topper', name: 'Topper', price: 20 },
    { id: 'ganache', name: 'Ganache', price: 15, per: '2kg' },
  ],
  tortas: [{ id: 'banoffe', name: 'Banoffe', price: 55 }],
  docinhos: [{ id: 'brig', name: 'Brigadeiro', price: 1.7, priceCento: 140, price50: 80 }],
};

const selBolo = (over: any = {}) => ({
  ...selecaoVazia(),
  products: ['bolo' as const],
  bolo: { flavorId: 'choc', weightId: '1kg', extraIds: [], ...over },
});

describe('skuTotal', () => {
  it('preço por unidade multiplica', () => {
    expect(skuTotal({ price: 55 }, 2)).toBe(110);
  });

  it('50 sozinho cobra o preço das 50', () => {
    expect(skuTotal({ price: 1.7, priceCento: 140, price50: 80 }, 50)).toBe(80);
  });

  it('acima do cento a sobra de 50 é proporcional', () => {
    expect(skuTotal({ price: 1.7, priceCento: 140, price50: 80 }, 100)).toBe(140);
    expect(skuTotal({ price: 1.7, priceCento: 140, price50: 80 }, 150)).toBe(210);
    expect(skuTotal({ price: 1.7, priceCento: 140, price50: 80 }, 200)).toBe(280);
  });
});

describe('adicional do bolo', () => {
  it('fixo não muda com o peso', () => {
    expect(precoDoAdicional({ price: 20 }, 4)).toBe(20);
  });

  it('"a cada 2 kg" arredonda para cima', () => {
    expect(precoDoAdicional({ price: 15, per: '2kg' }, 1)).toBe(15);
    expect(precoDoAdicional({ price: 15, per: '2kg' }, 2)).toBe(15);
    expect(precoDoAdicional({ price: 15, per: '2kg' }, 3)).toBe(30);
    expect(precoDoAdicional({ price: 15, per: '2kg' }, 5)).toBe(45);
  });

  it('"por kg" multiplica pelo peso do bolo', () => {
    expect(precoDoAdicional({ price: 20, per: 'kg' }, 1)).toBe(20);
    expect(precoDoAdicional({ price: 20, per: 'kg' }, 3)).toBe(60);
    expect(precoDoAdicional({ price: 20, per: 'kg' }, 10)).toBe(200);
  });

  it('"por kg" com peso quebrado volta em centavos', () => {
    expect(precoDoAdicional({ price: 20, per: 'kg' }, 1.5)).toBe(30);
    expect(precoDoAdicional({ price: 19.9, per: 'kg' }, 2.3)).toBe(45.77);
  });

  it('sem peso escolhido, "por kg" cobra 1 kg (Baby)', () => {
    expect(precoDoAdicional({ price: 20, per: 'kg' }, 0)).toBe(20);
  });
});

describe('resolverBolo (por kg)', () => {
  it('preço por kg × peso + embalagem', () => {
    expect(resolverBolo(cat, selBolo()).total).toBe(96); // 80×1 + 16
    expect(resolverBolo(cat, selBolo({ weightId: '3kg' })).total).toBe(240); // 80×3, sem embalagem
  });

  it('Baby é preço fixo — ignora o sabor', () => {
    expect(resolverBolo(cat, selBolo({ weightId: 'baby' })).total).toBe(71); // 55 + 16
    expect(resolverBolo(cat, selBolo({ weightId: 'baby', flavorId: 'ninho' })).total).toBe(71);
  });

  it('adicionais entram no total, com a regra dos 2 kg', () => {
    const bolo = resolverBolo(cat, selBolo({ weightId: '3kg', extraIds: ['topper', 'ganache'] }));
    expect(bolo.total).toBe(240 + 20 + 30);
    expect(bolo.extras).toEqual([{ name: 'Topper', price: 20 }, { name: 'Ganache', price: 30 }]);
  });

  it('sem peso escolhido não cobra nada', () => {
    expect(resolverBolo(cat, selBolo({ weightId: '' })).total).toBe(0);
  });

  it('bolo fora da seleção não entra na conta', () => {
    expect(resolverBolo(cat, { ...selBolo(), products: [] }).total).toBe(0);
  });
});

describe('selecaoDaEncomenda (abrir para editar)', () => {
  const sel = {
    ...selecaoVazia(),
    products: ['bolo' as const, 'tortas' as const],
    bolo: { flavorId: 'ninho', weightId: '3kg', shape: 'quadrado', dough: 'Massa branca (baunilha)', extraIds: ['topper', 'ganache'] },
    tortas: { banoffe: 2 },
  };
  const totais = calcularTotais(cat, sel, { sinalPercent: 50 });
  const enc = montarEncomenda({
    id: 'X1', customerUid: 'u', ownerId: 'o',
    cliente: { nome: 'Ana', telefone: '16999998888' },
    sel, totais, sinalPercent: 50,
    entrega: { date: '2026-08-02', time: '15:00', type: 'retirada' },
    status: 'confirmada', source: 'balcao',
  });

  it('reabre exatamente o que foi escolhido (ida e volta)', () => {
    const volta = selecaoDaEncomenda(cat, enc);
    expect(volta.products).toEqual(['bolo', 'tortas']);
    expect(volta.bolo.flavorId).toBe('ninho');
    expect(volta.bolo.weightId).toBe('3kg');
    expect(volta.bolo.shape).toBe('quadrado');
    expect(volta.bolo.dough).toBe('Massa branca (baunilha)');
    expect(volta.bolo.extraIds).toEqual(['topper', 'ganache']);
    expect(volta.tortas).toEqual({ banoffe: 2 });
  });

  it('o total recalculado da volta bate com o gravado', () => {
    const volta = selecaoDaEncomenda(cat, enc);
    expect(calcularTotais(cat, volta, { sinalPercent: 50 }).total).toBe(enc.total);
  });

  it('item apagado do catálogo volta vazio (a tela avisa pela diferença de total)', () => {
    const catSemSabor = { ...cat, cakes: cat.cakes.filter((c) => c.id !== 'ninho') };
    const volta = selecaoDaEncomenda(catSemSabor, enc);
    expect(volta.bolo.flavorId).toBe('');
    expect(calcularTotais(catSemSabor, volta, { sinalPercent: 50 }).total).not.toBe(enc.total);
  });

  it('encomenda do modelo antigo volta com tamanho/recheio/cobertura', () => {
    const antiga: any = {
      products: ['bolo'],
      bolo: { sizeId: 'M', size: 'M', dough: 'Massa branca', filling: 'Brigadeiro cremoso', cover: 'Naked (sem laterais)', plate: { on: true }, total: 200 },
      especialItems: [], tortasItems: [], docinhosItems: [],
    };
    const volta = selecaoDaEncomenda(DEFAULT_CATALOG, antiga);
    expect(volta.bolo.sizeId).toBe('M');
    expect(volta.bolo.plateOn).toBe(true);
    expect(volta.bolo.weightId).toBe('');
  });
});

describe('calcularTotais', () => {
  it('soma bolo + itens + taxa e tira o sinal', () => {
    const t = calcularTotais(cat, {
      ...selecaoVazia(),
      products: ['bolo', 'tortas'],
      bolo: { flavorId: 'choc', weightId: '3kg', extraIds: [] },
      tortas: { banoffe: 2 },
    }, { deliveryFee: 10, sinalPercent: 50 });

    expect(t.subtotal).toBe(350); // 240 + 110
    expect(t.total).toBe(360);
    expect(t.sinal).toBe(180);
    expect(t.saldo).toBe(180);
    expect(t.tortasLines).toEqual([{ id: 'banoffe', name: 'Banoffe', qty: 2, unitPrice: 55, total: 110 }]);
  });

  it('seção não escolhida é ignorada mesmo com quantidade digitada', () => {
    const t = calcularTotais(cat, {
      ...selecaoVazia(),
      products: ['bolo'],
      bolo: { flavorId: 'choc', weightId: '1kg', extraIds: [] },
      tortas: { banoffe: 5 },
    }, { sinalPercent: 50 });

    expect(t.subtotal).toBe(96);
    expect(t.tortasLines).toEqual([]);
  });

  it('sinal de 30% de um total quebrado não perde centavo', () => {
    const t = calcularTotais(cat, {
      ...selecaoVazia(),
      products: ['docinhos'],
      docinhos: { brig: 50 },
    }, { sinalPercent: 30 });

    expect(t.total).toBe(80);
    expect(t.sinal).toBe(24);
    expect(t.saldo).toBe(56);
  });

  it('unitPrice da linha reflete o preço por cento', () => {
    const linhas = linhasDe({ brig: 150 }, cat.docinhos);
    expect(linhas[0].total).toBe(210);
    expect(linhas[0].unitPrice).toBeCloseTo(1.4);
  });
});
