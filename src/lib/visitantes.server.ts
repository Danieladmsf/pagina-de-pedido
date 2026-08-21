import { FieldValue } from 'firebase-admin/firestore';
import { LIMITE_LINHA_DO_TEMPO, type EventoVisitante } from '@/lib/visitantes';
import { normalizeCreditPhone } from '@/lib/customer-credit';

/**
 * Reconhecimento do visitante pelo lado do servidor.
 *
 * Roda no webhook do WhatsApp: a pessoa saiu do cardápio para falar com a loja,
 * a mensagem dela chegou com o código curto da visita, e agora dá para dizer que
 * aquele número é quem estava olhando os produtos há dois minutos.
 *
 * É o único caminho que produz identidade CONFIRMADA sem a pessoa digitar nada:
 * a mensagem realmente partiu daquele WhatsApp. Diferente da marca no link, que
 * é encaminhável e por isso vale como "provável".
 */

export interface ReconhecimentoPorCodigo {
  storeId: string;
  codigo: string;
  /** Vazio quando o contato está fora da agenda da loja (a W-API só entrega o @lid). */
  telefone: string;
  /** Nome que a pessoa usa no WhatsApp, quando o provedor manda. */
  nome: string;
}

export async function identificarVisitantePeloCodigo(
  db: any,
  { storeId, codigo, telefone, nome }: ReconhecimentoPorCodigo
): Promise<boolean> {
  if (!db || !storeId || !codigo) return false;

  // `limit(2)` de propósito: código é curto e pode repetir. Dois candidatos é
  // dúvida, e dúvida não escolhe ninguém — é o mesmo princípio do vínculo por
  // telefone (ver as convenções de integridade do projeto).
  const achados = await db
    .collection('store_visitors')
    .where('storeId', '==', storeId)
    .where('codigo', '==', codigo)
    .limit(2)
    .get();

  if (achados.size !== 1) return false;

  const doc = achados.docs[0];
  const dados = doc.data() || {};
  const digitos = normalizeCreditPhone(telefone || '');
  const campos: Record<string, unknown> = { ultimaVez: FieldValue.serverTimestamp() };

  // Telefone que a própria pessoa digitou no carrinho continua valendo: ela
  // pode estar escrevendo do celular do marido. O que veio de link (provável),
  // esse sim é substituído — aqui a origem é o próprio WhatsApp dela.
  if (digitos && (!dados.telefone || dados.viaLink === true)) {
    campos.telefone = digitos;
    campos.viaLink = false;
  }
  if (nome && !dados.nome) campos.nome = String(nome).slice(0, 80);

  const evento: EventoVisitante = { tipo: 'whatsapp', at: Date.now() };
  const linha: EventoVisitante[] = Array.isArray(dados.linhaDoTempo) ? dados.linhaDoTempo : [];
  const ultimo = linha[linha.length - 1];
  // Cliente que manda três mensagens seguidas não vira três eventos.
  if (!ultimo || ultimo.tipo !== 'whatsapp') {
    campos.linhaDoTempo = [...linha, evento].slice(-LIMITE_LINHA_DO_TEMPO);
  }

  await doc.ref.set(campos, { merge: true });
  return true;
}
