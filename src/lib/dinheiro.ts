/**
 * Dinheiro gravado no banco tem duas casas — sempre.
 *
 * JavaScript soma dinheiro em binário: `141.60 - 130` dá
 * `11.599999999999994`, e foi isso que ficou gravado na `diferencaCaixa` de um
 * fechamento real (01/08/2026). Na tela ninguém vê, porque `brl()` arredonda na
 * hora de mostrar — mas o número guardado é a base de qualquer relatório de
 * quebra que vier depois, e resíduo somado vira centavo de diferença.
 *
 * Arredondar na EXIBIÇÃO não resolve: tem que ser antes de gravar.
 */

/** Arredonda para centavos. Aceita lixo (null, undefined, texto) e devolve 0. */
export function emDinheiro(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  // O `+` extra tira o resíduo de `Math.round` em números grandes (ex.: 1.005).
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Soma valores já arredondando o resultado — evita acumular resíduo. */
export function somaDinheiro(...valores: unknown[]): number {
  return emDinheiro(valores.reduce((total: number, v) => total + (Number(v) || 0), 0));
}
