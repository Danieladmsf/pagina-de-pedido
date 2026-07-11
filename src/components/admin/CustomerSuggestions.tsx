'use client';

import React from 'react';

// Dropdown de sugestões do autocomplete de cliente, compartilhado por
// NovoPedidoTab e MesasTab. A linha secundária mostra o telefone e, se a aba
// fornecer `getAddressLine` (só o Balcão/Delivery), também o endereço.

type Props = {
  matches: any[];
  onSelect: (customer: any) => void;
  getAddressLine?: (customer: any) => string;
};

export function CustomerSuggestions({ matches, onSelect, getAddressLine }: Props) {
  if (matches.length === 0) return null;
  return (
    <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
      {matches.map((c: any) => {
        const addrLine = getAddressLine?.(c) || '';
        return (
          <button
            type="button"
            key={c.id}
            onMouseDown={(e) => { e.preventDefault(); onSelect(c); }}
            className="w-full text-left px-2 py-1.5 hover:bg-emerald-50 border-b last:border-b-0"
          >
            <div className="text-xs font-semibold text-slate-800">{String(c.nome || c.name || c.customerName || '').trim() || 'Sem nome'}</div>
            <div className="text-[10px] text-slate-500">{c.celular || 'sem telefone'}{addrLine ? ` · ${addrLine}` : ''}</div>
          </button>
        );
      })}
    </div>
  );
}
