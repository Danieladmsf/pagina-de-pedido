'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, PackageSearch } from 'lucide-react';
import { brl } from '@/lib/utils';
/**
 * Abas de cadastro que ganham esta versão só de leitura quando o funcionário
 * tem "ver" mas não "alterar". As telas reais dessas abas são de edição do
 * começo ao fim; mostrar esta lista é mais honesto do que oferecer botões que
 * o servidor vai recusar.
 */
export type CatalogoSomenteLeituraTabId = 'produtos' | 'categorias' | 'addons' | 'promocoes';

const CONFIG: Record<CatalogoSomenteLeituraTabId, { title: string; empty: string }> = {
  produtos: { title: 'Produtos', empty: 'Nenhum produto cadastrado.' },
  categorias: { title: 'Categorias', empty: 'Nenhuma categoria cadastrada.' },
  addons: { title: 'Adicionais', empty: 'Nenhum adicional cadastrado.' },
  promocoes: { title: 'Ofertas', empty: 'Nenhuma oferta cadastrada.' },
};

// Catálogo em leitura: preço ausente aparece como travessão, não como R$ 0,00.
// Por isso este wrapper existe — a formatação em si vem do brl compartilhado.
function money(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return brl(number);
}

export function OperatorCatalogReadOnly({
  activeTab,
  items,
  categories,
  addons,
  promotions,
  isLoading,
}: {
  activeTab: CatalogoSomenteLeituraTabId;
  items: any[];
  categories: any[];
  addons: any[];
  promotions: any[];
  isLoading: boolean;
}) {
  const config = CONFIG[activeTab];
  const rows = activeTab === 'produtos'
    ? items.filter((item) => !item.isCombo)
    : activeTab === 'categorias'
      ? categories
      : activeTab === 'addons'
        ? addons
        : promotions;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="flex items-center gap-2 font-semibold">
          <Eye className="h-4 w-4" /> Visualização somente leitura
        </div>
        <p className="mt-1 text-blue-800">
          Você pode consultar este cadastro. Para alterar, o dono precisa liberar em Usuários e acesso.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{config.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <PackageSearch className="h-8 w-8" />
              <p>{config.empty}</p>
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.name || row.title || 'Sem nome'}</p>
                    {activeTab === 'promocoes' && row.description && (
                      <p className="truncate text-xs text-muted-foreground">{row.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {(activeTab === 'produtos' || activeTab === 'addons') && (
                      <span className="text-sm font-semibold">{money(row.price)}</span>
                    )}
                    <Badge variant={row.active === false || row.isAvailable === false ? 'secondary' : 'default'}>
                      {row.active === false || row.isAvailable === false ? 'Inativo' : 'Ativo'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
