/**
 * O histórico de compras de um cliente — todas as formas de pagamento.
 *
 * O Prazo já tinha prontuário (extrato, saldo, KPIs); quem paga à vista tinha
 * três contadores no cadastro. Aqui os números saem das COMPRAS carregadas,
 * nunca de `totalPedidos`/`ticketMedio` do cadastro: contador derivado
 * dessincroniza, e tela de conferência não pode depender disso.
 *
 * Função pura, sem Firestore e sem React — a tela decide como carregar.
 */

export type CompraDoCliente = {
  id: string;
  orderCode?: string;
  orderDateTime?: string;
  totalAmount?: number;
  paymentMethod?: string;
  orderType?: string;
  source?: string;
  status?: string;
  items?: any[];
  /** Marca de `encomendaComoPedido` — encomenda lida como pedido. */
  origem?: string;
  /** Por qual chave esta compra foi ligada ao cliente (para a tela ser honesta). */
  vinculo?: 'clienteId' | 'telefone';
};

export type QuebraPorChave = { chave: string; quantidade: number; total: number };

export type ResumoDeCompras = {
  /** Compras válidas (canceladas ficam de fora de TODOS os totais). */
  quantidade: number;
  total: number;
  ticketMedio: number;
  primeira: Date | null;
  ultima: Date | null;
  canceladas: number;
  totalCancelado: number;
  porForma: QuebraPorChave[];
  porCanal: QuebraPorChave[];
  topItens: { nome: string; quantidade: number; total: number }[];
  /** Quantas vieram pelo id do cliente e quantas só pelo telefone. */
  vinculoPorId: number;
  vinculoPorTelefone: number;
};

const naData = (valor?: string) => {
  const t = Date.parse(valor || '');
  return Number.isNaN(t) ? null : new Date(t);
};

export const foiCancelada = (compra: CompraDoCliente) => compra?.status === 'canceled';

/**
 * Rótulo da forma de pagamento pronto para agrupar.
 *
 * O campo é texto livre gravado no fechamento e a base tem de tudo: "Pix",
 * "credito" em minúsculo (legado), "Dinheiro (Troco para R$ 50.00)" e as
 * divididas com " + ". Sem normalizar, o mesmo pagamento vira três fatias.
 */
export function rotuloDaForma(paymentMethod?: string): string {
  const bruto = String(paymentMethod || '').trim();
  if (!bruto) return 'Não informado';
  if (bruto.includes(' + ')) return 'Múltiplos';
  const semTroco = bruto.split('(')[0].trim();
  if (!semTroco) return 'Não informado';
  return semTroco.charAt(0).toUpperCase() + semTroco.slice(1).toLowerCase();
}

/** De onde veio a compra, no vocabulário do dono da loja. */
export function rotuloDoCanal(compra: CompraDoCliente): string {
  if (compra?.origem === 'encomenda') return 'Encomenda';
  const tipo = String(compra?.orderType || '');
  if (tipo === 'dine_in') return 'Mesa';
  if (tipo === 'delivery') return 'Delivery';
  return compra?.source === 'pdv' ? 'Balcão' : 'Retirada';
}

function acumular(mapa: Map<string, QuebraPorChave>, chave: string, valor: number) {
  const atual = mapa.get(chave) || { chave, quantidade: 0, total: 0 };
  atual.quantidade += 1;
  atual.total += valor;
  mapa.set(chave, atual);
}

export function resumoDeCompras(compras: CompraDoCliente[]): ResumoDeCompras {
  const lista = Array.isArray(compras) ? compras : [];
  const porForma = new Map<string, QuebraPorChave>();
  const porCanal = new Map<string, QuebraPorChave>();
  const itens = new Map<string, { nome: string; quantidade: number; total: number }>();

  let quantidade = 0;
  let total = 0;
  let canceladas = 0;
  let totalCancelado = 0;
  let primeira: Date | null = null;
  let ultima: Date | null = null;
  let vinculoPorId = 0;
  let vinculoPorTelefone = 0;

  for (const compra of lista) {
    const valor = Number(compra?.totalAmount) || 0;
    if (compra?.vinculo === 'clienteId') vinculoPorId += 1;
    else if (compra?.vinculo === 'telefone') vinculoPorTelefone += 1;

    // Cancelada não soma em lugar nenhum — nem no total, nem no ticket, nem nos
    // itens mais comprados. Ela continua na LISTA, marcada, porque some da tela
    // é pior do que aparecer riscada: o operador precisa saber que existiu.
    if (foiCancelada(compra)) {
      canceladas += 1;
      totalCancelado += valor;
      continue;
    }

    quantidade += 1;
    total += valor;
    acumular(porForma, rotuloDaForma(compra?.paymentMethod), valor);
    acumular(porCanal, rotuloDoCanal(compra), valor);

    const data = naData(compra?.orderDateTime);
    if (data) {
      if (!primeira || data < primeira) primeira = data;
      if (!ultima || data > ultima) ultima = data;
    }

    for (const item of Array.isArray(compra?.items) ? compra.items : []) {
      const nome = String(item?.name || '').trim();
      if (!nome) continue;
      const qtd = Number(item?.quantity) || 0;
      const unit = Number(item?.unitPrice ?? item?.price) || 0;
      const atual = itens.get(nome) || { nome, quantidade: 0, total: 0 };
      atual.quantidade += qtd;
      atual.total += unit * qtd;
      itens.set(nome, atual);
    }
  }

  const ordenar = (mapa: Map<string, QuebraPorChave>) =>
    [...mapa.values()].sort((a, b) => b.total - a.total);

  return {
    quantidade,
    total,
    ticketMedio: quantidade > 0 ? total / quantidade : 0,
    primeira,
    ultima,
    canceladas,
    totalCancelado,
    porForma: ordenar(porForma),
    porCanal: ordenar(porCanal),
    topItens: [...itens.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, 5),
    vinculoPorId,
    vinculoPorTelefone,
  };
}

/** Ordena da compra mais nova para a mais antiga (a ordem que a tela mostra). */
export function ordenarCompras(compras: CompraDoCliente[]): CompraDoCliente[] {
  return [...(compras || [])].sort(
    (a, b) => String(b?.orderDateTime || '').localeCompare(String(a?.orderDateTime || '')),
  );
}
