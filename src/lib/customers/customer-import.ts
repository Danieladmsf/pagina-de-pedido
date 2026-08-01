import { isValidCreditPhone, normalizeCreditPhone } from '@/lib/customer-credit';

export type ImportCustomerLike = {
  id: string;
  ownerId?: string;
  celular?: string;
  archived?: boolean;
};

export type CustomerImportIndex = {
  ownerId: string;
  byId: Map<string, ImportCustomerLike>;
  byPhone: Map<string, ImportCustomerLike[]>;
};

export type CustomerImportResolution =
  | { status: 'existing'; id: string; normalizedPhone: string; customer: ImportCustomerLike }
  | { status: 'new'; id: string; normalizedPhone: string }
  | { status: 'invalid'; normalizedPhone: string }
  | { status: 'duplicate'; normalizedPhone: string; customerIds: string[] }
  | { status: 'archived'; normalizedPhone: string; customerIds: string[] }
  | { status: 'collision'; id: string; normalizedPhone: string; customerIds: string[] };

/**
 * Indice em memoria usado durante importacoes. O telefone sempre e comparado
 * normalizado; o id do documento so entra como desempate/guarda de colisao.
 */
export function buildCustomerImportIndex(
  ownerId: string,
  customers: ImportCustomerLike[],
): CustomerImportIndex {
  const byId = new Map<string, ImportCustomerLike>();
  const byPhone = new Map<string, ImportCustomerLike[]>();

  for (const customer of customers || []) {
    if (!customer?.id) continue;
    // Consultas dos chamadores ja sao filtradas por ownerId. Ainda assim,
    // falhamos fechado se uma lista misturada for passada por engano.
    if (customer.ownerId && customer.ownerId !== ownerId) continue;
    if (byId.has(customer.id)) continue;
    byId.set(customer.id, customer);

    const phone = normalizeCreditPhone(String(customer.celular || ''));
    if (!isValidCreditPhone(phone)) continue;
    const current = byPhone.get(phone) || [];
    current.push(customer);
    byPhone.set(phone, current);
  }

  return { ownerId, byId, byPhone };
}

/**
 * Resolve uma linha com telefone pela cardinalidade dos cadastros ATIVOS:
 *  - 1 ativo: reutiliza o id real (inclusive id legado/aleatorio);
 *  - >1 ativos: conflito, nunca escolhe o primeiro;
 *  - 0 ativos + arquivado: conflito, nunca reativa por importacao;
 *  - 0 cadastros: propoe id deterministico, desde que ele esteja livre.
 */
export function resolveCustomerImportPhone(
  index: CustomerImportIndex,
  rawPhone: string,
): CustomerImportResolution {
  const normalizedPhone = normalizeCreditPhone(String(rawPhone || ''));
  if (!isValidCreditPhone(normalizedPhone)) {
    return { status: 'invalid', normalizedPhone };
  }

  const matching = index.byPhone.get(normalizedPhone) || [];
  const active = matching.filter((customer) => customer.archived !== true);
  if (active.length > 1) {
    return {
      status: 'duplicate',
      normalizedPhone,
      customerIds: active.map((customer) => customer.id),
    };
  }
  if (active.length === 1) {
    return {
      status: 'existing',
      id: active[0].id,
      normalizedPhone,
      customer: active[0],
    };
  }

  const archived = matching.filter((customer) => customer.archived === true);
  if (archived.length > 0) {
    return {
      status: 'archived',
      normalizedPhone,
      customerIds: archived.map((customer) => customer.id),
    };
  }

  const id = `${index.ownerId}_${normalizedPhone}`;
  const collision = index.byId.get(id);
  if (collision) {
    return {
      status: 'collision',
      id,
      normalizedPhone,
      customerIds: [collision.id],
    };
  }

  return { status: 'new', id, normalizedPhone };
}

/**
 * Guarda para exclusao de clientes com pedidos legados ainda sem clienteId.
 * Deliberadamente nao aplica aliases: telefone com 10 digitos nao corresponde
 * ao de 11 digitos, mesmo quando os demais algarismos coincidem.
 */
export function hasExactLegacyCustomerPhone(record: any, customerPhone: string): boolean {
  if (record?.clienteId) return false;
  const normalizedCustomerPhone = normalizeCreditPhone(String(customerPhone || ''));
  if (!isValidCreditPhone(normalizedCustomerPhone)) return false;
  const recordPhone = normalizeCreditPhone(String(
    record?.customerPhone || record?.cliente?.telefone || '',
  ));
  return recordPhone === normalizedCustomerPhone;
}
