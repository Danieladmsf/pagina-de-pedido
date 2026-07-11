// Formas de pagamento do fechamento — fonte única (antes copiada em
// NovoPedidoTab, MesasTab e DeliveryTab).

export type FormaPagamento = { id: string; label: string; icon: string; active: boolean };

export const DEFAULT_FORMAS_PAGAMENTO: FormaPagamento[] = [
  { id: 'dinheiro', label: 'Dinheiro', icon: '💵', active: true },
  { id: 'pix', label: 'Pix', icon: '📱', active: true },
  { id: 'debito', label: 'Débito', icon: '💳', active: true },
  { id: 'credito', label: 'Crédito', icon: '💳', active: true },
];

// Resolve as formas ativas do perfil da loja (fallback nas padrão) e garante
// que "Prazo" (conta_casa) esteja sempre disponível no fechamento interno.
export function resolveFormasPagamento(storeProfile: any): FormaPagamento[] {
  const base = (storeProfile?.paymentMethods && storeProfile.paymentMethods.length > 0
    ? storeProfile.paymentMethods
    : DEFAULT_FORMAS_PAGAMENTO
  ).filter((m: any) => m.active);
  const formas = [...base];
  if (!formas.find((m: any) => m.id === 'conta_casa')) {
    formas.push({ id: 'conta_casa', label: 'Prazo', icon: '📝', active: true });
  }
  return formas;
}
