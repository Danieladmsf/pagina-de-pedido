import crypto from 'crypto';

const PREFIX = 'v1';

function getSecretKey() {
  const secret = process.env.WAPI_TOKEN_ENCRYPTION_KEY || process.env.WAPI_API_KEY || process.env.WAPI_INTEGRATOR_TOKEN;
  if (!secret) {
    throw new Error('Configure WAPI_API_KEY ou WAPI_TOKEN_ENCRYPTION_KEY no servidor.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptSecret(value: string) {
  const [prefix, iv, tag, encrypted] = value.split(':');
  if (prefix !== PREFIX || !iv || !tag || !encrypted) {
    throw new Error('Token W-API salvo em formato invalido.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', getSecretKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
