import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Busca bairros de uma cidade brasileira usando OpenStreetMap Overpass API.
 * Grátis, sem API key, e retorna bairros reais mapeados pela comunidade.
 * 
 * NÃO interfere com Google Maps (usado apenas para listar bairros no admin).
 * O cálculo de frete continua usando Google Distance Matrix.
 */
export async function GET(req: NextRequest) {
  try {
    const city = req.nextUrl.searchParams.get('city')?.trim();
    if (!city || city.length < 3) {
      return NextResponse.json({ neighborhoods: [] });
    }

    // Extrair nome da cidade (remover ", SP" etc.)
    const cityName = city.split(',')[0].trim();
    const state = city.split(',')[1]?.trim() || '';

    // Query Overpass para buscar bairros dentro da cidade
    // Busca: place=neighbourhood, place=suburb, place=quarter
    const overpassQuery = `
[out:json][timeout:30];
area["name"~"^${escapeRegex(cityName)}$","i"]["admin_level"~"7|8"]${state ? `["is_in:state"~"${escapeRegex(state)}","i"]` : ''}->.city;
(
  node["place"~"neighbourhood|suburb|quarter"](area.city);
  way["place"~"neighbourhood|suburb|quarter"](area.city);
  relation["place"~"neighbourhood|suburb|quarter"](area.city);
);
out center;
`.trim();

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      // Fallback: tentar query mais simples sem filtro de estado
      const fallbackQuery = `
[out:json][timeout:30];
area["name"="${cityName}"]["admin_level"~"7|8"]->.city;
(
  node["place"~"neighbourhood|suburb|quarter"](area.city);
  way["place"~"neighbourhood|suburb|quarter"](area.city);
  relation["place"~"neighbourhood|suburb|quarter"](area.city);
);
out center;
`.trim();

      const fallbackRes = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(fallbackQuery)}`,
        signal: AbortSignal.timeout(30000),
      });

      if (!fallbackRes.ok) {
        return NextResponse.json({ 
          error: 'Não foi possível buscar bairros no momento. Tente novamente.',
          neighborhoods: [] 
        }, { status: 502 });
      }

      const fallbackData = await fallbackRes.json();
      return NextResponse.json(formatResponse(fallbackData, cityName), {
        headers: { 'Cache-Control': 'public, max-age=86400' }, // Cache 24h
      });
    }

    const data = await response.json();
    return NextResponse.json(formatResponse(data, cityName), {
      headers: { 'Cache-Control': 'public, max-age=86400' }, // Cache 24h
    });
  } catch (err: any) {
    return NextResponse.json({ 
      error: err.message || 'Erro ao buscar bairros',
      neighborhoods: [] 
    }, { status: 500 });
  }
}

function formatResponse(data: any, cityName: string) {
  const seen = new Set<string>();
  const neighborhoods: { name: string, id: string }[] = [];

  if (data.elements && Array.isArray(data.elements)) {
    for (const el of data.elements) {
      const name = el.tags?.name;
      if (!name) continue;
      
      const normalized = name.trim();
      const key = normalized.toLowerCase();
      
      // Pular duplicados e o próprio nome da cidade
      if (seen.has(key)) continue;
      if (key === cityName.toLowerCase()) continue;
      
      seen.add(key);
      neighborhoods.push({
        name: normalized,
        id: String(el.id),
      });
    }
  }

  // Garantir "Centro" na lista
  if (!seen.has('centro')) {
    neighborhoods.push({ name: 'Centro', id: 'centro-default' });
  }

  neighborhoods.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    neighborhoods,
    city: cityName,
    total: neighborhoods.length,
    source: 'OpenStreetMap',
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
