import crypto from 'crypto';

const PREFIX = 'v1';

/**
 * Chaves aceitas para LER o que foi cifrado, em ordem de preferencia — a
 * primeira e tambem a que GRAVA.
 *
 * `WAPI_TOKEN_ENCRYPTION_KEY` e a chave (o prefixo `WAPI_` e historico). Para
 * trocar a chave sem tornar ilegivel o que ja esta salvo, a antiga vai para
 * `WAPI_TOKEN_ENCRYPTION_KEY_LEGACY` (lista separada por virgula): o valor
 * continua sendo lido com ela e volta a ser gravado com a nova no proximo save,
 * sem migracao de dados.
 *
 * Ate 25/09/2026 a chave da conta W-API (`WAPI_API_KEY`) tambem valia aqui,
 * porque os tokens antigos tinham sido cifrados com ela. Saiu junto com a
 * W-API: tudo o que esta cifrado hoje (chave de cada loja, `wt` do webhook,
 * chave de admin do servidor) abre so com a chave dedicada — conferido nos
 * dados antes de tirar.
 */
function getCandidateSecrets() {
  const secrets = [
    process.env.WAPI_TOKEN_ENCRYPTION_KEY,
    ...(process.env.WAPI_TOKEN_ENCRYPTION_KEY_LEGACY || '').split(','),
  ]
    .map((secret) => (secret || '').trim())
    .filter(Boolean);

  const unique = [...new Set(secrets)];
  if (!unique.length) {
    throw new Error('Configure WAPI_TOKEN_ENCRYPTION_KEY no servidor.');
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
    throw new Error('Chave salva em formato invalido.');
  }

  for (const secret of getCandidateSecrets()) {
    try {
      return openWith(secret, iv, tag, encrypted);
    } catch {
      /* tenta a proxima chave conhecida */
    }
  }

  throw new Error('Chave salva nao confere com nenhuma chave conhecida do servidor.');
}

/** Grava de novo com a chave preferencial quando o valor veio de uma chave antiga. */
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
