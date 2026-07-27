import crypto from 'crypto';

const PREFIX = 'v1';

/**
 * Chaves aceitas para LER o token salvo, em ordem de preferencia — a primeira e
 * tambem a que GRAVA.
 *
 * Historicamente nao existia `WAPI_TOKEN_ENCRYPTION_KEY` e o token de cada
 * instancia acabava cifrado com a propria `WAPI_API_KEY`. Como a chave deriva do
 * sha256 do segredo, trocar a API key da conta W-API tornava TODOS os tokens
 * salvos ilegiveis de uma vez, em todas as lojas, sem volta — o dono so via
 * "erro ao descriptografar" e precisava recadastrar tudo.
 *
 * Aceitar as chaves antigas na leitura torna a rotacao segura: o token continua
 * sendo lido com a chave velha e volta a ser gravado com a nova no proximo save,
 * sem migracao de dados. `WAPI_TOKEN_ENCRYPTION_KEY_LEGACY` (lista separada por
 * virgula) guarda chaves aposentadas enquanto ainda houver token antigo por ai.
 */
function getCandidateSecrets() {
  const secrets = [
    process.env.WAPI_TOKEN_ENCRYPTION_KEY,
    process.env.WAPI_API_KEY,
    process.env.WAPI_INTEGRATOR_TOKEN,
    ...(process.env.WAPI_TOKEN_ENCRYPTION_KEY_LEGACY || '').split(','),
  ]
    .map((secret) => (secret || '').trim())
    .filter(Boolean);

  const unique = [...new Set(secrets)];
  if (!unique.length) {
    throw new Error('Configure WAPI_API_KEY ou WAPI_TOKEN_ENCRYPTION_KEY no servidor.');
  }
  return unique;
}

function toKey(secret: string) {
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', toKey(getCandidateSecrets()[0]), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

function openWith(secret: string, iv: string, tag: string, encrypted: string) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', toKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function decryptSecret(value: string) {
  const [prefix, iv, tag, encrypted] = String(value || '').split(':');
  if (prefix !== PREFIX || !iv || !tag || !encrypted) {
    throw new Error('Token W-API salvo em formato invalido.');
  }

  for (const secret of getCandidateSecrets()) {
    try {
      return openWith(secret, iv, tag, encrypted);
    } catch {
      /* tenta a proxima chave conhecida */
    }
  }

  throw new Error('Token W-API salvo nao confere com nenhuma chave conhecida do servidor.');
}

/** Grava de novo com a chave preferencial quando o token veio de uma chave antiga. */
export function needsReencrypt(value: string) {
  const [prefix, iv, tag, encrypted] = String(value || '').split(':');
  if (prefix !== PREFIX || !iv || !tag || !encrypted) return false;

  try {
    openWith(getCandidateSecrets()[0], iv, tag, encrypted);
    return false;
  } catch {
    return true;
  }
}
