import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

export const dynamic = 'force-dynamic';

// Prefixos comuns de bairros brasileiros
const NEIGHBORHOOD_PREFIXES = [
  'jardim', 'vila', 'parque', 'residencial', 'centro',
  'conjunto', 'bairro', 'loteamento', 'núcleo', 'chácara',
  'recanto', 'portal', 'alto', 'cidade', 'nova',
  'são', 'santa', 'santo', 'nossa senhora',
  'industrial', 'ipiranga', 'liberdade', 'bela vista',
];

// Termos que indicam que NÃO é um bairro
const BLACKLIST_TERMS = [
  'restaurante', 'lanchonete', 'padaria', 'pizzaria', 'bar ',
  'supermercado', 'mercado', 'loja', 'academia', 'farmácia',
  'hospital', 'clínica', 'consultório', 'dentista', 'médico',
  'escola', 'colégio', 'universidade', 'faculdade', 'creche',
  'igreja', 'templo', 'catedral', 'paróquia', 'capela',
  'tribunal', 'fórum', 'prefeitura', 'câmara', 'cartório',
  'delegacia', 'polícia', 'bombeiro', 'corpo de bombeiros',
  'sp-', 'br-', 'rodovia', 'estrada', 'highway',
  'posto', 'gas station', 'hotel', 'pousada', 'motel',
  'shopping', 'mall', 'cinema', 'teatro',
  'banco', 'caixa econômica', 'bradesco', 'itaú',
  'cemitério', 'velório', 'funerária',
];

function isLikelyNeighborhood(name: string): boolean {
  const lower = name.toLowerCase().trim();
  
  // Rejeitar se contém termos da blacklist
  for (const term of BLACKLIST_TERMS) {
    if (lower.includes(term)) return false;
  }
  
  // Rejeitar se é só o nome da cidade
  if (lower.split(/\s+/).length <= 1) return false;
  
  // Rejeitar se parece ser uma rodovia (ex: SP-255)
  if (/^[a-z]{2}-\d+/i.test(lower)) return false;
  
  // Rejeitar se tem "estado" ou "justiça"
  if (/estado|justiça|federal|municipal|estadual/i.test(lower)) return false;
  
  return true;
}

/**
 * Busca bairros de uma cidade usando Google Places Autocomplete
 * com prefixos típicos de bairros brasileiros.
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

    const cityBase = city.split(',')[0].trim();
    const allNeighborhoods = new Map<string, string>();

    // Buscar usando Autocomplete com cada prefixo de bairro
    for (const prefix of NEIGHBORHOOD_PREFIXES) {
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
            input: `${prefix} ${cityBase}`,
            languageCode: 'pt-BR',
            regionCode: 'br',
            includedRegionCodes: ['br'],
          }),
        });

        const data = await response.json();
        if (response.ok && data.suggestions) {
          for (const suggestion of data.suggestions) {
            const pred = suggestion.placePrediction;
            if (!pred?.text?.text || !pred?.placeId) continue;
            
            const fullDesc = pred.text.text;
            // Verificar se a sugestão é da cidade correta
            if (!fullDesc.toLowerCase().includes(cityBase.toLowerCase())) continue;
            
            // Extrair o nome do bairro (primeira parte antes de " - " ou ", Cravinhos")
            let name = fullDesc;
            const dashIdx = name.indexOf(' - ');
            if (dashIdx > 0) name = name.substring(0, dashIdx);
            const commaIdx = name.indexOf(', ');
            if (commaIdx > 0) name = name.substring(0, commaIdx);
            name = name.trim();
            
            // Remover o nome da cidade se ficou no final
            if (name.toLowerCase().endsWith(cityBase.toLowerCase())) {
              name = name.substring(0, name.length - cityBase.length).trim();
            }
            
            if (name && name.length > 1 && !allNeighborhoods.has(name) && isLikelyNeighborhood(name)) {
              allNeighborhoods.set(name, pred.placeId);
            }
          }
        }
      } catch {
        // Skip failed prefix
      }
    }

    // Garantir que "Centro" sempre esteja na lista
    if (!allNeighborhoods.has('Centro')) {
      allNeighborhoods.set('Centro', 'centro-placeholder');
    }

    const neighborhoods = Array.from(allNeighborhoods.entries())
      .map(([name, placeId]) => ({ name, placeId }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return NextResponse.json({ 
      neighborhoods,
      city: cityBase,
      total: neighborhoods.length
    }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
