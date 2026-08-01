/**
 * Primitivas de CSV para planilha brasileira — fonte única.
 *
 * Estavam privadas dentro de `prazo-statement.ts`; quando a ficha do cliente
 * ganhou exportação, copiar seria repetir as três decisões que fazem o arquivo
 * abrir certo no Excel em português. Regra que precisa ser repetida está no
 * lugar errado.
 */

/** Sem o BOM o Excel abre o arquivo em ANSI e come os acentos. */
export const CSV_BOM = '﻿';

/** Excel em português abre CSV com ponto-e-vírgula; vírgula vira uma coluna só. */
export const CSV_SEP = ';';

export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(CSV_SEP);
}

/** Número no formato que a planilha brasileira entende (1234.5 -> "1234,50"). */
export function csvNumber(value: number): string {
  return (Number(value) || 0).toFixed(2).replace('.', ',');
}

export function csvDate(value?: string): { data: string; hora: string } {
  const time = Date.parse(value || '');
  if (Number.isNaN(time)) return { data: '', hora: '' };
  const date = new Date(time);
  return {
    data: date.toLocaleDateString('pt-BR'),
    hora: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

/** Monta o arquivo final: BOM + linhas com quebra que o Excel entende. */
export function csvArquivo(linhas: string[]): string {
  return CSV_BOM + linhas.join('\r\n');
}

export type ExportCustomer = { nome?: string; celular?: string };

/** Cabeçalho comum dos arquivos de cliente: de quem é e quando saiu. */
export function csvCabecalhoDoCliente(customer: ExportCustomer, titulo: string): string[] {
  const { data, hora } = csvDate(new Date().toISOString());
  return [
    csvLine([titulo]),
    csvLine(['Cliente', customer.nome || '']),
    csvLine(['Telefone', customer.celular || '']),
    csvLine(['Gerado em', `${data} ${hora}`]),
    '',
  ];
}

/** Nome de arquivo previsível e sem acento/espaço (Windows e Excel agradecem). */
export function nomeDeArquivo(prefixo: string, nomeDoCliente?: string): string {
  const slug = (nomeDoCliente || 'cliente')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'cliente';
  const hoje = new Date().toISOString().slice(0, 10);
  return `${prefixo}-${slug}-${hoje}.csv`;
}

/** Dispara o download no navegador. */
export function baixarCsv(conteudo: string, nome: string): void {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
