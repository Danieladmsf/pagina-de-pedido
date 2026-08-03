/**
 * O retrato da base de clientes: quantos ainda compram e quantos entraram agora.
 *
 * O card "Base de Clientes" do Dashboard mostrava, embaixo do total, quantos
 * produtos e categorias a loja tem — dado do CARDÁPIO num card de CLIENTE. Lido
 * na tela, dava a entender que os clientes estavam divididos em 17 categorias.
 *
 * "Ativo" segue a mesma régua da aba Campanhas ("Ativos (últimos 30 dias)"):
 * duas telas com a mesma palavra não podem devolver números diferentes.
 *
 * Função pura, sem Firestore e sem React.
 */

import { parseDateBR } from '@/lib/campanhas/audience';

/** Dias sem comprar depois dos quais o cliente deixa de contar como ativo. */
export const DIAS_PARA_SER_ATIVO = 30;

export type ClienteDaBase = {
  /** Data do cadastro, gravada como texto pt-BR ("21/05/2025"). */
  clienteDesde?: string;
  /** Data da última compra, mesmo formato. */
  ultimoPedido?: string;
  /** Cadastros novos gravam ISO; entra como reserva quando não há clienteDesde. */
  createdAt?: string;
};

export type ResumoDaBase = {
  total: number;
  /** Compraram nos últimos 30 dias. */
  ativos: number;
  /** Entraram no mês corrente. */
  novosNoMes: number;
};

const mesmoMes = (data: Date, referencia: Date) =>
  data.getFullYear() === referencia.getFullYear() && data.getMonth() === referencia.getMonth();

export function resumoDaBaseDeClientes(
  clientes: ClienteDaBase[],
  agora: Date = new Date(),
): ResumoDaBase {
  const lista = Array.isArray(clientes) ? clientes : [];
  const limiteAtivo = agora.getTime() - DIAS_PARA_SER_ATIVO * 86400000;

  let ativos = 0;
  let novosNoMes = 0;

  for (const cliente of lista) {
    const ultimaCompra = parseDateBR(cliente?.ultimoPedido);
    if (ultimaCompra > 0 && ultimaCompra >= limiteAtivo) ativos += 1;

    // `clienteDesde` é o campo do cadastro (98% da base tem); `createdAt` cobre
    // os poucos gravados só em ISO.
    const cadastro = parseDateBR(cliente?.clienteDesde) || parseDateBR(cliente?.createdAt);
    if (cadastro > 0 && mesmoMes(new Date(cadastro), agora)) novosNoMes += 1;
  }

  return { total: lista.length, ativos, novosNoMes };
}
