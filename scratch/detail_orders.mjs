import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const serviceAccount = JSON.parse(readFileSync('./studio-2243391254-75492-firebase-adminsdk-fbsvc-aaa63f07c5.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const ids = ['85ABK4RT', 'MW4XSRG5'];
const run = async () => {
  for (const id of ids) {
    const snap = await db.collection('orders').doc(id).get();
    if (!snap.exists) { console.log(`${id}: NAO EXISTE`); continue; }
    console.log('==================', id, '==================');
    console.log(JSON.stringify(snap.data(), null, 2));
  }
};
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
