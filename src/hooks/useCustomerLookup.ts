import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
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

  // Lista de clientes EM TEMPO REAL.
  //
  // Era uma carga única (`getDocs` na montagem), e isso mentia em dinheiro: o
  // saldo do Prazo sobe a cada venda fiada, mas a cópia local ficava congelada —
  // vendia R$ 20 para um cliente de limite R$ 100 e o balcão continuava
  // anunciando "disponível R$ 100". Vale para as duas telas e para os dois PCs:
  // com um listener, quem vende na Mesa vê o limite que o Balcão acabou de
  // consumir. O custo é o mesmo da carga inicial de antes; depois só chegam as
  // mudanças (o PDV já assina a coleção de pedidos, bem maior).
  //
  // Não confundir com a validação do fiado: quem decide se a venda passa é
  // `resolveContaCasa`, que relê do banco no confirmar. Isto aqui é o número
  // que o operador vê antes de escolher.
  useEffect(() => {
    if (!db || !ownerId) return;
    const cancelar = onSnapshot(
      query(collection(db, 'clientes'), where('ownerId', '==', ownerId)),
      (snap: any) => {
        setAllCustomers(
          snap.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .filter((customer: any) => customer.archived !== true && !customer.mergeInProgress),
        );
      },
      (e: any) => console.error('Erro ao carregar clientes para autocomplete:', e),
    );
    return () => cancelar();
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
