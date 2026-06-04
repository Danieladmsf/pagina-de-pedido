import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./studio-2243391254-75492-firebase-adminsdk-fbsvc-aaa63f07c5.json', 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const orderIds = ['Q00PD4YY', 'ZJJX9XBX'];
  for (const id of orderIds) {
    const orderRef = db.collection('orders').doc(id);
    const snap = await orderRef.get();
    if (snap.exists) {
      console.log(`Updating order ${id} status to 'canceled'...`);
      await orderRef.update({ status: 'canceled' });
      console.log(`Order ${id} updated successfully.`);
    } else {
      console.log(`Order ${id} not found.`);
    }
  }
}

run().catch(console.error);
