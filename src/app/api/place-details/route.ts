import { NextRequest, NextResponse } from 'next/server';
import { guardPublicApi } from '@/lib/api-guard';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

export const dynamic = 'force-dynamic';

/**
 * Busca detalhes de um local pelo placeId.
 * Estratégia em 2 etapas para garantir o bairro:
 *   1. Busca addressComponents + location via Places API (New)
 *   2. Se neighborhood vier vazio, faz REVERSE GEOCODE com as coordenadas
 *      (a API de Geocoding quase sempre retorna o bairro/sublocality)
 */
export async function GET(req: NextRequest) {
  try {
    const blocked = guardPublicApi(req);
    if (blocked) return blocked;

    const placeId = req.nextUrl.searchParams.get('placeId')?.trim();
    if (!placeId || placeId.length > 200) {
      return NextResponse.json({ error: 'placeId é obrigatório' }, { status: 400 });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json({ error: 'Chave do Google Maps não configurada.' }, { status: 500 });
    }

    // ── ETAPA 1: Place Details (addressComponents + location) ──
    const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=pt-BR`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'addressComponents,location',
      },
    });
    
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({
        error: data?.error?.message || response.statusText,
        googleMessage: data?.error?.message,
      }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    // Extrair componentes de endereço
    const components = data.addressComponents || [];
    let street = '';
    let neighborhood = '';
    let city = '';

    for (const comp of components) {
      if (comp.types.includes('route')) {
        street = comp.longText;
      }
      if (comp.types.includes('sublocality') || comp.types.includes('sublocality_level_1')) {
        neighborhood = comp.longText;
      }
      if (comp.types.includes('administrative_area_level_2')) {
        city = comp.longText;
      }
    }

    // ── ETAPA 2: Se bairro veio vazio, tentar REVERSE GEOCODE ──
    if (!neighborhood && data.location) {
      const lat = data.location.latitude;
      const lng = data.location.longitude;

      try {
        const geoUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        geoUrl.searchParams.set('latlng', `${lat},${lng}`);
        geoUrl.searchParams.set('language', 'pt-BR');
        geoUrl.searchParams.set('result_type', 'sublocality|neighborhood|political');
        geoUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);

        const geoRes = await fetch(geoUrl.toString(), { cache: 'no-store' });
        const geoData = await geoRes.json();

        if (geoData.status === 'OK' && geoData.results?.length > 0) {
          // Percorre todos os resultados procurando sublocality
          for (const result of geoData.results) {
            for (const comp of result.address_components || []) {
              if (
                (comp.types.includes('sublocality') || 
                 comp.types.includes('sublocality_level_1') || 
                 comp.types.includes('neighborhood')) &&
                comp.long_name
              ) {
                neighborhood = comp.long_name;
                break;
              }
            }
            if (neighborhood) break;
          }
        }

        // Se AINDA não encontrou com result_type restrito, tenta sem filtro
        if (!neighborhood) {
          const geoUrl2 = new URL('https://maps.googleapis.com/maps/api/geocode/json');
          geoUrl2.searchParams.set('latlng', `${lat},${lng}`);
          geoUrl2.searchParams.set('language', 'pt-BR');
          geoUrl2.searchParams.set('key', GOOGLE_MAPS_API_KEY);

          const geoRes2 = await fetch(geoUrl2.toString(), { cache: 'no-store' });
          const geoData2 = await geoRes2.json();

          if (geoData2.status === 'OK' && geoData2.results?.length > 0) {
            for (const result of geoData2.results) {
              for (const comp of result.address_components || []) {
                if (
                  (comp.types.includes('sublocality') || 
                   comp.types.includes('sublocality_level_1') || 
                   comp.types.includes('neighborhood')) &&
                  comp.long_name
                ) {
                  neighborhood = comp.long_name;
                  break;
                }
              }
              if (neighborhood) break;
            }
          }
        }

      } catch (geoErr: any) {
        console.warn('[API place-details] Erro no reverse geocode (não fatal):', geoErr.message);
      }
    }

    return NextResponse.json({
      street,
      neighborhood,
      city,
      addressComponents: components
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
