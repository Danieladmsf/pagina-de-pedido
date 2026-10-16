import { describe, expect, it } from 'vitest';
import { janelaDeComparacao, janelaDoRelatorio } from './periodo';
import { escalaDoPeriodo, serieDoPeriodo, vendasPorCanal, vendasUmaAUma } from './visao';

// 16/10/2026, sexta, 17:20.
const AGORA = new Date(2026, 9, 16, 17, 20);
const janela = (preset: any) => janelaDoRelatorio({ preset }, AGORA);

const venda = (quando: Date, valor: number, extra: any = {}) => ({
  vinculo: extra.vinculo ?? `o:${Math.random()}`,
  quando: quando.getTime(),
  valor,
  origem: extra.origem ?? 'pedido',
  formas: extra.formas ?? ['Pix'],
  documento: extra.documento ?? { orderType: 'pickup', source: 'pdv' },
}) as any;

describe('escalaDoPeriodo', () => {
  it('um dia olha hora a hora, até dois meses dia a dia, mais que isso mês a mês', () => {
    expect(escalaDoPeriodo(janela('hoje'), AGORA)).toBe('hora');
    expect(escalaDoPeriodo(janela('ontem'), AGORA)).toBe('hora');
    expect(escalaDoPeriodo(janela('7d'), AGORA)).toBe('dia');
    expect(escalaDoPeriodo(janela('30d'), AGORA)).toBe('dia');
    expect(escalaDoPeriodo(janela('mes_atual'), AGORA)).toBe('dia');
    expect(escalaDoPeriodo(janela('mes_passado'), AGORA)).toBe('dia');
    expect(escalaDoPeriodo(janela('3m'), AGORA)).toBe('mes');
    expect(escalaDoPeriodo(janela('12m'), AGORA)).toBe('mes');
    expect(escalaDoPeriodo(janela('tudo'), AGORA)).toBe('mes');
  });

  it('um dia escolhido no personalizado também é hora a hora', () => {
    expect(escalaDoPeriodo(janelaDoRelatorio({ preset: 'custom', de: '2026-10-10', ate: '2026-10-10' }, AGORA), AGORA)).toBe('hora');
  });
});

describe('serieDoPeriodo', () => {
  it('hora a hora fica só no horário em que a loja vendeu, com a comparação ao lado', () => {
    const j = janela('hoje');
    const c = janelaDeComparacao({ preset: 'hoje' }, AGORA);
    const serie = serieDoPeriodo({
      escala: 'hora', janela: j, comparacao: c, agora: AGORA,
      vendas: [venda(new Date(2026, 9, 16, 11, 5), 20), venda(new Date(2026, 9, 16, 14, 30), 60), venda(new Date(2026, 9, 16, 14, 50), 40)],
      anteriores: [venda(new Date(2026, 9, 9, 10, 15), 30)],
    });
    expect(serie.map((p) => p.rotulo)).toEqual(['10h', '11h', '12h', '13h', '14h']);
    expect(serie.find((p) => p.rotulo === '14h')).toMatchObject({ atual: 100, vendas: 2 });
    expect(serie.find((p) => p.rotulo === '10h')).toMatchObject({ atual: 0, anterior: 30 });
  });

  it('dia sem venda nenhuma devolve série vazia', () => {
    expect(serieDoPeriodo({ escala: 'hora', janela: janela('hoje'), comparacao: null, vendas: [], anteriores: [] })).toEqual([]);
  });

  it('dia a dia para em hoje e alinha o período anterior pela posição', () => {
    const j = janela('7d'); // 10/10 a 16/10
    const c = janelaDeComparacao({ preset: '7d' }, AGORA); // 03/10 a 09/10
    const serie = serieDoPeriodo({
      escala: 'dia', janela: j, comparacao: c, agora: AGORA,
      vendas: [venda(new Date(2026, 9, 10, 12), 50), venda(new Date(2026, 9, 16, 9), 10)],
      anteriores: [venda(new Date(2026, 9, 3, 12), 70)],
    });
    expect(serie).toHaveLength(7);
    expect(serie[0]).toMatchObject({ rotulo: 'sáb 10', atual: 50, anterior: 70 });
    expect(serie[6]).toMatchObject({ rotulo: 'sex 16', atual: 10 });
  });

  it('mês atual não desenha os dias que ainda não chegaram', () => {
    const serie = serieDoPeriodo({ escala: 'dia', janela: janela('mes_atual'), comparacao: null, vendas: [], anteriores: [], agora: AGORA });
    expect(serie).toHaveLength(16);
    expect(serie[15].rotulo).toBe('16/10');
  });
});

describe('vendasPorCanal', () => {
  it('separa balcão, delivery, mesa e encomenda na ordem das telas', () => {
    const fatias = vendasPorCanal([
      venda(AGORA, 10, { documento: { orderType: 'pickup', source: 'pdv' } }),
      venda(AGORA, 30, { documento: { orderType: 'delivery', source: 'cardapio' } }),
      venda(AGORA, 5, { documento: null, origem: 'avulsa' }),
      venda(AGORA, 100, { origem: 'encomenda', documento: { id: 'e1' } }),
    ]);
    expect(fatias.map((f) => [f.rotulo, f.valor, f.vendas])).toEqual([
      ['Delivery · Entrega', 30, 1],
      ['Balcão', 15, 2],
      ['Encomenda', 100, 1],
    ]);
  });
});

describe('vendasUmaAUma', () => {
  it('mais recente primeiro, com cliente, canal, formas e itens', () => {
    const linhas = vendasUmaAUma([
      venda(new Date(2026, 9, 16, 11, 5), 20, { documento: { orderType: 'pickup', customerName: 'Cliente Balcão', items: [{ quantity: 2 }] } }),
      venda(new Date(2026, 9, 16, 15, 16), 68, {
        formas: ['Prazo'],
        documento: { orderType: 'delivery', source: 'cardapio', customerName: 'Kenia Recred', items: [{ quantity: 1 }, { quantity: 3 }] },
      }),
    ]);
    expect(linhas[0]).toMatchObject({ hora: '15:16', cliente: 'Kenia Recred', canal: 'Delivery · Entrega', formas: 'Prazo', valor: 68, itens: 4 });
    expect(linhas[1]).toMatchObject({ hora: '11:05', cliente: 'Não informado', canal: 'Balcão', itens: 2 });
  });
});
