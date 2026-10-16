/**
 * Quanto a loja vendeu — uma regra só, para todas as telas.
 *
 * Antes cada tela somava de um jeito e nenhuma somava tudo:
 *
 * - o **Caixa** mostrava as cinco formas de pagamento separadas e nenhum total,
 *   então a dona somava na calculadora para saber quanto tinha vendido no dia;
 * - o **Dashboard** somava só a coleção `orders`, e encomenda mora em
 *   `encomendas`. Numa confeitaria isso é o ticket alto inteiro fora da conta:
 *   em 22/08/2026 a tela dizia R$ 181,00 num dia de R$ 441,00, porque as duas
 *   encomendas entregues (R$ 260,00) não estavam em `orders`.
 *
 * O caixa é a única fonte que vê tudo: pedido, encomenda e venda avulsa passam
 * por ele quando o dinheiro entra. Por isso é ele a base daqui. O pedido que
 * nunca foi lançado (loja que não usa caixa, ou pedido que ficou sem fechar)
 * entra pelo outro lado, uma vez só — ver `faturamentoDoPeriodo`.
 *
 * **Fiado recebido não é venda.** O acerto de Prazo é gravado com
 * `tipo: 'venda'` no caixa, mas a venda já foi contada no dia da compra; somar
 * de novo no dia do acerto contaria a mesma comida duas vezes. Ele sai do total
 * de vendas e volta separado, porque o dinheiro entrou na gaveta de verdade.
 *
 * **A venda de um pedido conta no DIA DO PEDIDO, não no dia do lançamento.**
 * Delivery da tarde costuma ser finalizado na manhã seguinte, antes de fechar
 * o caixa da véspera. Datado pelo lançamento, ele saía do dia em que foi
 * vendido e entrava no dia seguinte: em 16/10/2026 a Gostinho via R$ 625,00 no
 * Dashboard de um dia de R$ 375,00, e R$ 114,00 num dia de R$ 364,00 — cinco
 * deliveries de 15/10 (R$ 250,00) lançados às 11:11 de 16/10. Já tinha
 * acontecido em 03/09 e em 01/10. O dia vai GRAVADO no lançamento
 * (`vendidoEm`, desde 16/10/2026, e os antigos foram corrigidos no banco) e é
 * lido por `momentoDaVenda`. O caixa continua sendo a gaveta (a sessão); quem
 * diz em que DIA a venda conta é o pedido. Sem aviso na tela: o registro já
 * nasce certo.
 *
 * Funções puras, sem Firestore e sem React.
 */

import { emDinheiro, somaDinheiro } from '@/lib/dinheiro';
import { nomeDaForma } from '@/lib/payment-breakdown';
import { findLegacyOrderBefore, valueToMillis } from '@/lib/order-linking';

export type LancamentoDeCaixa = {
  id?: string;
  tipo?: string;
  titulo?: string;
  valor?: unknown;
  formaPagamento?: string;
  data?: unknown;
  orderId?: string;
  encomendaId?: string;
  /** Quando o pedido foi feito, gravado junto da venda (useCaixa). */
  vendidoEm?: unknown;
  canceled?: boolean;
};

export type PedidoDoFaturamento = {
  id?: string;
  status?: string;
  totalAmount?: unknown;
  orderDateTime?: unknown;
  createdAt?: unknown;
};

/** De onde veio o dinheiro. `fiado_recebido` não é venda nova. */
export type OrigemDoDinheiro = 'pedido' | 'encomenda' | 'avulsa' | 'fiado_recebido';

export type EntradaDeFaturamento = {
  id: string;
  /** Em que momento a venda CONTA: o do pedido, quando há um (ver `momentoDaVenda`). */
  quando: number | null;
  /** Quando o dinheiro foi lançado no caixa. Difere de `quando` no pedido fechado depois. */
  lancadoEm: number | null;
  valor: number;
  forma: string;
  origem: OrigemDoDinheiro;
  /** Que venda é esta. Duas formas de pagamento da mesma venda dividem o vínculo. */
  vinculo: string | null;
};

