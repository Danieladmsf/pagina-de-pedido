require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('./serviceAccountKey.json'))
  });
}

function decrypt(encryptedText) {
  const ALGORITHM = 'aes-256-cbc';
  const SECRET_KEY = process.env.WAPI_TOKEN_SECRET || 'fallback_secret_key_32_chars_min!!';
  const buffer = Buffer.from(SECRET_KEY, 'utf-8');
  const key = crypto.createHash('sha256').update(buffer).digest();
  
  const [ivHex, authTagHex, encryptedHex] = encryptedText.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    return encryptedText;
  }
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function test() {
  const snapshot = await admin.firestore().collection('roles_admin').get();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.whatsappIntegration && data.whatsappIntegration.instanceName === 'Sucos e Vitaminas Lima Limão') {
      const wapi = data.whatsappIntegration;
      console.log('Found:', wapi.wapiInstanceId);
      const token = decrypt(wapi.wapiTokenEncrypted);
      
      const res = await fetch(`https://wapi.app.br/v1/instance/qrcode?instanceId=${wapi.wapiInstanceId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const body = await res.text();
      console.log('QR Code API Response:', res.status, body.substring(0, 500));
    }
  }
}

test();
