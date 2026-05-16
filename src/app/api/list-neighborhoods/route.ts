import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Prefixos de logradouros brasileiros para cobrir todas as ruas
const STREET_PREFIXES = ['rua', 'avenida', 'travessa', 'alameda', 'praça', 'rodovia', 'estrada', 'largo'];

/**
 * Busca TODOS os bairros de uma cidade usando ViaCEP (Correios).
 * Estratégia: busca ruas por prefixo → extrai bairros únicos.
 * 
 * 100% gratuito, sem API key, fonte oficial dos Correios.
 * NÃO interfere com Google Maps (cálculos de distância).
 */
export async function GET(req: NextRequest) {
  try {
    const city = req.nextUrl.searchParams.get('city')?.trim();
    if (!city || city.length < 3) {
      return NextResponse.json({ neighborhoods: [] });
    }

    // Extrair cidade e UF
    const parts = city.split(',').map(p => p.trim());
    const cityName = parts[0];
    // Tentar extrair UF (ex: "Cravinhos, SP" → "SP")
    let uf = parts[1] || '';
    
    // Se a UF veio como nome completo do estado ou contém mais info, extrair sigla
    uf = uf.replace(/brasil/i, '').trim();
    if (uf.length > 2) {
      // Tentar extrair sigla de 2 letras
      const match = uf.match(/\b([A-Z]{2})\b/i);
      if (match) uf = match[1].toUpperCase();
      else uf = mapStateToUF(uf);
    }
    uf = uf.toUpperCase();
    
    if (!uf || uf.length !== 2) {
      // Se não encontrou UF, tentar com SP como padrão (pode ajustar)
      uf = 'SP';
    }

    const allBairros = new Set<string>();

    // Buscar com cada prefixo de logradouro
    const fetchPromises = STREET_PREFIXES.map(async (prefix) => {
      try {
        const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cityName)}/${encodeURIComponent(prefix)}/json/`;
        const res = await fetch(url, { 
          signal: AbortSignal.timeout(10000),
          headers: { 'Accept': 'application/json' }
        });
        
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item.bairro && item.bairro.trim()) {
                allBairros.add(item.bairro.trim());
              }
            }
          }
        }
      } catch {
        // Skip failed prefix silently
      }
    });

    await Promise.all(fetchPromises);

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
    }, { headers: { 'Cache-Control': 'public, max-age=86400' } }); // Cache 24h
  } catch (err: any) {
    return NextResponse.json({ 
      error: err.message || 'Erro ao buscar bairros',
      neighborhoods: [] 
    }, { status: 500 });
  }
}

/** Mapeia nome do estado para sigla UF */
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
