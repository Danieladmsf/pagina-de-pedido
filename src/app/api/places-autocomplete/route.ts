import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
const MIN_SEARCH_LENGTH = 2;

export const dynamic = 'force-dynamic';

/**
 * Proxy para o Google Places API (New) Autocomplete.
 * Recebe a query do usuário e retorna sugestões de endereços.
 */
export async function GET(req: NextRequest) {
  try {
    const input = req.nextUrl.searchParams.get('input')?.trim();
    if (!input || input.length < MIN_SEARCH_LENGTH) {
      return NextResponse.json({ predictions: [] });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json({ error: 'Chave do Google Maps não configurada.' }, { status: 500 });
    }

    const types = req.nextUrl.searchParams.get('types') || 'address';
    const body: Record<string, any> = {
      input,
      languageCode: 'pt-BR',
      regionCode: 'br',
      includedRegionCodes: ['br'],
    };

    // Places API (New) aceita coleções especiais como "(cities)".
    // Para bairros usamos "sublocality", para ruas "route".
    if (types === '(cities)' || types === '(regions)') {
      body.includedPrimaryTypes = [types];
    } else if (types === 'sublocality') {
      body.includedPrimaryTypes = ['sublocality', 'sublocality_level_1', 'neighborhood'];
    } else if (types === 'route') {
      body.includedPrimaryTypes = ['route'];
    }

    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    if (!response.ok) {
      const googleMessage = data?.error?.message || response.statusText;
      const isBlockedMethod = /AutocompletePlaces|blocked/i.test(googleMessage);
      return NextResponse.json({
        error: isBlockedMethod
          ? 'A chave do Google Maps esta bloqueando o metodo AutocompletePlaces. Use uma chave de servidor em GOOGLE_MAPS_SERVER_API_KEY ou, nessa chave, permita Places API (New) e desative bloqueios de Browser/Firebase App Check para chamadas server-side.'
          : googleMessage,
        googleMessage,
      }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    const predictions = (data.suggestions || [])
      .map((suggestion: any) => suggestion.placePrediction)
      .filter(Boolean)
      .map((prediction: any) => ({
        description: prediction.text?.text || '',
        placeId: prediction.placeId,
      }))
      .filter((prediction: any) => prediction.description && prediction.placeId);

    return NextResponse.json({ predictions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
