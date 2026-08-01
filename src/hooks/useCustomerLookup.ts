import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { normalizeCreditPhone } from '@/lib/customer-credit';
import { removeAccents } from '@/lib/utils';

// Autocomplete de cliente (nome/telefone) dos canais internos. A carga da lista
// e o cálculo dos matches eram byte-idênticos em NovoPedidoTab e MesasTab; o que
// cada aba faz AO escolher um cliente (applyCustomer) segue local, pois difere
// (Balcão preenche endereço + recalcula taxa; Mesa só nome/telefone).

export type CustomerLookupField = null | 'name' | 'phone';

export function useCustomerLookup(db: any, ownerId: string | undefined, name: string, phone: string) {
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [activeField, setActiveField] = useState<CustomerLookupField>(null);

  // Carrega a lista de clientes (uma vez) para o autocomplete.
  useEffect(() => {
    if (!db || !ownerId) return;
    let ignore = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'clientes'), where('ownerId', '==', ownerId)));
        if (!ignore) {
          setAllCustomers(
            snap.docs
              .map((d: any) => ({ id: d.id, ...d.data() }))
              .filter((customer: any) => customer.archived !== true && !customer.mergeInProgress),
          );
        }
      } catch (e) {
        console.error('Erro ao carregar clientes para autocomplete:', e);
      }
    })();
    return () => { ignore = true; };
  }, [db, ownerId]);

  // Sugestões conforme o campo ativo (nome ou telefone).
  const matches = useMemo(() => {
    if (!activeField || allCustomers.length === 0) return [] as any[];
    if (activeField === 'phone') {
      const term = normalizeCreditPhone(phone);
      if (term.length < 3) return [];
      return allCustomers.filter(c => normalizeCreditPhone(String(c.celular || '')).includes(term)).slice(0, 6);
    }
    const term = removeAccents(name.toLowerCase()).trim();
    if (term.length < 2) return [];
    return allCustomers
      .filter(c => removeAccents(String(c.nome || c.name || '').toLowerCase()).includes(term))
      .slice(0, 6);
  }, [activeField, name, phone, allCustomers]);

  return { allCustomers, activeField, setActiveField, matches };
}
