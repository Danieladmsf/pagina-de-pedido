import { describe, expect, it } from 'vitest';
import { buildEncomendaReceiptHtml } from './receipt';
import type { Encomenda } from './types';

const loja = { general: { name: 'Doceria Teste', printerSize: '80mm' } };

const base = (over: Partial<Encomenda> = {}): Encomenda => ({
  id: 'AB12C',
  customerUid: 'u1',
  ownerId: 'o1',
  customerName: 'Ana Paula',
  customerPhone: '16999998888',
  customerBirthDate: '',
  isEmpresa: false,
  products: ['bolo'],
  bolo: null,
  especialItems: [],
  tortasItems: [],
  docinhosItems: [],
  delivery: { date: '2026-08-02', time: '15:00', type: 'retirada' },
  subtotal: 240,
  deliveryFee: 0,
  total: 240,
  sinalPercent: 50,
  sinal: 120,
  saldo: 120,
  status: 'confirmada',
  source: 'balcao',
  orderDateTime: '2026-07-29T13:00:00.000Z',
  ...over,
} as Encomenda);

// Bolo do fluxo por quilo — o que a loja realmente vende hoje.
const boloPorKg = {
  sizeId: '3kg', size: '3 kg', dough: 'Massa branca', filling: 'Ninho com morango', cover: '',
  plate: { on: false }, total: 260,
  flavor: 'Ninho com morango', weight: '3 kg', shape: 'quadrado', pricePerKg: 80, kg: 3,
  extras: [{ name: 'Topper', price: 20 }],
} as any;

describe('cupom da encomenda — bolo por quilo', () => {
  const html = buildEncomendaReceiptHtml(base({ bolo: boloPorKg }), loja);

  it('imprime o que a confeiteira precisa para produzir', () => {
    expect(html).toContain('Sabor: Ninho com morango');
    expect(html).toContain('Peso: 3 kg (R$ 80,00/kg)');
    expect(html).toContain('Formato: quadrado');
    expect(html).toContain('Massa: Massa branca');
    expect(html).toContain('Topper');
    expect(html).toContain('R$ 20,00');
  });

  it('não imprime rótulo de campo vazio (cobertura não existe no fluxo por kg)', () => {
    expect(html).not.toContain('Cobertura');
    expect(html).not.toContain('Recheio:');
  });
});

describe('cupom da encomenda — bolo do modelo antigo', () => {
  const html = buildEncomendaReceiptHtml(base({
    bolo: {
      sizeId: 'g', size: 'Grande', dough: 'Chocolate', filling: 'Brigadeiro', cover: 'Chantilly',
      plate: { on: true, name: 'Miguel', age: '5', theme: 'Homem-Aranha', notes: 'escrever "parabens"', imageUrl: 'http://x/y.jpg' },
      total: 200,
    } as any,
  }), loja);

  it('mantém tamanho, recheio e cobertura', () => {
    expect(html).toContain('Tamanho: Grande');
    expect(html).toContain('Recheio: Brigadeiro');
    expect(html).toContain('Cobertura: Chantilly');
  });

  it('detalha a plaquinha, inclusive o recado e a foto', () => {
    expect(html).toContain('Nome: Miguel');
    expect(html).toContain('Idade: 5 anos');
    expect(html).toContain('Tema: Homem-Aranha');
    expect(html).toContain('parabens');
    expect(html).toContain('foto de referencia');
  });
});

describe('cupom da encomenda — dinheiro', () => {
  it('quem pagou tudo na hora não sai devendo no papel', () => {
    const html = buildEncomendaReceiptHtml(base({ bolo: boloPorKg, valorPago: 240 }), loja);
    expect(html).toContain('PAGO POR INTEIRO');
    expect(html).not.toContain('FALTA');
  });

  it('pagamento parcial mostra o que falta na retirada', () => {
    const html = buildEncomendaReceiptHtml(base({ bolo: boloPorKg, valorPago: 120 }), loja);
    expect(html).toContain('R$ 120,00');
    expect(html).toContain('FALTA R$ 120,00 NA RETIRADA');
  });

  it('encomenda antiga (sem valorPago) usa o sinal lançado', () => {
    const html = buildEncomendaReceiptHtml(base({ bolo: boloPorKg, sinalLancado: true }), loja);
    expect(html).toContain('FALTA R$ 120,00');
  });

  it('entrega mostra a taxa e o subtotal separados', () => {
    const html = buildEncomendaReceiptHtml(base({
      bolo: boloPorKg,
      deliveryFee: 10,
      total: 250,
      delivery: { date: '2026-08-02', time: '15:00', type: 'delivery', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Franca', feeStatus: 'calculada' },
    }), loja);
    expect(html).toContain('Taxa de entrega');
    expect(html).toContain('R$ 10,00');
    expect(html).toContain('End: Rua A, 10');
    expect(html).toContain('NA ENTREGA');
  });
});

describe('cupom da encomenda — cabeçalho', () => {
  it('traz loja, número, data do pedido e o papel certo', () => {
    const html = buildEncomendaReceiptHtml(base({ bolo: boloPorKg }), loja);
    expect(html).toContain('Doceria Teste');
    expect(html).toContain('#AB12C');
    expect(html).toContain('Pedido em');
    expect(html).toContain('@page { size:80mm auto; margin:0; }');
  });
});
