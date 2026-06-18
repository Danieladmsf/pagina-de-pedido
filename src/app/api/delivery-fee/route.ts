import { NextRequest, NextResponse } from 'next/server';
import { guardPublicApi } from '@/lib/api-guard';
import { normalizeSearch } from '@/lib/utils';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

// Abreviações que o cliente/atendente digita no bairro (jd = jardim, etc.).
// Sem expandir, "jd primavera" não casa "Jardim Primavera" e cai na taxa por KM.
const NB_ABBR: Record<string, string> = {
  jd: 'jardim', jardin: 'jardim', pq: 'parque', vl: 'vila',
  res: 'residencial', resid: 'residencial', cj: 'conjunto', conj: 'conjunto',
  cjto: 'conjunto', cond: 'condominio', condominio: 'condominio', hab: 'habitacional',
};
// Normaliza (acento+caixa) e expande abreviações token a token, para casar o bairro.
const nbNorm = (s: string | null | undefined): string =>
  normalizeSearch(s).split(/[^a-z0-9]+/).map((w) => NB_ABBR[w] || w).join(' ').trim();

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
    const blocked = guardPublicApi(req);
    if (blocked) return blocked;

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
      // Normaliza (remove acento + minúsculas) para casar igual a UI faz com normalizeSearch.
      // Sem isso, "São José"/"sao jose"/"Sumaré"/"sumare" não batem e o pedido cai na taxa por KM.
      const customerAddrNorm = normalizeSearch(customerAddress);
      const addrRules = customAddressRules.filter((r: any) => r.type === 'address');
      const neighborhoodRules = customAddressRules.filter((r: any) => r.type === 'neighborhood');

      // Prioridade 1: Regras por Rua/Endereço (mais específico)
      const sortedAddr = [...addrRules].sort((a: any, b: any) => (b.keyword || '').length - (a.keyword || '').length);
      for (const rule of sortedAddr) {
        if (rule.keyword && customerAddrNorm.includes(normalizeSearch(rule.keyword))) {
          // Se a regra exigir um número específico, verifica se o endereço do cliente contém esse número
          if (rule.addressNumber && String(rule.addressNumber).trim() !== '') {
            // Escapa metacaracteres para um número com símbolo não quebrar o RegExp (cai no catch -> 500)
            const numStr = String(rule.addressNumber).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Verifica com regex de limite de palavra (word boundary) para não dar falso positivo (ex: '1' dentro de '123')
            const regex = new RegExp(`\\b${numStr}\\b`, 'i');
            if (!regex.test(customerAddrNorm)) {
              continue; // Ignora esta regra se o número não bater, passa para a próxima
            }
          }
          calculatedFee = rule.fee;
          customMatched = true;
          break;
        }
      }

      // Prioridade 2: Regras por Bairro (com expansão de abreviações: jd->jardim, pq->parque...)
      if (!customMatched) {
        const sortedNeighborhood = [...neighborhoodRules].sort((a: any, b: any) => (b.keyword || '').length - (a.keyword || '').length);
        const customerAddrNb = nbNorm(customerAddress);
        // Combinar: buscar no endereço completo OU no bairro informado separadamente
        const neighborhoodHintNb = nbNorm(neighborhoodHint || '');
        for (const rule of sortedNeighborhood) {
          if (!rule.keyword) continue;
          const keywordNb = nbNorm(rule.keyword);
          if (!keywordNb) continue;
          // Match no endereço completo OU match direto no bairro informado (igualdade ou substring nos dois sentidos)
          if (customerAddrNb.includes(keywordNb) ||
              (neighborhoodHintNb && (
                neighborhoodHintNb === keywordNb ||
                neighborhoodHintNb.includes(keywordNb) ||
                keywordNb.includes(neighborhoodHintNb)
              ))) {
            calculatedFee = rule.fee;
            customMatched = true;
            break;
          }
        }
      }

      // Fallback para regras antigas sem type (migração)
      if (!customMatched) {
        const legacyRules = customAddressRules.filter((r: any) => !r.type);
        const sortedLegacy = [...legacyRules].sort((a: any, b: any) => (b.keyword || '').length - (a.keyword || '').length);
        for (const rule of sortedLegacy) {
          if (rule.keyword && customerAddrNorm.includes(normalizeSearch(rule.keyword))) {
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
