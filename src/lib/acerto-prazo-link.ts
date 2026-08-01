/** Nome que ficou apenas para exibição nos lançamentos antigos. */
export function clienteDoTituloAcerto(titulo?: string): string {
  const match = (titulo || '').match(/^\s*acerto de prazo\s*-\s*(.+)$/i);
  return match ? match[1].trim() : '';
}

/** A linha é um recebimento de dívida do Prazo, não uma venda comum. */
export function isAcertoPrazo(lanc: { tipo?: string; titulo?: string }): boolean {
  return lanc.tipo === 'venda' && /^\s*acerto de prazo\b/i.test(lanc.titulo || '');
}

export type AcertoClienteLink =
  | { linked: true; clienteId: string }
  | { linked: false; nomeLegado: string };

/**
 * O nome do título nunca é identidade. Somente os lançamentos que gravaram
 * `clienteId` podem abrir uma conta; o legado fica explicitamente sem vínculo.
 */
export function resolveAcertoClienteLink(lanc: {
  clienteId?: unknown;
  titulo?: string;
}): AcertoClienteLink {
  const clienteId = typeof lanc.clienteId === 'string' ? lanc.clienteId.trim() : '';
  return clienteId
    ? { linked: true, clienteId }
    : { linked: false, nomeLegado: clienteDoTituloAcerto(lanc.titulo) };
}
