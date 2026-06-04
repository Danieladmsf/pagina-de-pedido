import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./studio-2243391254-75492-firebase-adminsdk-fbsvc-aaa63f07c5.json', 'utf8')
);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const fmt = (v) => {
  try {
    if (!v) return '(vazio)';
    if (typeof v === 'object' && v.toDate) return v.toDate().toISOString();
    return String(v);
  } catch { return String(v); }
};

async function run() {
  // 1) Caixas
  console.log('===== CAIXAS (cash_registers) =====');
  const regs = await db.collection('cash_registers').get();
  regs.forEach(d => {
    const c = d.data();
    console.log(`Caixa ${d.id} | status=${c.status} | sessao=${c.sessao} | abertura=${fmt(c.dataAbertura)} | fechamento=${fmt(c.dataFechamento)} | owner=${c.ownerId}`);
  });

  // 2) Pedidos de MESA em aberto (o que trava o fechamento)
  console.log('\n===== PEDIDOS DINE_IN EM ABERTO (status != delivered/canceled) =====');
  const all = await db.collection('orders').where('orderType', '==', 'dine_in').get();
  const abertos = [];
  all.forEach(d => {
    const o = d.data();
    if (o.status !== 'delivered' && o.status !== 'canceled') abertos.push({ id: d.id, ...o });
  });
  console.log(`Total dine_in em aberto: ${abertos.length}`);
  abertos.forEach(o => {
    console.log('-----------------------------------------------------');
    console.log(`ID         : ${o.id}`);
    console.log(`Cliente    : ${o.customerName}`);
    console.log(`Mesa       : ${o.tableNumber}`);
    console.log(`Status     : ${o.status}`);
    console.log(`PagtoStatus: ${o.paymentStatus}`);
    console.log(`Total      : ${o.totalAmount}`);
    console.log(`Itens      : ${(o.items || []).length}`);
    console.log(`orderDateTime: ${o.orderDateTime}`);
    console.log(`createdAt    : ${fmt(o.createdAt)}`);
    console.log(`source       : ${o.source}`);
    console.log(`ownerId      : ${o.ownerId}`);
  });

  // 3) Todos os pedidos de 03/06 e 04/06 (panorama)
  console.log('\n===== PEDIDOS COM orderDateTime EM 03/06 e 04/06/2026 =====');
  const recent = await db.collection('orders').get();
  const rows = [];
  recent.forEach(d => {
    const o = d.data();
    const dt = o.orderDateTime || '';
    if (typeof dt === 'string' && (dt.startsWith('2026-06-03') || dt.startsWith('2026-06-04'))) {
      rows.push({ id: d.id, type: o.orderType, status: o.status, total: o.totalAmount, mesa: o.tableNumber, dt, created: fmt(o.createdAt) });
    }
  });
  rows.sort((a, b) => (a.dt < b.dt ? -1 : 1));
  rows.forEach(r => console.log(`${r.dt} | ${r.id} | ${r.type} | status=${r.status} | mesa=${r.mesa} | total=${r.total} | created=${r.created}`));
  console.log(`\nTotal 03-04/06: ${rows.length}`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
