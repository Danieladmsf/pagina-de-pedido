import { describe, expect, it } from 'vitest';

import {
  buildAberturaCaixaHtml,
  buildFechamentoCaixaHtml,
  buildOperacaoCaixaHtml,
  type FechamentoCaixaData,
} from './caixa-receipt';

const loja = { general: { name: 'Loja Teste', printerSize: '80mm' } };

const fechamento: FechamentoCaixaData = {
  storeInfo: loja,
  sessao: 7,
  isFechado: false,
  dataHora: '24/07/2026 20:00',
  totais: {
    totalDinheiro: 300, totalPix: 100, totalDebito: 50, totalCredito: 25, totalPrazo: 10,
    saldoInicial: 100, totalSuprimentoDinheiro: 20, totalSangriaDinheiro: -80,
  },
  vendasCanceladas: { quantidade: 0, total: 0 },
  taxaGarcom: { valor: 0, label: '10%', pedidos: 12 },
  totalMotoboys: 0,
  totalFreelancers: 0,
  valorEsperado: 340,
  motoboys: [],
  freelancers: [],
  sangriasDinheiro: [],
};

describe('comprovante de abertura', () => {
  const html = buildAberturaCaixaHtml({ storeInfo: loja, sessao: 7, saldoInicial: 150 });

  it('traz sessão, saldo inicial e o papel da loja', () => {
    expect(html).toContain('★ ABERTURA DE CAIXA ★');
    expect(html).toContain('<span class="bold">7</span>');
    expect(html).toContain('R$ 150,00');
    expect(html).toContain('@page { size:80mm auto; margin:0; }');
  });
});

describe('comprovante de operação', () => {
  it('sangria mostra valor retirado', () => {
    const html = buildOperacaoCaixaHtml({
      storeInfo: loja, tipo: 'sangria', titulo: 'Pagamento fornecedor', valor: 80,
      formaPagamento: 'dinheiro', sessao: 7,
    });
    expect(html).toContain('▼ SANGRIA DE CAIXA ▼');
    expect(html).toContain('(−) Valor Retirado');
    expect(html).toContain('R$ 80,00');
    expect(html).toContain('DINHEIRO');
  });

  it('suprimento mostra valor adicionado', () => {
    const html = buildOperacaoCaixaHtml({
      storeInfo: loja, tipo: 'suprimento', titulo: 'Troco', valor: 50, formaPagamento: 'dinheiro',
    });
    expect(html).toContain('▲ SUPRIMENTO DE CAIXA ▲');
    expect(html).toContain('(+) Valor Adicionado');
  });

  it('venda a prazo aparece como Prazo, não como conta_casa', () => {
    const html = buildOperacaoCaixaHtml({
      storeInfo: loja, tipo: 'venda', titulo: 'Venda balcão', valor: 30, formaPagamento: 'conta_casa',
    });
    expect(html).toContain('$ VENDA MANUAL $');
    expect(html).toContain('PRAZO');
    expect(html).not.toContain('CONTA_CASA');
  });
});

