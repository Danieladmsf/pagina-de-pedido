/**
 * Importacao de contatos para a base de Campanhas (colecao `clientes`).
 * Fonte dupla: arquivo CSV (modelo abaixo) e contatos do WhatsApp (via
 * /wapi/contacts). Grava SEM sobrescrever clientes ja existentes — contatos
 * importados nascem com totalPedidos 0 e marca `source: 'import'`.
 */
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { normalizeCreditPhone } from '@/lib/customer-credit';

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

/** Quebra uma linha de CSV respeitando aspas e aceitando `,` ou `;` como separador. */
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
  return out.map((c) => c.trim());
}

/**
 * Le o arquivo CSV e devolve a lista de contatos. Detecta cabecalho com
 * `nome`/`celular` (aceita telefone/whatsapp/fone); sem cabecalho reconhecido,
 * assume coluna 0 = nome e coluna 1 = celular.
 */
export async function parseContactsCsvFile(file: File): Promise<ImportContact[]> {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buffer);
  // CSV salvo pelo Excel costuma vir em windows-1252: se a decodificacao UTF-8
  // gerou caractere de substituicao, tenta de novo no encoding do Excel.
  if (text.includes('�')) {
    text = new TextDecoder('windows-1252').decode(buffer);
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const nameIdx = header.findIndex((h) => h === 'nome' || h === 'name');
  const phoneIdx = header.findIndex((h) => ['celular', 'telefone', 'whatsapp', 'fone', 'phone'].includes(h));

  const hasHeader = nameIdx >= 0 || phoneIdx >= 0;
  const nIdx = nameIdx >= 0 ? nameIdx : 0;
  const pIdx = phoneIdx >= 0 ? phoneIdx : 1;

  const contacts: ImportContact[] = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const nome = (cols[nIdx] || '').trim();
    const celular = (cols[pIdx] || '').trim();
    if (!nome && !celular) continue;
    contacts.push({ nome, celular });
  }
  return contacts;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Grava os contatos na colecao `clientes`. Pula os que ja existem (mesmo docId
 * `${ownerId}_${telefone}`) para NAO zerar dados de clientes reais, e os sem
 * telefone valido. Escreve em lotes (limite do Firestore por batch).
 */
export async function importContactsToClientes(
  db: any,
  ownerId: string,
  contacts: ImportContact[],
): Promise<ImportResult> {
  if (!db || !ownerId || contacts.length === 0) return { imported: 0, skipped: 0 };

  // Pre-carrega os ids existentes para nao sobrescrever clientes reais.
  const existing = new Set<string>();
  try {
    const snap = await getDocs(query(collection(db, 'clientes'), where('ownerId', '==', ownerId)));
    snap.forEach((d: any) => existing.add(d.id));
  } catch {
    // Sem a lista previa, o set() ainda dedup por docId — mas pode reescrever.
  }

  let imported = 0;
  let skipped = 0;
  let batch = writeBatch(db);
  let inBatch = 0;
  const seen = new Set<string>();

  for (const c of contacts) {
    const normalizedPhone = normalizeCreditPhone(c.celular || '');
    if (!normalizedPhone || normalizedPhone.length < 10) { skipped++; continue; }

    const docId = `${ownerId}_${normalizedPhone}`;
    if (existing.has(docId) || seen.has(docId)) { skipped++; continue; }
    seen.add(docId);

    batch.set(doc(db, 'clientes', docId), {
      id: docId,
      nome: (c.nome || '').trim() || normalizedPhone,
      celular: normalizedPhone,
      totalPedidos: 0,
      ticketMedio: 0,
      ownerId,
      source: 'import',
      importedAt: new Date().toISOString(),
    });
    imported++;
    inBatch++;

    if (inBatch >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      inBatch = 0;
    }
  }

  if (inBatch > 0) await batch.commit();
  return { imported, skipped };
}
