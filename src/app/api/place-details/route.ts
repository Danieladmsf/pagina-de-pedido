import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const placeId = req.nextUrl.searchParams.get('placeId')?.trim();
    if (!placeId) {
      return NextResponse.json({ error: 'placeId é obrigatório' }, { status: 400 });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json({ error: 'Chave do Google Maps não configurada.' }, { status: 500 });
    }

    const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=pt-BR`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'addressComponents',
      },
    });
    
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({
        error: data?.error?.message || response.statusText,
        googleMessage: data?.error?.message,
      }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    // Processar os componentes de endereço
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