export type ResumoDeVendas = {
  /** Pedido + encomenda + venda avulsa. É "quanto vendi". */
  totalVendas: number;
  /** Acerto de Prazo: dívida antiga que foi paga agora. */
  fiadoRecebido: number;
  /** Tudo que foi lançado como venda — bate com a soma das formas na tela. */
  totalRecebido: number;
  porOrigem: { pedido: number; encomenda: number; avulsa: number };
  entradas: EntradaDeFaturamento[];
};

const CANCELADO = new Set(['canceled', 'cancelada', 'cancelled', 'cancelado']);

/** Pedido/encomenda que não conta em faturamento nenhum. */
export function foiCancelado(registro: { status?: string } | null | undefined): boolean {
  return CANCELADO.has(String(registro?.status || '').toLowerCase());
}

/**
 * Acerto de Prazo — mesma regra de `lib/acerto-prazo-link`, repetida aqui em
 * vez de importada para esta lib não depender da cadeia do caixa.
 */
export function ehFiadoRecebido(lancamento: LancamentoDeCaixa): boolean {
  return /^\s*acerto de prazo\b/i.test(lancamento?.titulo || '');
}

/** Lançamento que representa dinheiro entrando: venda, e não cancelada. */
export function ehEntradaDeVenda(lancamento: LancamentoDeCaixa): boolean {
  return lancamento?.tipo === 'venda' && !lancamento?.canceled;
}

/**
 * Encomenda reconhecida pelo id gravado ou pelo título.
 *
 * O `encomendaId` só existe nos lançamentos novos; nos antigos sobra o título
 * "Encomenda XXXXX - Entrega (Fulana)", que é o que a tela sempre mostrou.
 */
