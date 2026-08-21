import crypto from 'crypto';

/**
 * O lado secreto da marca de contato: cifrar e abrir.
 *
 * Só o servidor faz as duas coisas. O telefone NUNCA viaja em texto no link nem
 * chega ao navegador de quem clica — o cardápio manda a marca de volta para o
 * servidor, e é o servidor que grava a identidade no perfil do visitante.
 *
 * Por que uma implementação própria em vez de reusar `wapi/crypto`: aquela
 * produz um texto de ~100 caracteres, o que deixaria o link do cardápio
 * gigante na tela do cliente. Aqui o conteúdo é minúsculo (telefone + validade)
 * e o formato é enxuto de propósito:
 *
 *   8 bytes de IV + 8 bytes de selo + 8 bytes cifrados = 32 caracteres.
 *
 * O selo (tag do AES-GCM) truncado em 64 bits é proporcional ao que está sendo
 * protegido: a marca vale poucos dias, só liga um telefone a uma visita, e a
 * identidade que sai dela é tratada como provável até a pessoa se identificar.
 */

const IV_BYTES = 8;
const SELO_BYTES = 8;
const EPOCA = Date.UTC(2020, 0, 1);
const DIA_MS = 24 * 60 * 60 * 1000;

function chave(storeId: string): Buffer {
  const segredo = [
    process.env.WAPI_TOKEN_ENCRYPTION_KEY,
    process.env.WAPI_API_KEY,
    process.env.WAPI_INTEGRATOR_TOKEN,
  ]
    .map((s) => (s || '').trim())
    .find(Boolean);

  if (!segredo) {
    throw new Error('Configure WAPI_API_KEY ou WAPI_TOKEN_ENCRYPTION_KEY no servidor.');
  }
  // Sal próprio: a mesma senha do servidor gera uma chave DIFERENTE da que
  // guarda os tokens da W-API — uma marca de link nunca abre um token de envio.
  //
  // A LOJA entra na chave: marca feita pela loja A simplesmente não abre na loja
  // B. Sem isso, alguém poderia pegar o link que recebeu de uma loja e usá-lo
  // para plantar o próprio telefone no painel de outra.
  return crypto.createHash('sha256').update(`marca-de-contato:${segredo}:${storeId}`).digest();
}

function paraBytes(telefone: string, validadeEmDias: number): Buffer {
  const digitos = String(telefone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (!/^\d{10,11}$/.test(digitos)) throw new Error('Telefone fora do formato para marcar o link.');

  const buf = Buffer.alloc(8);
  buf.writeUIntBE(Number(digitos), 0, 6);
  const vence = Math.floor((Date.now() + validadeEmDias * DIA_MS - EPOCA) / DIA_MS);
  buf.writeUInt16BE(Math.max(0, Math.min(65535, vence)), 6);
  return buf;
}

export interface MarcaDeContato {
  telefone: string;
  venceEm: Date;
}

/** Cifra o contato numa marca curta para entrar no link. */
export function criarMarcaDeContato(storeId: string, telefone: string, validadeEmDias: number): string {
  if (!storeId) throw new Error('Marca de contato precisa da loja.');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(storeId), iv, { authTagLength: SELO_BYTES });
  const cifrado = Buffer.concat([cipher.update(paraBytes(telefone, validadeEmDias)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString('base64url');
}

/**
 * Abre a marca. Devolve `null` para qualquer coisa que não confira — marca
 * adulterada, cifrada com outra chave ou vencida. Nunca lança: quem chama está
 * atendendo um cliente e a visita continua valendo mesmo sem identidade.
 */
export function lerMarcaDeContato(storeId: string, marca: string): MarcaDeContato | null {
  try {
    if (!storeId) return null;
    const bruto = Buffer.from(String(marca || ''), 'base64url');
    if (bruto.length !== IV_BYTES + SELO_BYTES + 8) return null;

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      chave(storeId),
      bruto.subarray(0, IV_BYTES),
      { authTagLength: SELO_BYTES }
    );
    decipher.setAuthTag(bruto.subarray(IV_BYTES, IV_BYTES + SELO_BYTES));
    const aberto = Buffer.concat([
      decipher.update(bruto.subarray(IV_BYTES + SELO_BYTES)),
      decipher.final(),
    ]);

    const telefone = String(aberto.readUIntBE(0, 6));
    const venceEm = new Date(EPOCA + aberto.readUInt16BE(6) * DIA_MS);
    if (venceEm.getTime() < Date.now()) return null;
    if (!/^\d{10,11}$/.test(telefone)) return null;

    return { telefone, venceEm };
  } catch {
    return null;
  }
}
