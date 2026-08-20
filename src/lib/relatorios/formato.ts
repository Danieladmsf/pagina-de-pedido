/**
 * Como o relatório escreve número na tela.
 *
 * Fonte única porque as mesmas três formas aparecem no ranking, no balancete e
 * na curva do produto — e "1,350 kg" numa tela e "1.35kg" na outra é o tipo de
 * detalhe que faz a pessoa desconfiar do número.
 */

/** Gramas viram quilo com 3 casas: 10 g de diferença ainda aparece. */
export const emKg = (gramas: number): string =>
  `${((Number(gramas) || 0) / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} kg`;

/** Fração (0,057) vira porcentagem curta ("5,7%"). */
export const emPorcento = (fracao: number): string =>
  `${((Number(fracao) || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Quanto saiu, na unidade certa do produto. */
export const quantoSaiu = (linha: { porPeso: boolean; gramas: number; quantidade: number }): string =>
  linha.porPeso ? emKg(linha.gramas) : `${linha.quantidade} un`;
