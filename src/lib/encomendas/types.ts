// Shape do documento persistido na coleção `encomendas` (Firestore).
// Espelha o modelo de `orders` (customerUid + ownerId) mas em coleção própria,
// não filtrada pela janela do caixa. Escrito pelo wizard público; lido pela aba
// admin "Encomendas". Mantém os itens já resolvidos (nome/preço) para a aba e o
// cupom não precisarem recalcular a partir do catálogo.

export type EncomendaStatus =
  | 'orcamento'   // pedido recebido pelo cliente (aguardando confirmação do lojista)
  | 'confirmada'  // lojista confirmou (sinal pago)
  | 'producao'    // em produção
  | 'pronta'      // pronta para retirada/entrega
  | 'entregue'    // finalizada
  | 'cancelada';

export const ENCOMENDA_STATUS_LABEL: Record<EncomendaStatus, string> = {
  orcamento: 'Orçamento',
  confirmada: 'Confirmada',
  producao: 'Em produção',
  pronta: 'Pronta',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

export interface EncomendaLineItem {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface EncomendaBolo {
  sizeId: string;
  size: string;        // label (P/M/G/...)
  dough: string;
  filling: string;     // nome do recheio
  cover: string;       // nome da cobertura
  plate: { on: boolean; name?: string; age?: string; theme?: string; notes?: string; imageUrl?: string };
  total: number;
}

export interface Encomenda {
  id: string;
  customerUid: string;
  ownerId: string;

  customerName: string;
  customerPhone: string;        // normalizado (só dígitos)
  customerBirthDate?: string;
  isEmpresa: boolean;

  products: string[];           // ['bolo','tortas','docinhos','especial']
  bolo: EncomendaBolo | null;
  especialItems: EncomendaLineItem[];
  tortasItems: EncomendaLineItem[];
  docinhosItems: EncomendaLineItem[];

  delivery: {
    date: string;
    time: string;
    type: 'retirada' | 'delivery' | '';
    // Preenchidos quando type === 'delivery'
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    feeStatus?: 'calculada' | 'a_combinar'; // taxa veio do /api/delivery-fee ou ficou pendente
  };

  subtotal: number;
  deliveryFee: number;
  total: number;
  sinalPercent: number;
  sinal: number;
  saldo: number;

  status: EncomendaStatus;
  sinalLancado?: boolean;       // sinal já registrado no caixa (trava contra lançamento duplo)
  comprovanteUrl?: string;      // comprovante do PIX do sinal (upload opcional do cliente)
  orderNotes?: string;
  source: string;               // 'encomenda_web'
  orderDateTime: string;        // ISO local
  createdAt?: any;              // serverTimestamp()
}
