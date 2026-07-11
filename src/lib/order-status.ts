// Cores do badge de status do pedido — fonte única. Os *labels* NÃO ficam aqui
// de propósito: cada superfície usa um texto próprio (o admin mostra "Em preparo"
// para `received`, o cliente vê "Pedido Recebido", etc.), então unificá-los seria
// mudar a UX. As cores, ao contrário, eram idênticas em my-orders e DeliveryTab.

export type OrderStatus =
  | 'pending'
  | 'received'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'canceled';

const STATUS_BADGE_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500 text-white',
  received: 'bg-blue-500 text-white',
  ready: 'bg-green-500 text-white',
  out_for_delivery: 'bg-purple-500 text-white',
  delivered: 'bg-teal-500 text-white',
  canceled: 'bg-red-500 text-white',
};

/** Classe Tailwind do badge (fundo + texto) para o status; cinza como fallback. */
export const getOrderStatusBadgeColor = (status: string): string =>
  STATUS_BADGE_COLORS[status] || 'bg-gray-500 text-white';
