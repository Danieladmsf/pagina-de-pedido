import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const serviceAccount = JSON.parse(readFileSync('./studio-2243391254-75492-firebase-adminsdk-fbsvc-aaa63f07c5.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const ids = ['85ABK4RT', 'MW4XSRG5'];
const run = async () => {
  for (const id of ids) {
    const ref = db.collection('orders').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`${id}: NAO EXISTE`); continue; }
    const before = snap.data().status;
    await ref.update({ status: 'canceled' });
    const after = (await ref.get()).data().status;
    console.log(`${id} (${snap.data().customerName} | R$ ${snap.data().totalAmount}): ${before} -> ${after}`);
  }
  // Confirma quantos dine_in em aberto restam no caixa atual (aberto em 2026-06-03T12:37)
  const all = await db.collection('orders').where('orderType', '==', 'dine_in').get();
  const abertosCaixaAtual = [];
  all.forEach(d => {
    const o = d.data();
    if (o.status !== 'delivered' && o.status !== 'canceled' && typeof o.orderDateTime === 'string' && o.orderDateTime >= '2026-06-03T12:37') {
      abertosCaixaAtual.push(`${d.id} (${o.customerName}, mesa=${o.tableNumber}, ${o.orderDateTime})`);
    }
  });
  console.log(`\nDine_in em aberto restantes na janela do caixa atual: ${abertosCaixaAtual.length}`);
  abertosCaixaAtual.forEach(x => console.log('  - ' + x));
};
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
