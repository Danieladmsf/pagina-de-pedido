// Helpers server-side para buscar o perfil da loja via REST do Firestore
// (sem SDK, com cache do fetch do Next). Usados pela página pública da loja
// e pelo manifest dinâmico do PWA.

const FIRESTORE_PROJECT = 'studio-2243391254-75492';

// Parse do formato REST do Firestore para objeto simples. O arrayValue é
// essencial: sem ele, qualquer array do perfil (ex.: encomendas.catalog.tortas,
// fees.feeRules) virava null e caía silenciosamente nos defaults.
const parseValue = (val: any): any => {
  if (!val) return null;
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return Number(val.integerValue);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.arrayValue) return (val.arrayValue.values || []).map(parseValue);
  if (val.mapValue) {
    const obj: any = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = parseValue(v);
    }
    return obj;
  }
  return null;
};

const parseDocFields = (doc: any): any => {
  const fields: any = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    fields[k] = parseValue(v);
  }
  return fields;
};

export async function fetchStoreProfile(storeId: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/store_profiles/${storeId}`;
    // cache 5min; a tag permite invalidar na hora via /api/revalidate-store
    // (os editores do admin chamam após salvar, senão a página pública demora até 5min)
    const res = await fetch(url, { next: { revalidate: 300, tags: [`store-${storeId}`] } });
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc.fields) return null;
    return parseDocFields(doc);
  } catch {
    return null;
  }
}

// Produtos da loja (coleção menuItems) via REST — usados pela página pública de
// encomendas para resolver SKUs vinculados (SkuOption.productId → nome/preço/foto).
export async function fetchMenuItems(storeId: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'menuItems' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'ownerId' },
            op: 'EQUAL',
            value: { stringValue: storeId }
          }
        }
      }
    };
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 300, tags: [`store-${storeId}`] }
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((row: any) => row?.document)
      .map((row: any) => {
        const parts = String(row.document.name).split('/');
        return { ...parseDocFields(row.document), id: parts[parts.length - 1] };
      });
  } catch {
    return [];
  }
}

export async function fetchStoreName(storeId: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/roles_admin/${storeId}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const doc = await res.json();
    return doc.fields?.storeName?.stringValue || null;
  } catch {
    return null;
  }
}

export async function fetchStoreIdFromSlug(shortSlug: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'store_profiles' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'shortSlug' },
            op: 'EQUAL',
            value: { stringValue: shortSlug }
          }
        },
        limit: 1
      }
    };
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 3600 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data[0] && data[0].document) {
      const docPath = data[0].document.name;
      const parts = docPath.split('/');
      return parts[parts.length - 1];
    }
    return null;
  } catch (err) {
    console.error('Error in fetchStoreIdFromSlug:', err);
    return null;
  }
}

// Resolve o storeId a partir do slug da URL ("nome-da-loja-abc123" ou shortSlug)
export async function resolveStoreIdFromSlugParam(storeSlug: string) {
  const slug = decodeURIComponent(storeSlug);
  const parts = slug.split('-');
  const rawStoreId = parts.pop() || '';
  if (!rawStoreId) return null;

  if (rawStoreId.length <= 8) {
    const resolved = await fetchStoreIdFromSlug(rawStoreId);
    if (resolved) return resolved;
  }
  return rawStoreId;
}
