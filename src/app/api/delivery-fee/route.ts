import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

/**
 * Calcula a taxa de entrega com base na distância real (ruas) entre o restaurante e o cliente.
 * Usa a Google Distance Matrix API para obter a distância em KM.
 * 
 * Body esperado:
 * {
 *   storeAddress: string,  // Endereço do restaurante (ou coordenadas "lat,lng")
 *   customerAddress: string, // Endereço do cliente
 *   feeRules: [{ maxKm: number, fee: number }] // Regras de preço por faixa de KM
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { storeAddress, customerAddress, feeRules, customAddressRules } = body;
    console.log('[API delivery-fee] Recebido:', { storeAddress: storeAddress?.substring(0, 40), customerAddress: customerAddress?.substring(0, 40), feeRules, customAddressRules });

    if (!storeAddress || !customerAddress) {
      return NextResponse.json({ error: 'Endereços obrigatórios.' }, { status: 400 });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json({ error: 'Chave do Google Maps não configurada no servidor.' }, { status: 500 });
    }

    // Chamar Distance Matrix API
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', storeAddress);
    url.searchParams.set('destinations', customerAddress);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    console.log('[API delivery-fee] Google Maps response status:', data.status, 'error_message:', data.error_message || 'N/A');
    console.log('[API delivery-fee] Full Google response:', JSON.stringify(data, null, 2));

    if (data.status !== 'OK') {
      const errorMsg = data.error_message 
        ? `Google Maps: ${data.error_message}` 
        : `Google Maps retornou status: ${data.status}`;
      return NextResponse.json({ error: errorMsg, details: data }, { status: 500 });
    }

    const element = data.rows?.[0]?.elements?.[0];

    if (!element || element.status !== 'OK') {
      return NextResponse.json({
        error: 'Não foi possível calcular a distância para este endereço.',
        details: element?.status || 'UNKNOWN',
      }, { status: 400 });
    }

    const distanceMeters = element.distance.value; // em metros
    const distanceKm = distanceMeters / 1000;
    const durationText = element.duration.text; // Ex: "12 min"
    const distanceText = element.distance.text; // Ex: "5.3 km"

    // Calcular a taxa com base nas regras
    let calculatedFee = 0;
    let customMatched = false;

    // Prioridade 1: Regras personalizadas por Endereço/Bairro
    if (customAddressRules && Array.isArray(customAddressRules) && customAddressRules.length > 0) {
      const customerAddrLower = customerAddress.toLowerCase();
      // Ordena por tamanho da keyword (maiores primeiro = mais específico)
      const sortedCustom = [...customAddressRules].sort((a, b) => b.keyword.length - a.keyword.length);
      for (const rule of sortedCustom) {
        if (rule.keyword && customerAddrLower.includes(rule.keyword.toLowerCase())) {
          calculatedFee = rule.fee;
          customMatched = true;
          break;
        }
      }
    }

    // Prioridade 2: Taxa por KM (se não casou com regra personalizada)
    if (!customMatched && feeRules && Array.isArray(feeRules) && feeRules.length > 0) {
      // Ordena as regras por maxKm crescente
      const sorted = [...feeRules].sort((a, b) => a.maxKm - b.maxKm);
      
      let matched = false;
      for (const rule of sorted) {
        if (distanceKm <= rule.maxKm) {
          calculatedFee = rule.fee;
          matched = true;
          break;
        }
      }

      // Se não encontrou faixa (distância maior que todas), usa a última regra
      if (!matched) {
        const lastRule = sorted[sorted.length - 1];
        // Se a última regra tem um campo 'perKmExtra', calcula por KM adicional
        if (lastRule.perKmExtra) {
          const extraKm = distanceKm - lastRule.maxKm;
          calculatedFee = lastRule.fee + (extraKm * lastRule.perKmExtra);
        } else {
          calculatedFee = lastRule.fee;
        }
      }
    }

    return NextResponse.json({
      distanceKm: Math.round(distanceKm * 10) / 10,
      distanceText,
      durationText,
      fee: Math.round(calculatedFee * 100) / 100,
      originAddress: data.origin_addresses?.[0] || storeAddress,
      destinationAddress: data.destination_addresses?.[0] || customerAddress,
    });
  } catch (err: any) {
    console.error('Erro na API delivery-fee:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
