import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

/**
 * Proxy para o Google Places Autocomplete API.
 * Recebe a query do usuário e retorna sugestões de endereços.
 */
export async function GET(req: NextRequest) {
  try {
    const input = req.nextUrl.searchParams.get('input');
    if (!input || input.length < 3) {
      return NextResponse.json({ predictions: [] });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json({ error: 'Chave do Google Maps não configurada.' }, { status: 500 });
    }

    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    url.searchParams.set('input', input);
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('components', 'country:br');
    const types = req.nextUrl.searchParams.get('types') || 'address';
    url.searchParams.set('types', types);
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return NextResponse.json({ error: data.error_message || data.status }, { status: 500 });
    }

    const predictions = (data.predictions || []).map((p: any) => ({
      description: p.description,
      placeId: p.place_id,
    }));

    return NextResponse.json({ predictions });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
