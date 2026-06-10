import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

// Proteções contra abuso da cota paga do Google:
// limite por IP em memória (vale por instância do servidor — freia rajadas
// e scripts, não substitui um rate-limit distribuído).
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitHits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitHits.get(ip);
  if (!entry || now > entry.resetAt) {
    // Limpeza oportunista para o Map não crescer sem limite
    if (rateLimitHits.size > 5000) rateLimitHits.clear();
    rateLimitHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

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
    // Só o próprio cardápio (mesma origem) pode usar este proxy; bloqueia
    // outros sites de consumirem a cota do Google via navegador dos visitantes.
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin && host && new URL(origin).host !== host) {
      return NextResponse.json({ error: 'Origem não autorizada.' }, { status: 403 });
    }

    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Muitas requisições. Tente novamente em instantes.' }, { status: 429 });
    }

    const body = await req.json();
    const { storeAddress, customerAddress, feeRules, customAddressRules, neighborhoodHint } = body;

    if (!storeAddress || !customerAddress) {
      return NextResponse.json({ error: 'Endereços obrigatórios.' }, { status: 400 });
    }

    if (typeof storeAddress !== 'string' || typeof customerAddress !== 'string' ||
        storeAddress.length > 300 || customerAddress.length > 300) {
      return NextResponse.json({ error: 'Endereço inválido.' }, { status: 400 });
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

    if (data.status !== 'OK') {
      console.warn('[API delivery-fee] Google Maps falhou:', data.status, data.error_message);
    }

    const element = data.rows?.[0]?.elements?.[0];
    
    let distanceKm = 0;
    let distanceText = '';
    let durationText = '';
    let originAddress = storeAddress;
    let destinationAddress = customerAddress;
    let mapsErrorMsg = '';

    if (data.status === 'OK' && element && element.status === 'OK') {
      distanceKm = element.distance.value / 1000;
      durationText = element.duration.text;
      distanceText = element.distance.text;
      originAddress = data.origin_addresses?.[0] || storeAddress;
      destinationAddress = data.destination_addresses?.[0] || customerAddress;
    } else {
      mapsErrorMsg = data.error_message || `Google Maps status: ${data.status} / ${element?.status}`;
    }

    // Calcular a taxa com base nas regras
    let calculatedFee = 0;
    let customMatched = false;

    // Separar regras por tipo: endereço (address) tem prioridade sobre bairro (neighborhood)
    if (customAddressRules && Array.isArray(customAddressRules) && customAddressRules.length > 0) {
      const customerAddrLower = customerAddress.toLowerCase();
      const addrRules = customAddressRules.filter((r: any) => r.type === 'address');
      const neighborhoodRules = customAddressRules.filter((r: any) => r.type === 'neighborhood');

      // Prioridade 1: Regras por Rua/Endereço (mais específico)
      const sortedAddr = [...addrRules].sort((a: any, b: any) => b.keyword.length - a.keyword.length);
      for (const rule of sortedAddr) {
        if (rule.keyword && customerAddrLower.includes(rule.keyword.toLowerCase())) {
          // Se a regra exigir um número específico, verifica se o endereço do cliente contém esse número
          if (rule.addressNumber && rule.addressNumber.trim() !== '') {
            const numStr = rule.addressNumber.trim();
            // Verifica com regex de limite de palavra (word boundary) para não dar falso positivo (ex: '1' dentro de '123')
            const regex = new RegExp(`\\b${numStr}\\b`, 'i');
            if (!regex.test(customerAddrLower)) {
              continue; // Ignora esta regra se o número não bater, passa para a próxima
            }
          }
          calculatedFee = rule.fee;
          customMatched = true;
          break;
        }
      }

      // Prioridade 2: Regras por Bairro
      if (!customMatched) {
        const sortedNeighborhood = [...neighborhoodRules].sort((a: any, b: any) => b.keyword.length - a.keyword.length);
        // Combinar: buscar no endereço completo OU no bairro informado separadamente
        const neighborhoodHintLower = (neighborhoodHint || '').toLowerCase().trim();
        for (const rule of sortedNeighborhood) {
          if (!rule.keyword) continue;
          const keywordLower = rule.keyword.toLowerCase();
          // Match no endereço completo OU match direto no bairro informado
          if (customerAddrLower.includes(keywordLower) || 
              (neighborhoodHintLower && neighborhoodHintLower.includes(keywordLower)) ||
              (neighborhoodHintLower && keywordLower.includes(neighborhoodHintLower))) {
            calculatedFee = rule.fee;
            customMatched = true;
            break;
          }
        }
      }

      // Fallback para regras antigas sem type (migração)
      if (!customMatched) {
        const legacyRules = customAddressRules.filter((r: any) => !r.type);
        const sortedLegacy = [...legacyRules].sort((a: any, b: any) => b.keyword.length - a.keyword.length);
        for (const rule of sortedLegacy) {
          if (rule.keyword && customerAddrLower.includes(rule.keyword.toLowerCase())) {
            calculatedFee = rule.fee;
            customMatched = true;
            break;
          }
        }
      }
    }

    // Prioridade 3: Taxa por KM (se não casou com regra personalizada)
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
    if (!customMatched && mapsErrorMsg) {
      return NextResponse.json({
        error: 'Não foi possível calcular a distância para este endereço.',
        details: mapsErrorMsg,
      }, { status: 400 });
    }

    return NextResponse.json({
      distanceKm: Math.round(distanceKm * 10) / 10,
      distanceText,
      durationText,
      fee: Math.round(calculatedFee * 100) / 100,
      originAddress,
      destinationAddress,
    });
  } catch (err: any) {
    console.error('Erro na API delivery-fee:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
