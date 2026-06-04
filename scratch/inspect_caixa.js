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
  console.log("Fetching open cash registers...");
  const caixasSnapshot = await db.collection('cash_registers').where('status', '==', 'aberto').get();
  let openCaixa = null;
  caixasSnapshot.forEach(doc => {
    openCaixa = { id: doc.id, ...doc.data() };
    console.log(`Caixa ID: ${openCaixa.id}`);
    console.log(`Sessao: ${openCaixa.sessao}`);
    console.log(`Status: ${openCaixa.status}`);
    console.log(`Abertura: ${openCaixa.dataAbertura?.toDate?.() || openCaixa.dataAbertura}`);
    console.log(`Fechamento: ${openCaixa.dataFechamento?.toDate?.() || openCaixa.dataFechamento}`);
  });

  if (!openCaixa) {
    console.log("No open cash register found!");
    return;
  }

  const openingTime = openCaixa.dataAbertura?.toDate?.()?.getTime() || 0;
  const closingTime = openCaixa.dataFechamento?.toDate?.()?.getTime() || Infinity;

  console.log(`\nActive caixa time range: ${new Date(openingTime).toLocaleString()} to ${closingTime === Infinity ? 'Infinity' : new Date(closingTime).toLocaleString()}`);

  console.log("\nFetching orders for this owner...");
  const ordersSnapshot = await db.collection('orders').where('ownerId', '==', openCaixa.ownerId).get();
  const allOrders = [];
  ordersSnapshot.forEach(doc => {
    allOrders.push({ id: doc.id, ...doc.data() });
  });

  console.log(`Total orders found: ${allOrders.length}`);

  console.log("\nOrders within caixa range:");
  const filteredOrders = allOrders.filter(o => {
    const oTime = new Date(o.orderDateTime || o.createdAt || 0).getTime();
    return oTime >= (openingTime - 60000) && oTime <= (closingTime + 60000);
  });

  console.log(`Filtered orders count: ${filteredOrders.length}`);
  
  const openOrdersInRange = filteredOrders.filter(o => !['delivered', 'canceled'].includes(o.status));
  console.log(`\nOpen orders in range (${openOrdersInRange.length}):`);
  openOrdersInRange.forEach(o => {
    console.log(`- [${o.status}] ${o.id}: ${o.customerName} (${o.orderType}) Total: ${o.totalAmount} DateTime: ${o.orderDateTime}`);
  });

  const canceledOrdersInRange = filteredOrders.filter(o => o.status === 'canceled');
  console.log(`\nCanceled orders in range (${canceledOrdersInRange.length}):`);
  canceledOrdersInRange.forEach(o => {
    console.log(`- [${o.status}] ${o.id}: ${o.customerName} (${o.orderType}) Total: ${o.totalAmount} DateTime: ${o.orderDateTime}`);
  });
}

run().catch(console.error);