export function origemDoLancamento(lancamento: LancamentoDeCaixa): OrigemDoDinheiro {
  if (ehFiadoRecebido(lancamento)) return 'fiado_recebido';
  if (lancamento?.encomendaId || /^\s*encomenda\b/i.test(lancamento?.titulo || '')) return 'encomenda';
  if (lancamento?.orderId || /#[A-Za-z0-9]+/.test(lancamento?.titulo || '')) return 'pedido';
  return 'avulsa';
}

/**
 * Que venda o lançamento representa.
 *
 * Uma venda paga em duas formas gera dois lançamentos (ver
 * `registrarPagamentoSplits`): sem isto ela contaria como dois pedidos e
 * derrubaria o ticket médio pela metade. Mesma ideia de
 * `caixa-lancamentos.chaveDeVinculo`, mais o título antigo de encomenda, que lá
 * não é preciso porque a tela agrupa por outro caminho.
 */
export function vinculoDoLancamento(lancamento: LancamentoDeCaixa): string | null {
  if (lancamento?.orderId) return `o:${lancamento.orderId}`;
  if (lancamento?.encomendaId) return `e:${lancamento.encomendaId}`;
  const titulo = lancamento?.titulo || '';
  const daEncomenda = titulo.match(/^\s*encomenda\s+([A-Za-z0-9]+)/i);
  if (daEncomenda) return `e:${daEncomenda[1]}`;
  const doPedido = titulo.match(/#([A-Za-z0-9]+)/);
  if (doPedido) return `t:${doPedido[1].substring(0, 5)}`;
  return null;
}

/** Quantas vendas, e não quantos lançamentos: a dividida conta uma vez. */
export function contarVendas(entradas: EntradaDeFaturamento[]): number {
  const vinculos = new Set<string>();
  let soltas = 0;
  for (const entrada of entradas) {
    if (entrada.origem === 'fiado_recebido') continue;
    if (entrada.vinculo) vinculos.add(entrada.vinculo);
    else soltas += 1;
  }
  return vinculos.size + soltas;
}

function dentroDaJanela(quando: number | null, de?: Date | null, ate?: Date | null): boolean {
  if (!de && !ate) return true;
  if (quando == null) return false;
  if (de && quando < de.getTime()) return false;
  if (ate && quando >= ate.getTime()) return false;
  return true;
}

/**
 * O que entrou pelo caixa, já separado por origem.
 *
 * `de`/`ate` são opcionais: o Caixa passa a sessão inteira (sem janela) e o
 * Dashboard passa o período escolhido. `ate` é exclusivo, igual ao resto do app.
 */
/** Quando o pedido foi feito — a mesma leitura do resto do Dashboard. */
function momentoDoPedido(pedido: PedidoDoFaturamento | null | undefined): number | null {
  return valueToMillis(pedido?.orderDateTime) ?? valueToMillis(pedido?.createdAt);
}

/** Folga para relógio de máquina: pedido "depois" do próprio lançamento. */
const FOLGA_DO_RELOGIO_MS = 10 * 60 * 1000;

/**
 * Em que momento a venda conta: o do PEDIDO. Primeiro o `vendidoEm` gravado
 * no próprio lançamento; sem ele (lançamento que escapou da correção do banco),
 * o pedido apontado pelo `orderId`, ou pelo "#" do título antigo com a regra
 * conservadora de sempre. Encomenda, acerto de Prazo e venda avulsa ficam no momento do
 * lançamento: o sinal e a entrega da encomenda são dias diferentes de
 * propósito, e o acerto é dinheiro que entrou naquele dia.
 *
 * Pedido sem data legível, ou com data muito depois do próprio lançamento
 * (relógio errado), também fica no lançamento — nunca some do faturamento.
 */
export function momentoDaVenda(
  lancamento: LancamentoDeCaixa,
  pedidos: PedidoDoFaturamento[] | Map<string, PedidoDoFaturamento> | null | undefined,
): number | null {
  const lancadoEm = valueToMillis(lancamento?.data);
  if (origemDoLancamento(lancamento) !== 'pedido') return lancadoEm;
  const gravado = valueToMillis(lancamento.vendidoEm);
  if (gravado != null && (lancadoEm == null || gravado <= lancadoEm + FOLGA_DO_RELOGIO_MS)) return gravado;
  // Comanda de mesa sem o dia gravado fica no fechamento: a abertura do pedido
  // não diz quando se consumiu (mesa esquecida aberta é reaproveitada).
  if (/^\s*mesa\b/i.test(lancamento.titulo || '')) return lancadoEm;

  const porId = pedidos instanceof Map ? pedidos : null;
  const lista = pedidos instanceof Map ? null : Array.isArray(pedidos) ? pedidos : [];
  let pedido: PedidoDoFaturamento | null = null;
  if (lancamento.orderId) {
    pedido = porId ? porId.get(lancamento.orderId) || null : lista!.find((p) => p?.id === lancamento.orderId) || null;
  } else {
    const achou = (lancamento.titulo || '').match(/#([A-Za-z0-9]+)/);
    if (achou) pedido = findLegacyOrderBefore(porId ? [...porId.values()] : lista!, achou[1], lancamento.data);
  }

  const doPedido = momentoDoPedido(pedido);
  if (doPedido == null) return lancadoEm;
  if (lancadoEm != null && doPedido > lancadoEm + FOLGA_DO_RELOGIO_MS) return lancadoEm;
  return doPedido;
}

export function resumoDeVendasDoCaixa(
  lancamentos: LancamentoDeCaixa[] | null | undefined,
  janela: { de?: Date | null; ate?: Date | null } = {},
  opcoes: { pedidos?: PedidoDoFaturamento[] | null } = {},
): ResumoDeVendas {
  const entradas: EntradaDeFaturamento[] = [];
  const porOrigem = { pedido: 0, encomenda: 0, avulsa: 0 };
  let totalVendas = 0;
  let fiadoRecebido = 0;
  // Map uma vez só: o Dashboard passa a coleção inteira de pedidos da loja.
  const pedidos = Array.isArray(opcoes.pedidos)
    ? new Map(opcoes.pedidos.filter((p) => p?.id).map((p) => [p.id as string, p]))
    : null;

  for (const lancamento of Array.isArray(lancamentos) ? lancamentos : []) {
    if (!ehEntradaDeVenda(lancamento)) continue;
    const lancadoEm = valueToMillis(lancamento.data);
    // O `vendidoEm` gravado vale mesmo sem a lista de pedidos.
    const quando = momentoDaVenda(lancamento, pedidos);
    if (!dentroDaJanela(quando, janela.de, janela.ate)) continue;

    const valor = emDinheiro(lancamento.valor);
    const origem = origemDoLancamento(lancamento);
    entradas.push({
      id: String(lancamento.id || ''),
      quando,
      lancadoEm,
      valor,
      forma: nomeDaForma(lancamento.formaPagamento || ''),
      origem,
      vinculo: vinculoDoLancamento(lancamento),
    });

    if (origem === 'fiado_recebido') {
      fiadoRecebido = somaDinheiro(fiadoRecebido, valor);
      continue;
    }
    porOrigem[origem] = somaDinheiro(porOrigem[origem], valor);
    totalVendas = somaDinheiro(totalVendas, valor);
  }

  return {
    totalVendas,
    fiadoRecebido,
    totalRecebido: somaDinheiro(totalVendas, fiadoRecebido),
    porOrigem,
    entradas,
  };
}

/**
 * Os pedidos que o caixa já conhece — para não contar o mesmo dinheiro duas
 * vezes ao juntar as duas fontes.
 *
 * O vínculo por `orderId` é o dos lançamentos novos. Nos antigos só há o
 * "#XXXXX" do título, e aí vale a mesma regra conservadora do Caixa
 * (`findLegacyOrderBefore`): casa apenas quando há um único pedido possível e
 * ele é anterior ao lançamento. Prefixo ambíguo fica de fora — o pedido volta
 * pela outra ponta e no máximo aparece uma vez, nunca duas.
 */
export function pedidosJaNoCaixa(
  lancamentos: LancamentoDeCaixa[] | null | undefined,
  pedidos: PedidoDoFaturamento[] | null | undefined,
): Set<string> {
  const cobertos = new Set<string>();
  const lista = Array.isArray(pedidos) ? pedidos : [];

  for (const lancamento of Array.isArray(lancamentos) ? lancamentos : []) {
    if (!ehEntradaDeVenda(lancamento)) continue;
    if (lancamento.orderId) {
      cobertos.add(lancamento.orderId);
      continue;
    }
    if (lancamento.encomendaId || ehFiadoRecebido(lancamento)) continue;
    const achou = (lancamento.titulo || '').match(/#([A-Za-z0-9]+)/);
    if (!achou) continue;
    const pedido = findLegacyOrderBefore(lista, achou[1], lancamento.data);
    if (pedido?.id) cobertos.add(pedido.id);
  }

  return cobertos;
}

/** Chave "AAAA-MM-DD" no fuso local — o dia como a loja conta o dia. */
function chaveDoDia(quando: number | null): string | null {
  if (quando == null) return null;
  const d = new Date(quando);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Os dias em que o caixa estava operando.
 *
 * É o que decide se um pedido sem lançamento deve ser somado. Nem todo
 * lançamento sabe de que pedido veio: a comanda de mesa antiga grava só
 * "Mesa 5 - Finalizada", sem id e sem "#" — são 188 lançamentos assim (R$ 8.062)
 * só na Sucos e Vitaminas. Somar o caixa E o pedido de mesa contaria as duas
 * pontas do mesmo almoço.
 *
 * A regra: **no dia em que o caixa foi usado, o caixa é a conta.** O pedido
 * entra por fora apenas nos dias sem lançamento nenhum — a loja que ainda não
 * usa caixa, e o dia em que ele não foi aberto. Errar para menos aqui é o lado
 * seguro: o pedido que ficou sem lançar aparece na auditoria
 * (`npm run audit:faturamento`), enquanto dinheiro dobrado passaria despercebido.
 */
export function diasComCaixa(
  lancamentos: LancamentoDeCaixa[] | null | undefined,
  pedidos?: PedidoDoFaturamento[] | null,
): Set<string> {
  const dias = new Set<string>();
  const porId = Array.isArray(pedidos)
    ? new Map(pedidos.filter((p) => p?.id).map((p) => [p.id as string, p]))
    : null;
  for (const lancamento of Array.isArray(lancamentos) ? lancamentos : []) {
    if (!ehEntradaDeVenda(lancamento)) continue;
    const chave = chaveDoDia(valueToMillis(lancamento.data));
    if (chave) dias.add(chave);
    // O dia em que a venda CONTA também é dia com caixa: delivery de ontem
    // lançado hoje cedo fez ontem usar o caixa, mesmo sem lançamento datado
    // ontem. Sem isso, o pedido sem lançamento daquele dia entraria por fora.
    if (porId) {
      const doPedido = chaveDoDia(momentoDaVenda(lancamento, porId));
      if (doPedido) dias.add(doPedido);
    }
  }
  return dias;
}

export type FaturamentoDoPeriodo = ResumoDeVendas & {
  /** Vendas que só existem em `orders`: nunca passaram pelo caixa. */
  foraDoCaixa: number;
  /** Quantas vendas (lançamento agrupado + pedido sem lançamento). */
  quantidade: number;
};

/**
 * O faturamento de um período, sem furo e sem dobra.
 *
 * Caixa primeiro (é onde encomenda e venda avulsa aparecem), e depois os
 * pedidos válidos que nenhum lançamento cobre — o caso da loja que ainda não
 * usa o caixa, e o do pedido que ficou sem fechar. O fiado recebido fica de
 * fora do total de vendas e volta em `fiadoRecebido`.
 */
export function faturamentoDoPeriodo(dados: {
  lancamentos?: LancamentoDeCaixa[] | null;
  pedidos?: PedidoDoFaturamento[] | null;
  de?: Date | null;
  ate?: Date | null;
}): FaturamentoDoPeriodo {
  const { lancamentos, pedidos, de, ate } = dados;
  const doCaixa = resumoDeVendasDoCaixa(lancamentos, { de, ate }, { pedidos });
  const lista = Array.isArray(pedidos) ? pedidos : [];
  const cobertos = pedidosJaNoCaixa(lancamentos, lista);
  const comCaixa = diasComCaixa(lancamentos, lista);

  const entradas = [...doCaixa.entradas];
  let foraDoCaixa = 0;

  for (const pedido of lista) {
    if (!pedido?.id || foiCancelado(pedido) || cobertos.has(pedido.id)) continue;
    const quando = valueToMillis(pedido.orderDateTime) ?? valueToMillis(pedido.createdAt);
    if (!dentroDaJanela(quando, de, ate)) continue;
    if (comCaixa.has(chaveDoDia(quando) as string)) continue;
    const valor = emDinheiro(pedido.totalAmount);
    if (valor === 0) continue;
    foraDoCaixa = somaDinheiro(foraDoCaixa, valor);
    entradas.push({
      id: pedido.id,
      quando,
      lancadoEm: null,
      valor,
      forma: 'Não definido',
      origem: 'pedido',
      vinculo: `o:${pedido.id}`,
    });
  }

  const totalVendas = somaDinheiro(doCaixa.totalVendas, foraDoCaixa);
  return {
    ...doCaixa,
    entradas,
    foraDoCaixa,
    totalVendas,
    totalRecebido: somaDinheiro(totalVendas, doCaixa.fiadoRecebido),
    porOrigem: { ...doCaixa.porOrigem, pedido: somaDinheiro(doCaixa.porOrigem.pedido, foraDoCaixa) },
    quantidade: contarVendas(entradas),
  };
}

export type VendaDoPeriodo = {
  /** Chave da venda; `null` só na venda avulsa antiga, que não aponta para nada. */
  vinculo: string | null;
  /** Quando o dinheiro entrou (o último recebimento, quando houve mais de um). */
  quando: number | null;
  valor: number;
  origem: OrigemDoDinheiro;
  formas: string[];
  /** O pedido ou a encomenda que originou a venda, quando dá para achar. */
  documento: any | null;
};

/**
 * As vendas de um período, uma linha por venda, com o documento de origem.
 *
 * É o que faz o Dashboard inteiro falar a mesma língua do Caixa: o valor vem do
 * dinheiro lançado (encomenda inclusive), e o canal, os itens e o cliente vêm
 * do documento — sem que nenhuma parte da tela some por um critério diferente
 * das outras.
 */
export function vendasDoPeriodo(dados: {
  lancamentos?: LancamentoDeCaixa[] | null;
  pedidos?: PedidoDoFaturamento[] | null;
  encomendas?: { id?: string }[] | null;
  de?: Date | null;
  ate?: Date | null;
}): VendaDoPeriodo[] {
  const { lancamentos, pedidos, encomendas, de, ate } = dados;
  const listaPedidos = Array.isArray(pedidos) ? pedidos : [];
  const listaEncomendas = Array.isArray(encomendas) ? encomendas : [];
  const porId = new Map(listaPedidos.filter((p) => p?.id).map((p) => [p.id as string, p]));
  const encomendaPorId = new Map(listaEncomendas.filter((e) => e?.id).map((e) => [e.id as string, e]));

  const acharEncomenda = (chave: string) =>
    encomendaPorId.get(chave) ||
    // Lançamento antigo guarda só os 5 primeiros caracteres, no título.
    listaEncomendas.find((e) => String(e?.id || '').startsWith(chave)) ||
    null;

  const { entradas } = resumoDeVendasDoCaixa(lancamentos, { de, ate }, { pedidos: listaPedidos });
  const porVinculo = new Map<string, VendaDoPeriodo>();
  const vendas: VendaDoPeriodo[] = [];

  for (const entrada of entradas) {
    if (entrada.origem === 'fiado_recebido') continue;

    const existente = entrada.vinculo ? porVinculo.get(entrada.vinculo) : undefined;
    if (existente) {
      existente.valor = somaDinheiro(existente.valor, entrada.valor);
      if (!existente.formas.includes(entrada.forma)) existente.formas.push(entrada.forma);
      if ((entrada.quando ?? 0) > (existente.quando ?? 0)) existente.quando = entrada.quando;
      continue;
    }

    const chave = entrada.vinculo ? entrada.vinculo.slice(2) : '';
    const documento = !entrada.vinculo
      ? null
      : entrada.vinculo.startsWith('e:')
        ? acharEncomenda(chave)
        : entrada.vinculo.startsWith('o:')
          ? porId.get(chave) || null
          : findLegacyOrderBefore(listaPedidos, chave, entrada.quando);

    const venda: VendaDoPeriodo = {
      vinculo: entrada.vinculo,
      quando: entrada.quando,
      valor: entrada.valor,
      origem: entrada.origem,
      formas: [entrada.forma],
      documento,
    };
    vendas.push(venda);
    if (entrada.vinculo) porVinculo.set(entrada.vinculo, venda);
  }

  // Pedido que nunca passou pelo caixa entra pelo próprio documento.
  const cobertos = pedidosJaNoCaixa(lancamentos, listaPedidos);
  const comCaixa = diasComCaixa(lancamentos, listaPedidos);
  for (const pedido of listaPedidos) {
    if (!pedido?.id || foiCancelado(pedido) || cobertos.has(pedido.id)) continue;
    if (porVinculo.has(`o:${pedido.id}`)) continue;
    const quando = valueToMillis(pedido.orderDateTime) ?? valueToMillis(pedido.createdAt);
    if (!dentroDaJanela(quando, de, ate)) continue;
    if (comCaixa.has(chaveDoDia(quando) as string)) continue;
    const valor = emDinheiro(pedido.totalAmount);
    if (valor === 0) continue;
    vendas.push({
      vinculo: `o:${pedido.id}`,
      quando,
      valor,
      origem: 'pedido',
      formas: [],
      documento: pedido,
    });
  }

  return vendas.sort((a, b) => (a.quando ?? 0) - (b.quando ?? 0));
}

/** Faturamento por forma de pagamento, do que mais entrou para o que menos. */
export function porFormaDePagamento(
  entradas: EntradaDeFaturamento[],
  opcoes: { incluirFiado?: boolean } = {},
): { forma: string; total: number; vendas: number }[] {
  const mapa = new Map<string, { total: number; vendas: number }>();
  for (const entrada of entradas) {
    if (entrada.origem === 'fiado_recebido' && !opcoes.incluirFiado) continue;
    const atual = mapa.get(entrada.forma) || { total: 0, vendas: 0 };
    atual.total = somaDinheiro(atual.total, entrada.valor);
    atual.vendas += 1;
    mapa.set(entrada.forma, atual);
  }
  return [...mapa.entries()]
    .map(([forma, dados]) => ({ forma, ...dados }))
    .sort((a, b) => b.total - a.total);
}