describe('comprovante de fechamento', () => {
  it('traz o resumo de vendas e o valor esperado na gaveta', () => {
    const html = buildFechamentoCaixaHtml(fechamento);
    expect(html).toContain('FECHAMENTO DE CAIXA');
    expect(html).toContain('Sessão: 7');
    expect(html).toContain('(=) VALOR ESPERADO');
    expect(html).toContain('R$ 340,00');
    // Sangria entra em módulo: no cupom é sempre uma saída positiva.
    expect(html).toContain('<span>(-) Sangrias (Retirada)</span><span style="color: #000;">R$ 80,00</span>');
  });

  it('esconde os blocos que não têm o que mostrar', () => {
    const html = buildFechamentoCaixaHtml(fechamento);
    expect(html).not.toContain('EXTRATOS DETALHADOS');
    expect(html).not.toContain('MOTOBOYS / ENTREGAS');
    expect(html).not.toContain('TAXA DE SERVIÇO');
    expect(html).not.toContain('Vendas canceladas');
    expect(html).not.toContain('Apurado na Gaveta');
  });

  it('mostra motoboy, freelancer, sangrias e taxa quando existem', () => {
    const html = buildFechamentoCaixaHtml({
      ...fechamento,
      taxaGarcom: { valor: 45, label: '10%', pedidos: 12 },
      totalMotoboys: 30,
      totalFreelancers: 120,
      motoboys: [{ nome: 'Zé', devido: 40, pago: 30, restante: 10 }],
      freelancers: [{ nome: 'Ana', devido: 120, pago: 120, restante: 0 }],
      sangriasDinheiro: [{ hora: '14:30:00', titulo: 'Fornecedor', valor: -80 }],
      vendasCanceladas: { quantidade: 2, total: 60 },
    });
    expect(html).toContain('EXTRATOS DETALHADOS');
    expect(html).toContain('MOTOBOYS / ENTREGAS');
    expect(html).toContain('FREELANCERS / EXTRAS');
    expect(html).toContain('SANGRIAS EM DINHEIRO');
    expect(html).toContain('TAXA DE SERVIÇO');
    expect(html).toContain('Taxa: 10% · 12 ped.');
    expect(html).toContain('<td>Zé</td>');
    expect(html).toContain('Vendas canceladas (2)');
    // Sangria listada sai positiva, como o total.
    expect(html).toContain('<td class="r">R$ 80,00</td>');
  });

  it('freelancer pago pela metade sai com o que ainda se deve', () => {
    // Números do fechamento real da sessão 2 (01/08/2026): diária de 70,50,
    // vale de 20,00 no meio do turno, 30,00 pagos no fechamento. O restante
    // (20,50) TEM que aparecer no papel — é a dívida que segue viva.
    const html = buildFechamentoCaixaHtml({
      ...fechamento,
      totalFreelancers: 30,
      freelancers: [{ nome: 'Freela Teste', devido: 50.5, pago: 30, restante: 20.5 }],
    });
    expect(html).toContain('FREELANCERS / EXTRAS');
    expect(html).toContain('<td>Freela Teste</td>');
    expect(html).toContain('R$ 50,50');
    expect(html).toContain('R$ 20,50');
    expect(html).toContain('Pago no fechamento');
  });

  it('sobra e quebra na conferência da gaveta', () => {
    const sobra = buildFechamentoCaixaHtml({ ...fechamento, apuracao: { apurado: 350, diferenca: 10 } });
    expect(sobra).toContain('Apurado na Gaveta Fisicamente');
    expect(sobra).toContain('Diferença (Sobra)');

    const quebra = buildFechamentoCaixaHtml({ ...fechamento, apuracao: { apurado: 330, diferenca: -10 } });
    expect(quebra).toContain('Diferença (Quebra)');

    // Bateu certinho: mostra o apurado e omite a linha de diferença.
    const exato = buildFechamentoCaixaHtml({ ...fechamento, apuracao: { apurado: 340, diferenca: 0 } });
    expect(exato).toContain('Apurado na Gaveta Fisicamente');
    expect(exato).not.toContain('Diferença (');
  });

  it('caixa fechado troca o rótulo da data e marca a reimpressão', () => {
    const html = buildFechamentoCaixaHtml({
      ...fechamento, isFechado: true, dataHora: '24/07/2026 19:00', reimpressaoEm: '24/07/2026 20:00',
    });
    expect(html).toContain('Fechado em: 24/07/2026 19:00');
    expect(html).toContain('(REIMPRESSÃO: 24/07/2026 20:00)');
  });
});

describe('nome de loja com caractere de HTML', () => {
  it('não quebra o cupom do caixa — era o único que interpolava cru', () => {
    const bar = { general: { name: 'Bar & Cia <Centro>', printerSize: '80mm' } };
    const html = buildAberturaCaixaHtml({ storeInfo: bar, sessao: 1, saldoInicial: 0 });
    expect(html).toContain('Bar &amp; Cia &lt;Centro&gt;');
    expect(html).not.toContain('<Centro>');
  });
});
