import type { LancamentoCaixa } from '@/hooks/useCaixa';

/**
 * Linha da lista do caixa. Normalmente é um lançamento só; numa venda paga em
 * várias formas, `partes` traz todas e `valor` é a soma delas.
 */
export type LinhaCaixa = {
  key: string;
  principal: LancamentoCaixa;
  partes: LancamentoCaixa[];
  valor: number;
};

/**
 * Agrupa, para EXIBIÇÃO, as partes de uma venda paga em várias formas.
 *
 * Uma venda dividida gera um lançamento POR FORMA (ver `registrarPagamentoSplits`
 * em lib/payments.ts), todos com o mesmo título — inclusive o "#id" do pedido.
 * Na lista isso virava duas linhas que expandiam a MESMA lista de itens, dando a
 * impressão de que o produto dobrou. O dinheiro nunca dobrou: cada parte carrega
 * só a sua fatia. Mas na conferência engana, que é justamente a hora errada.
 *
 * É agrupamento SÓ de exibição: os somatórios do caixa continuam lendo os
 * lançamentos individuais, então nenhum cálculo depende disto.
 *
 * Regras:
 * - só agrupa `tipo === 'venda'` que saiba de onde veio: `orderId`/`encomendaId`
 *   gravados (lançamentos novos) ou o "#id" do título (os antigos). Venda manual
 *   não tem nenhum dos dois e nunca agrupa — melhor uma linha por lançamento do
 *   que juntar vendas diferentes;
 * - o id gravado vem ANTES do título de propósito: "Mesa 5 - Finalizada" se
 *   repete o dia inteiro, então agrupar mesa por título juntaria comandas
 *   diferentes. Com o id, cada comanda é ela mesma;
 * - canceladas agrupam entre si, para um estado misto (legado, ou falha no meio
 *   do cancelamento) continuar visível em vez de sumir dentro de uma linha só;
 * - a ordem da lista original é preservada, e a linha nasce na posição da
 *   primeira parte.
 */
export function chaveDeVinculo(l: LancamentoCaixa): string | null {
  if (l.tipo !== 'venda') return null;
  if (l.orderId) return `o:${l.orderId}`;
  if (l.encomendaId) return `e:${l.encomendaId}`;
  const m = (l.titulo || '').match(/#([A-Za-z0-9]+)/);
  return m ? `t:${m[1].substring(0, 5)}` : null;
}

export function agruparLancamentosCaixa(lancamentos: LancamentoCaixa[]): LinhaCaixa[] {
  const linhas: LinhaCaixa[] = [];
  const porChave = new Map<string, LinhaCaixa>();

  for (const l of lancamentos) {
    const vinculo = chaveDeVinculo(l);
    const chave = vinculo ? `${vinculo}|${l.canceled ? 'c' : 'a'}` : null;

    const existente = chave ? porChave.get(chave) : undefined;
    if (existente) {
      existente.partes.push(l);
      existente.valor += l.valor;
      continue;
    }

    const linha: LinhaCaixa = { key: l.id, principal: l, partes: [l], valor: l.valor };
    linhas.push(linha);
    if (chave) porChave.set(chave, linha);
  }

  return linhas;
}
