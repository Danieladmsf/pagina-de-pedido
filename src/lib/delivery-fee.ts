// Chamada única ao /api/delivery-fee. Os três pontos de entrada (CartDrawer no
// cardápio, NovoPedidoTab no PDV e EncomendaWizard) precisam mandar o MESMO
// payload — historicamente isso saiu de sincronia (memória
// delivery-fee-two-entry-points). Centralizar o request garante o formato; cada
// chamador mantém seu próprio tratamento da resposta (raio máximo, fallback, etc.).

export type DeliveryFeeParams = {
  storeAddress: string;
  customerAddress: string;
  feeRules?: any[];
  customAddressRules?: any[];
  neighborhoodHint?: string;
};

export type DeliveryFeeResult = {
  ok: boolean;
  data: any; // { fee, distanceKm, distanceText, durationText, originAddress, destinationAddress, error }
};

/**
 * POST no /api/delivery-fee com o payload canônico. Não trata erros nem parseia
 * regras de negócio: devolve `{ ok, data }` e deixa o chamador decidir. Erros de
 * rede/parse propagam (o try/catch de cada chamador continua valendo).
 */
export async function fetchDeliveryFee(params: DeliveryFeeParams): Promise<DeliveryFeeResult> {
  const res = await fetch('/api/delivery-fee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeAddress: params.storeAddress,
      customerAddress: params.customerAddress,
      feeRules: params.feeRules,
      customAddressRules: params.customAddressRules,
      neighborhoodHint: params.neighborhoodHint,
    }),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}
