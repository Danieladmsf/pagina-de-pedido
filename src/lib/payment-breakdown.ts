/**
 * O que a loja recebeu em cada forma de pagamento.
 *
 * A venda guarda o pagamento como TEXTO, montado pelo fechamento. Quando ela é
 * dividida, esse texto é a frase inteira — "Pix: R$ 59.30 | Pix: R$ 28.40 |
 * Débito: R$ 38.40" — e ainda pode terminar com uma nota entre parênteses
 * ("(Troco para R$ 100.00)", "(Taxa de entrega paga direto ao motoboy)").
 *
 * Agrupar por essa frase, como o Dashboard fazia, tem dois defeitos: cada
 * combinação de divisão vira uma "forma de pagamento" própria na tela, e o Pix
 * daquela venda não entra no Pix. Aqui a frase é quebrada nas partes que ela
 * representa, com o valor de cada uma.
 *
 * Função pura, sem Firestore e sem React.
 */

import { emDinheiro, somaDinheiro } from '@/lib/dinheiro';

export type ParteDoPagamento = { forma: string; valor: number };

export type FaturamentoDaForma = {
  forma: string;
  total: number;
  /** Em quantas vendas essa forma apareceu (a dividida conta uma vez em cada). */
  vendas: number;
};

export type VendaParaFaturamento = { paymentMethod?: string; totalAmount?: number };

/**
 * Nomes canônicos. O cardápio público grava o id da forma em minúsculo
 * ("credito"), o fechamento grava o rótulo do perfil da loja ("Crédito") e o
 * fiado é `conta_casa` em um lugar e "Prazo" no outro — tudo isso é a mesma
 * linha na tela. Forma que a loja criou no perfil e não está aqui passa direto,
 * só com a primeira letra maiúscula.
 */
const NOME_CANONICO: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
  cartao: 'Cartão',
  conta_casa: 'Prazo',
  contacasa: 'Prazo',
  prazo: 'Prazo',
  fiado: 'Prazo',
};

const semAcento = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function nomeDaForma(bruto: string): string {
  const limpo = String(bruto || '').trim().replace(/[.:,;]+$/, '').trim();
  if (!limpo) return 'Não definido';
  const chave = semAcento(limpo.toLowerCase()).replace(/[\s-]+/g, '_');
  return NOME_CANONICO[chave] || limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/** "59.30" e "1.234,56" viram número; texto sem número vira null. */
function valorDoTexto(bruto: string): number | null {
  const cru = String(bruto || '').trim();
  if (!cru) return null;
  let normalizado = cru;
  if (cru.includes(',')) {
    normalizado = cru.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cru)) {
    // "1.234" é mil e duzentos e trinta e quatro, não um e pouco.
    normalizado = cru.replace(/\./g, '');
  }
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? emDinheiro(numero) : null;
}

/**
 * Quebra o texto do pagamento de UMA venda nas partes que ele representa.
 *
 * Sem valor declarado (o caso comum: uma forma só), a parte leva o total da
 * venda. Numa divisão em que só algumas partes trazem valor, o que sobra do
 * total é repartido entre as outras — some centavo nenhum do faturamento.
 */
export function partesDoPagamento(
  paymentMethod: unknown,
  totalDaVenda: unknown,
): ParteDoPagamento[] {
  const total = emDinheiro(totalDaVenda);
  const bruto = String(paymentMethod ?? '').trim();
  if (!bruto) return [{ forma: 'Não definido', valor: total }];

  // Nota entre parênteses não é forma de pagamento: troco e aviso de frete
  // entrariam na tela como se fossem uma.
  const semNotas = bruto.replace(/\([^)]*\)/g, ' ').trim();
  if (!semNotas) return [{ forma: 'Não definido', valor: total }];

  const pedacos = semNotas.split(/\s*[|+;]\s*/).map(p => p.trim()).filter(Boolean);
  const partes = pedacos.map((pedaco) => {
    const casou = pedaco.match(/^(.*?)[:\s]\s*R\$\s*([\d.,]+)\s*$/);
    if (casou) {
      const valor = valorDoTexto(casou[2]);
      if (valor !== null) return { forma: nomeDaForma(casou[1]), valor };
    }
    return { forma: nomeDaForma(pedaco), valor: null as number | null };
  });

  const semValor = partes.filter(p => p.valor === null);
  if (semValor.length === 0) {
    return partes as ParteDoPagamento[];
  }

  const declarado = somaDinheiro(...partes.map(p => p.valor || 0));
  const sobra = emDinheiro(Math.max(0, total - declarado));
  const porParte = emDinheiro(sobra / semValor.length);
  return partes.map(p => ({ forma: p.forma, valor: p.valor === null ? porParte : p.valor }));
}

/** Soma o faturamento de cada forma, da que mais entrou para a que menos. */
export function faturamentoPorPagamento(
  vendas: VendaParaFaturamento[],
): FaturamentoDaForma[] {
  const porForma = new Map<string, { total: number; vendas: number }>();

  for (const venda of Array.isArray(vendas) ? vendas : []) {
    const formasDaVenda = new Set<string>();
    for (const parte of partesDoPagamento(venda?.paymentMethod, venda?.totalAmount)) {
      const atual = porForma.get(parte.forma) || { total: 0, vendas: 0 };
      atual.total = somaDinheiro(atual.total, parte.valor);
      if (!formasDaVenda.has(parte.forma)) {
        atual.vendas += 1;
        formasDaVenda.add(parte.forma);
      }
      porForma.set(parte.forma, atual);
    }
  }

  return [...porForma.entries()]
    .map(([forma, dados]) => ({ forma, total: dados.total, vendas: dados.vendas }))
    .sort((a, b) => b.total - a.total);
}
