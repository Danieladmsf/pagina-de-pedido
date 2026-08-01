import { csvArquivo, csvCabecalhoDoCliente, csvDate, csvLine, csvNumber, type ExportCustomer } from '@/lib/csv';
import { getOrderCode } from '@/lib/order-code';
import {
  foiCancelada, resumoDeCompras, rotuloDaForma, rotuloDoCanal, type CompraDoCliente,
} from './resumo-compras';

/**
 * Exportação das compras do cliente — mesmas regras de planilha do extrato do
 * Prazo (lib/csv), para os dois arquivos abrirem igual no Excel em português.
 *
 * Compra CANCELADA entra na planilha, marcada, e FORA dos totais: quem confere
 * precisa ver que ela existiu, mas ela não é faturamento.
 */

/** Uma linha por compra — o arquivo que fecha com o total. */
export function buildComprasCsv(compras: CompraDoCliente[], customer: ExportCustomer): string {
  const resumo = resumoDeCompras(compras);
  const linhas = [
    ...csvCabecalhoDoCliente(customer, 'Compras do cliente'),
    csvLine(['Data', 'Hora', 'Pedido', 'Canal', 'Forma de pagamento', 'Situacao', 'Itens', 'Valor (R$)']),
    ...compras.map((compra) => {
      const { data, hora } = csvDate(compra.orderDateTime);
      const cancelada = foiCancelada(compra);
      return csvLine([
        data,
        hora,
        getOrderCode(compra),
        rotuloDoCanal(compra),
        rotuloDaForma(compra.paymentMethod),
        cancelada ? 'CANCELADA' : 'Concluida',
        (compra.items || []).length,
        // Cancelada com valor em branco: somar a coluna na planilha tem que dar
        // o mesmo número que a tela mostra.
        cancelada ? '' : csvNumber(Number(compra.totalAmount) || 0),
      ]);
    }),
    '',
    csvLine(['', '', '', '', '', `TOTAL (${resumo.quantidade} compras)`, '', csvNumber(resumo.total)]),
    csvLine(['', '', '', '', '', 'Ticket medio', '', csvNumber(resumo.ticketMedio)]),
    ...(resumo.canceladas > 0
      ? [csvLine(['', '', '', '', '', `Canceladas (${resumo.canceladas}), fora do total`, '', csvNumber(resumo.totalCancelado)])]
      : []),
    '',
    csvLine(['Por forma de pagamento']),
    ...resumo.porForma.map((f) => csvLine([f.chave, '', '', '', '', `${f.quantidade} compra(s)`, '', csvNumber(f.total)])),
    '',
    csvLine(['Por canal']),
    ...resumo.porCanal.map((c) => csvLine([c.chave, '', '', '', '', `${c.quantidade} compra(s)`, '', csvNumber(c.total)])),
  ];
  return csvArquivo(linhas);
}

/** Uma linha por item comprado — para saber o que o cliente leva. */
export function buildComprasItensCsv(compras: CompraDoCliente[], customer: ExportCustomer): string {
  const linhas = [
    ...csvCabecalhoDoCliente(customer, 'Itens comprados'),
    csvLine(['Data', 'Pedido', 'Canal', 'Item', 'Qtd', 'Adicionais', 'Valor unit. (R$)', 'Total do item (R$)']),
  ];

  for (const compra of compras) {
    // Cancelada não lista itens: eles não foram vendidos.
    if (foiCancelada(compra)) continue;
    const { data } = csvDate(compra.orderDateTime);
    for (const item of compra.items || []) {
      const qtd = Number(item?.quantity) || 0;
      const unit = Number(item?.unitPrice ?? item?.price) || 0;
      linhas.push(csvLine([
        data,
        getOrderCode(compra),
        rotuloDoCanal(compra),
        item?.name || '',
        qtd,
        (item?.addons || []).map((a: any) => a?.name).filter(Boolean).join(' + '),
        csvNumber(unit),
        csvNumber(unit * qtd),
      ]));
    }
  }

  return csvArquivo(linhas);
}
