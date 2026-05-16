import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Busca TODOS os bairros de uma cidade usando ViaCEP (Correios).
 * 
 * Estratégia: busca ruas usando múltiplos termos de busca (tipo logradouro +
 * nomes comuns) para cobrir o máximo de ruas possível, depois extrai os
 * bairros únicos do campo "bairro" retornado pelos Correios.
 * 
 * 100% gratuito, sem API key, fonte oficial dos Correios.
 * NÃO interfere com Google Maps (cálculos de distância continuam no Maps).
 */

// Termos de busca que cobrem a maioria das ruas brasileiras
// ViaCEP exige mínimo 3 caracteres no logradouro
const SEARCH_TERMS = [
  // Tipos de logradouro (cobrem a maioria)
  'rua', 'avenida', 'travessa', 'alameda', 'praça', 'rodovia', 'estrada', 'largo',
  'viela', 'beco', 'passagem',
  // Nomes muito comuns em ruas brasileiras
  'são', 'santo', 'santa', 'pedro', 'josé', 'maria', 'ana', 'carlos',
  'silva', 'santos', 'oliveira', 'souza', 'lima', 'costa',
  // Palavras comuns em logradouros
  'brasil', 'flores', 'independ', 'liberdade', 'primavera',
  'nova', 'velha', 'alto', 'jardim', 'parque', 'vila',
  // Números escritos (aparecem em muitas ruas)
  'primeiro', 'maio', 'setembro', 'novembro',
];

export async function GET(req: NextRequest) {
  try {
    const city = req.nextUrl.searchParams.get('city')?.trim();
    if (!city || city.length < 3) {
      return NextResponse.json({ neighborhoods: [] });
    }

    // Extrair cidade e UF
    const parts = city.split(',').map(p => p.trim());
    const cityName = parts[0];
    let uf = extractUF(parts[1] || '');
    if (!uf) uf = 'SP'; // fallback

    const allBairros = new Set<string>();

    // Buscar em paralelo com todos os termos (máximo 6 por vez para não sobrecarregar)
    const batchSize = 6;
    for (let i = 0; i < SEARCH_TERMS.length; i += batchSize) {
      const batch = SEARCH_TERMS.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(term => fetchViaCEP(uf, cityName, term))
      );
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          for (const item of result.value) {
            if (item.bairro && item.bairro.trim()) {
              allBairros.add(item.bairro.trim());
            }
          }
        }
      }
    }

    // Converter Set para array ordenado
    const neighborhoods = Array.from(allBairros)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((name, idx) => ({ name, id: `bairro-${idx}` }));

    return NextResponse.json({
      neighborhoods,
      city: cityName,
      uf,
      total: neighborhoods.length,
      source: 'ViaCEP (Correios)',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ 
      error: err.message || 'Erro ao buscar bairros',
      neighborhoods: [] 
    }, { status: 500 });
  }
}

async function fetchViaCEP(uf: string, city: string, term: string): Promise<any[]> {
  try {
    const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(city)}/${encodeURIComponent(term)}/json/`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function extractUF(raw: string): string {
  let cleaned = raw.replace(/brasil/i, '').trim();
  if (cleaned.length === 2) return cleaned.toUpperCase();
  const match = cleaned.match(/\b([A-Z]{2})\b/i);
  if (match) return match[1].toUpperCase();
  return mapStateToUF(cleaned);
}

function mapStateToUF(state: string): string {
  const map: Record<string, string> = {
    'são paulo': 'SP', 'sao paulo': 'SP',
    'minas gerais': 'MG', 'rio de janeiro': 'RJ',
    'paraná': 'PR', 'parana': 'PR',
    'santa catarina': 'SC', 'rio grande do sul': 'RS',
    'bahia': 'BA', 'goiás': 'GO', 'goias': 'GO',
    'ceará': 'CE', 'ceara': 'CE',
    'pernambuco': 'PE', 'pará': 'PA', 'para': 'PA',
    'maranhão': 'MA', 'maranhao': 'MA',
    'amazonas': 'AM', 'espírito santo': 'ES', 'espirito santo': 'ES',
    'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'distrito federal': 'DF', 'rio grande do norte': 'RN',
    'paraíba': 'PB', 'paraiba': 'PB',
    'alagoas': 'AL', 'sergipe': 'SE',
    'piauí': 'PI', 'piaui': 'PI',
    'rondônia': 'RO', 'rondonia': 'RO',
    'tocantins': 'TO', 'acre': 'AC',
    'amapá': 'AP', 'amapa': 'AP',
    'roraima': 'RR',
  };
  return map[state.toLowerCase()] || '';
}
