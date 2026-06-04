const crypto = require('crypto');

// Load environment variables from .env.local
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }
}

const PREFIX = 'v1';

function getSecretKey() {
  const secret = process.env.WAPI_TOKEN_ENCRYPTION_KEY || process.env.WAPI_API_KEY || process.env.WAPI_INTEGRATOR_TOKEN;
  if (!secret) {
    throw new Error('Configure WAPI_API_KEY ou WAPI_TOKEN_ENCRYPTION_KEY no servidor.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function decryptSecret(value) {
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

async function run() {
  const instanceId = 'LITE-JMDANG-I3824S';
  const encryptedToken = 'v1:ZF9Na_7o7GjnT1TA:nyAWhhgM3m1qw3C8XAnWdg:qVd7Yomp5oWBr-YFXijnW6prxbxiiPnqKEho35HWyS-z';
  
  console.log('Decrypted key source (WAPI_API_KEY):', process.env.WAPI_API_KEY);
  
  let decryptedToken;
  try {
    decryptedToken = decryptSecret(encryptedToken);
    console.log('Decrypted Token:', decryptedToken);
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return;
  }

  const baseUrl = 'https://api.w-api.app/v1';

  async function makeRequest(path, query = {}) {
    const url = new URL(`${baseUrl}${path}`);
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    console.log(`\nGET ${url.toString()}`);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${decryptedToken}`,
      },
    });

    console.log('Status:', response.status, response.statusText);
    const text = await response.text();
    console.log('Response body:', text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  console.log('--- Fetching Instance Status ---');
  await makeRequest('/instance/status-instance', { instanceId });

  console.log('--- Fetching QR Code ---');
  await makeRequest('/instance/qrcode', { instanceId, syncContacts: 'disable' });
}

run().catch(console.error);
