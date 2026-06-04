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
  console.log("Fetching cash registers...");
  const registersSnapshot = await db.collection('cash_registers').get();
  registersSnapshot.forEach(doc => {
    console.log(`Caixa: ${doc.id} | Status: ${doc.data().status} | Sessao: ${doc.data().sessao} | Owner: ${doc.data().ownerId}`);
  });

  console.log("\nFetching recent orders...");
  const ordersSnapshot = await db.collection('orders').orderBy('createdAt', 'desc').limit(20).get();
  ordersSnapshot.forEach(doc => {
    const data = doc.data();
    console.log(`Order: ${doc.id} | Name: ${data.customerName} | Type: ${data.orderType} | Status: ${data.status} | Total: ${data.totalAmount} | DateTime: ${data.orderDateTime} | Created: ${data.createdAt?.toDate?.() || data.createdAt}`);
  });
}

run().catch(console.error);
