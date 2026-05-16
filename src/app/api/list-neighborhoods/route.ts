import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

export const dynamic = 'force-dynamic';

/**
 * Busca bairros de uma cidade usando Google Places Text Search (New).
 * Recebe ?city=Cravinhos, SP e retorna lista de bairros encontrados.
 */
export async function GET(req: NextRequest) {
  try {
    const city = req.nextUrl.searchParams.get('city')?.trim();
    if (!city || city.length < 3) {
      return NextResponse.json({ neighborhoods: [] });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json({ error: 'Chave do Google Maps não configurada.' }, { status: 500 });
    }

    // Buscar bairros usando Text Search com múltiplas queries para cobertura máxima
    const queries = [
      `bairros de ${city} Brasil`,
      `neighborhoods ${city} Brazil`,
      `${city} bairro Brasil`,
    ];

    const allNeighborhoods = new Map<string, string>(); // name -> placeId (dedup)

    for (const textQuery of queries) {
      try {
        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'places.displayName,places.id,places.formattedAddress',
          },
          body: JSON.stringify({
            textQuery,
            languageCode: 'pt-BR',
            regionCode: 'br',
            maxResultCount: 20,
          }),
        });

        const data = await response.json();
        
        if (response.ok && data.places) {
          for (const place of data.places) {
            const name = place.displayName?.text;
            const address = place.formattedAddress || '';
            if (name && !allNeighborhoods.has(name)) {
              // Só incluir se o endereço menciona a cidade
              const cityBase = city.split(',')[0].trim().toLowerCase();
              if (address.toLowerCase().includes(cityBase)) {
                allNeighborhoods.set(name, place.id);
              }
            }
          }
        }
      } catch {
        // Silently skip failed queries
      }
    }

    // Também buscar via Autocomplete com prefixos comuns de bairros
    const prefixes = ['jardim', 'vila', 'parque', 'residencial', 'centro', 'conjunto'];
    for (const prefix of prefixes) {
      try {
        const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
          },
          body: JSON.stringify({
            input: `${prefix} ${city}`,
            languageCode: 'pt-BR',
            regionCode: 'br',
            includedRegionCodes: ['br'],
          }),
        });

        const data = await response.json();
        if (response.ok && data.suggestions) {
          for (const suggestion of data.suggestions) {
            const pred = suggestion.placePrediction;
            if (pred?.text?.text && pred?.placeId) {
              const desc = pred.text.text;
              // Extrair nome do bairro (antes da vírgula ou traço com cidade)
              const cityBase = city.split(',')[0].trim().toLowerCase();
              if (desc.toLowerCase().includes(cityBase)) {
                // Pegar a parte relevante do nome
                const parts = desc.split(' - ');
                const name = parts[0].split(',')[0].trim();
                if (name && !allNeighborhoods.has(name)) {
                  allNeighborhoods.set(name, pred.placeId);
                }
              }
            }
          }
        }
      } catch {
        // Silently skip
      }
    }

    const neighborhoods = Array.from(allNeighborhoods.entries())
      .map(([name, placeId]) => ({ name, placeId }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return NextResponse.json({ neighborhoods }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
