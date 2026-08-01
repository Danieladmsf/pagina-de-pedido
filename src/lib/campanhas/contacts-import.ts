/**
 * Importacao de contatos de Campanhas para a colecao `clientes` via CSV.
 * Clientes existentes nunca sao sobrescritos por este fluxo.
 */
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import {
  buildCustomerImportIndex,
  resolveCustomerImportPhone,
} from '@/lib/customers/customer-import';

export interface ImportContact {
  nome: string;
  celular: string;
}

export const CONTACTS_CSV_TEMPLATE =
  'nome,celular\r\nMaria Silva,16999990000\r\nJoao Souza,16988887777\r\n';

/** Baixa um modelo de CSV (nome,celular) para o lojista preencher. */
export function downloadContactsCsvTemplate() {
  if (typeof window === 'undefined') return;
  const blob = new Blob([CONTACTS_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo-contatos.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Quebra uma linha de CSV respeitando aspas e aceitando `,` ou `;`. */
function parseCsvLine(line: string): string[] {
  const sep = line.includes(';') && !line.includes(',') ? ';' : ',';
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((column) => column.trim());
}

/**
 * Le o CSV. Detecta nome/celular (e aliases); sem cabecalho reconhecido,
 * assume coluna 0 = nome e coluna 1 = celular.
 */
export async function parseContactsCsvFile(file: File): Promise<ImportContact[]> {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buffer);
  if (text.includes('\uFFFD')) {
    text = new TextDecoder('windows-1252').decode(buffer);
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((value) => value.replace(/^\uFEFF/, '').toLowerCase());
  const nameIdx = header.findIndex((value) => value === 'nome' || value === 'name');
  const phoneIdx = header.findIndex((value) =>
    ['celular', 'telefone', 'whatsapp', 'fone', 'phone'].includes(value));
  const hasHeader = nameIdx >= 0 || phoneIdx >= 0;
  const resolvedNameIdx = nameIdx >= 0 ? nameIdx : 0;
  const resolvedPhoneIdx = phoneIdx >= 0 ? phoneIdx : 1;

  const contacts: ImportContact[] = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const columns = parseCsvLine(lines[i]);
    const nome = (columns[resolvedNameIdx] || '').trim();
    const celular = (columns[resolvedPhoneIdx] || '').trim();
    if (!nome && !celular) continue;
    contacts.push({ nome, celular });
  }
  return contacts;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  skippedByReason: {
    invalid: number;
    existing: number;
    duplicate: number;
    archived: number;
    collision: number;
    duplicateCsv: number;
  };
}

/**
 * Importa apenas contatos comprovadamente novos. A resolucao considera o
 * telefone normalizado de todos os clientes da loja, e nao somente o docId.
 */
export async function importContactsToClientes(
  db: any,
  ownerId: string,
  contacts: ImportContact[],
): Promise<ImportResult> {
  const skippedByReason: ImportResult['skippedByReason'] = {
    invalid: 0,
    existing: 0,
    duplicate: 0,
    archived: 0,
    collision: 0,
    duplicateCsv: 0,
  };
  if (!db || !ownerId || contacts.length === 0) {
    return { imported: 0, skipped: 0, skippedByReason };
  }

  // Sem o preload completo, qualquer set() poderia duplicar um id legado ou
  // sobrescrever um id deterministico que hoje pertence a outro telefone.
  const existingCustomers: any[] = [];
  try {
    const snap = await getDocs(query(collection(db, 'clientes'), where('ownerId', '==', ownerId)));
    snap.forEach((customerDoc: any) => {
      existingCustomers.push({ id: customerDoc.id, ...(customerDoc.data() || {}) });
    });
  } catch (error) {
    const reason = error instanceof Error ? ` (${error.message})` : '';
    throw new Error(`Nao foi possivel conferir a base de clientes${reason}. Nenhum contato foi importado.`);
  }

  const index = buildCustomerImportIndex(ownerId, existingCustomers);
  const seenPhones = new Set<string>();
  const planned: Array<{ id: string; nome: string; celular: string }> = [];

  // Valida o arquivo inteiro antes de criar a primeira transacao.
  for (const contact of contacts) {
    const resolution = resolveCustomerImportPhone(index, contact.celular || '');
    if (resolution.status === 'invalid') {
      skippedByReason.invalid++;
      continue;
    }
    if (seenPhones.has(resolution.normalizedPhone)) {
      skippedByReason.duplicateCsv++;
      continue;
    }
    seenPhones.add(resolution.normalizedPhone);

    if (resolution.status !== 'new') {
      skippedByReason[resolution.status]++;
      continue;
    }

    planned.push({
      id: resolution.id,
      nome: (contact.nome || '').trim() || resolution.normalizedPhone,
      celular: resolution.normalizedPhone,
    });
  }

  const importedAt = new Date().toISOString();
  for (let offset = 0; offset < planned.length; offset += 400) {
    const chunk = planned.slice(offset, offset + 400);
    await runTransaction(db, async (transaction) => {
      const refs = chunk.map((customer) => doc(db, 'clientes', customer.id));
      const currentDocs = await Promise.all(refs.map((ref) => transaction.get(ref)));
      currentDocs.forEach((current, index) => {
        if (current.exists()) {
          throw new Error(`O identificador ${chunk[index].id} foi ocupado durante a importacao. Nenhum contato deste lote foi sobrescrito.`);
        }
      });

      chunk.forEach((customer, index) => {
        // Apenas documentos comprovadamente novos chegam aqui. A leitura e a
        // escrita na mesma transacao tornam a operacao create-only.
        transaction.set(refs[index], {
          id: customer.id,
          nome: customer.nome,
          celular: customer.celular,
          totalPedidos: 0,
          ticketMedio: 0,
          ownerId,
          source: 'import',
          importedAt,
        });
      });
    });
  }

  const skipped = Object.values(skippedByReason).reduce((total, count) => total + count, 0);
  return { imported: planned.length, skipped, skippedByReason };
}
