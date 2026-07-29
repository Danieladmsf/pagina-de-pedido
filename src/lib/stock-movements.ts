import {
  Firestore,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { getManagedStock } from './inventory';

/**
 * Movimentação de estoque — o "livro caixa" dos produtos.
 *
 * Por que existe: a dona repunha estoque digitando o TOTAL ("tem 15, saiu mais
 * 15, ponho 30"). Isso é uma conta de cabeça feita em cima de um número que se
 * mexe sozinho: se entrarem 2 vendas entre ler e digitar, nascem 2 unidades
 * fantasma. Aqui a soma é feita pelo banco, dentro de uma transação — ela diz
 * QUANTO entrou, nunca quanto ficou.
 *
 * Vendas não são gravadas aqui: elas já estão nos pedidos e a tela de histórico
 * junta as duas fontes. Assim o cliente anônimo do cardápio não ganha permissão
 * de escrever nesta coleção.
 */

export type StockMovementType = 'entrada' | 'saida' | 'ajuste';

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  ajuste: 'Ajuste',
};

export interface StockMovement {
  id?: string;
  ownerId: string;
  itemId: string;
  itemName: string;
  type: StockMovementType;
  /** Quanto o estoque mudou: positivo entra, negativo sai. */
  delta: number;
  /** null = o produto não tinha controle de estoque antes. */
  stockBefore: number | null;
  stockAfter: number;
  note: string;
  userName: string;
  createdAt?: any;
}

/** Erro de regra de negócio da movimentação (mensagem já pronta pra tela). */
export class StockMovementError extends Error {
  code = 'stock-movement' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StockMovementError';
  }
}

/** Quantidade digitada -> inteiro >= 0. Retorna null se não for um número usável. */
export function parseQuantity(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  if (raw === '') return null;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Calcula o resultado de uma movimentação. Puro — a transação usa isto e os
 * testes cobrem as regras sem precisar do Firestore.
 *
 * - entrada: soma. Em produto sem controle, a entrada INICIA o controle.
 * - saida:   subtrai, nunca abaixo de zero. Não faz sentido em produto sem controle.
 * - ajuste:  define o total (contagem física).
 */
export function computeMovement(
  type: StockMovementType,
  stockBefore: number | null,
  quantity: number,
): { stockAfter: number; delta: number } {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new StockMovementError('Informe uma quantidade válida.');
  }

  if (type === 'ajuste') {
    return { stockAfter: quantity, delta: quantity - (stockBefore ?? 0) };
  }

  if (type === 'entrada') {
    if (quantity === 0) throw new StockMovementError('Informe quantas unidades entraram.');
    const base = stockBefore ?? 0;
    return { stockAfter: base + quantity, delta: quantity };
  }

  // saida
  if (quantity === 0) throw new StockMovementError('Informe quantas unidades saíram.');
  if (stockBefore === null) {
    throw new StockMovementError('Este produto está sem controle de estoque. Faça uma entrada ou um ajuste primeiro.');
  }
  if (quantity > stockBefore) {
    throw new StockMovementError(
      `Só há ${stockBefore} unidade(s) em estoque — não é possível dar saída de ${quantity}.`,
    );
  }
  return { stockAfter: stockBefore - quantity, delta: -quantity };
}

export interface ApplyStockChangeParams {
  ownerId: string;
  itemId: string;
  type: StockMovementType;
  quantity: number;
  note?: string;
  userName?: string;
}

/**
 * Aplica a movimentação e registra no histórico, de forma ATÔMICA: o produto e
 * o lançamento são gravados na mesma transação, então não existe estoque
 * alterado sem registro nem registro sem alteração.
 */
export async function applyStockChange(
  db: Firestore,
  { ownerId, itemId, type, quantity, note = '', userName = '' }: ApplyStockChangeParams,
): Promise<StockMovement> {
  return runTransaction(db, async (tx) => {
    const itemRef = doc(db, 'menuItems', itemId);
    const snap = await tx.get(itemRef);
    if (!snap.exists()) throw new StockMovementError('Produto não encontrado.');

    const data = snap.data();
    const stockBefore = getManagedStock(data.stockQuantity);
    const { stockAfter, delta } = computeMovement(type, stockBefore, quantity);

    const movement: StockMovement = {
      ownerId,
      itemId,
      itemName: data.name || itemId,
      type,
      delta,
      stockBefore,
      stockAfter,
      note: note.trim(),
      userName,
    };

    tx.update(itemRef, { stockQuantity: stockAfter });
    tx.set(doc(collection(db, 'stock_movements')), { ...movement, createdAt: serverTimestamp() });

    return movement;
  });
}

// ─────────────────────────── Histórico e exportação ───────────────────────────

/** Uma linha do histórico, venha ela de um ajuste manual ou de uma venda. */
export interface HistoryRow {
  id: string;
  date: Date | null;
  itemId: string;
  itemName: string;
  /** 'venda' só existe no histórico (é derivada dos pedidos), nunca gravada. */
  kind: StockMovementType | 'venda';
  delta: number;
  stockBefore: number | null;
  stockAfter: number | null;
  note: string;
  userName: string;
}

export const HISTORY_LABELS: Record<HistoryRow['kind'], string> = {
  ...MOVEMENT_LABELS,
  venda: 'Venda',
};

/** Sem o BOM o Excel abre o arquivo em ANSI e come os acentos. */
const BOM = '﻿';
/** Excel em português abre CSV com ponto-e-vírgula; vírgula vira uma coluna só. */
const SEP = ';';

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(SEP);
}

/** Histórico em planilha, na ordem em que aconteceu. */
export function buildMovementsCsv(rows: HistoryRow[], storeName = ''): string {
  const now = new Date();
  const entradas = rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const saidas = rows.filter((r) => r.delta < 0).reduce((s, r) => s + r.delta, 0);

  const lines = [
    csvLine(['Movimentação de estoque']),
    csvLine(['Loja', storeName]),
    csvLine(['Gerado em', `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`]),
    csvLine(['Lançamentos', rows.length]),
    csvLine(['Total que entrou', entradas]),
    csvLine(['Total que saiu', Math.abs(saidas)]),
    '',
    csvLine(['Data', 'Hora', 'Produto', 'Tipo', 'Quantidade', 'Estoque antes', 'Estoque depois', 'Observação', 'Quem fez']),
  ];

  for (const r of rows) {
    lines.push(
      csvLine([
        r.date ? r.date.toLocaleDateString('pt-BR') : '',
        r.date ? r.date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
        r.itemName,
        HISTORY_LABELS[r.kind],
        r.delta > 0 ? `+${r.delta}` : String(r.delta),
        r.stockBefore ?? '',
        r.stockAfter ?? '',
        r.note,
        r.userName,
      ]),
    );
  }

  return BOM + lines.join('\r\n');
}

/** Dispara o download do CSV no navegador. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
