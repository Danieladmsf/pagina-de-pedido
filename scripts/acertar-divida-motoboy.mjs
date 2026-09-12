/**
 * Acerta a dívida acumulada de um motoboy que já foi paga por fora do caixa.
 *
 * Nasceu de um caso real (Lima Limão, 12/09/2026): o Eduardo aparecia devendo
 * R$ 4.326,60 acumulados desde 28/05. O dinheiro tinha sido pago — a loja
 * acerta com ele toda segunda por Pix — mas 87 dos 89 fechamentos passaram com
 * o motoboy em "pago R$ 0,00", então o sistema nunca viu o pagamento e a
 * pilha só crescia. Ver a memória [[saldo-motoboy-nao-zera]].
 *
 * O acerto é um lançamento `tipo: 'acerto_motoboy'` SEM `caixaId`: ele abate o
 * saldo devedor e não encosta em gaveta, fechamento nem faturamento (esses só
 * olham 'venda'/'sangria'/'suprimento' e filtram por sessão). O histórico de
 * entregas continua inteiro para consulta por período — só o saldo zera.
 *
 * Dry-run por padrão. Só grava com --apply.
 *
 *   node scripts/acertar-divida-motoboy.mjs --loja <ownerId> --motoboy <id> --ate 2026-09-06
 *   node scripts/acertar-divida-motoboy.mjs ... --religar <txId> --apply
 */
import { adminFirestore } from './lib/firebase-admin-db.mjs';
import { FieldValue } from 'firebase-admin/firestore';

const db = adminFirestore();
const args = process.argv.slice(2);
const opt = (nome, padrao = null) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
};
const APPLY = args.includes('--apply');
const OWNER = opt('loja');
const MOTOBOY = opt('motoboy');
const ATE = opt('ate'); // YYYY-MM-DD, inclusive: dívida até o fim deste dia
const RELIGAR = args.flatMap((a, i) => (a === '--religar' && args[i + 1] ? [args[i + 1]] : []));

if (!OWNER || !MOTOBOY || !ATE) {
  console.error('uso: --loja <ownerId> --motoboy <id> --ate YYYY-MM-DD [--religar <txId>] [--apply]');
  process.exit(1);
}

const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const emData = (ts) => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null);
const dia = (d) => (d ? d.toLocaleDateString('pt-BR') : '—');
/** Centavos inteiros: dinheiro se arredonda ao gravar ([[dinheiro-arredonda-ao-gravar]]). */
const emDinheiro = (n) => Math.round((Number(n) || 0) * 100) / 100;
const corte = new Date(`${ATE}T23:59:59.999`);

const perfil = await db.collection('store_profiles').doc(OWNER).get();
if (!perfil.exists) throw new Error(`loja ${OWNER} não existe`);
const motoboys = perfil.data()?.motoboys || [];
const mb = motoboys.find((m) => m.id === MOTOBOY);
if (!mb) throw new Error(`motoboy ${MOTOBOY} não está no cadastro da loja`);
const fee = Number(mb.fee || 0);

const [caixasSnap, txSnap, ordersSnap] = await Promise.all([
  db.collection('cash_registers').where('ownerId', '==', OWNER).get(),
  db.collection('cash_transactions').where('ownerId', '==', OWNER).get(),
  db.collection('orders').where('ownerId', '==', OWNER).get(),
]);
const caixas = caixasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const txs = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const pedidos = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

console.log(`LOJA ${OWNER}`);
console.log(`MOTOBOY ${mb.name} (${MOTOBOY}), diária ${brl(fee)}`);
console.log(`CORTE: dívida até ${dia(corte)} inclusive\n`);

// --- 1. Religar vales órfãos indicados (pagamento sem dono) ---
const religados = [];
for (const id of RELIGAR) {
  const t = txs.find((x) => x.id === id);
  if (!t) { console.log(`  !! religar: ${id} não encontrado`); continue; }
  if (t.ownerId !== OWNER) { console.log(`  !! religar: ${id} é de outra loja`); continue; }
  if (t.destinatarioId) { console.log(`  !! religar: ${id} já tem dono (${t.destinatarioId})`); continue; }
  religados.push(t);
  console.log(`  religar ${dia(emData(t.data))} ${brl(Math.abs(t.valor))} "${t.titulo}" -> ${mb.name}`);
}

// --- 2. Saldo, pela MESMA regra da tela (CaixaTab.motoboysComSaldoPendente) ---
const idsReligados = new Set(religados.map((t) => t.id));
const ehRepasse = (l) =>
  (l.tipo === 'sangria' || l.tipo === 'acerto_motoboy')
  && l.destinatarioTipo === 'motoboy'
  && !l.canceled
  && (l.destinatarioId === MOTOBOY || idsReligados.has(l.id));

let devidoTotal = 0, devidoAteCorte = 0;
for (const c of caixas) {
  const ab = emData(c.dataAbertura);
  const abertura = ab?.getTime() ?? 0;
  const fechamento = emData(c.dataFechamento)?.getTime() ?? Infinity;
  let trabalhou = false, fretes = 0;
  for (const o of pedidos) {
    if (o.motoboyId !== MOTOBOY || o.status === 'canceled') continue;
    const t = new Date(o.orderDateTime || o.createdAt || 0).getTime();
    if (t < abertura - 60000 || t > fechamento + 60000) continue;
    trabalhou = true;
    if (o.payDeliveryToMotoboy !== true) fretes += Number(o.deliveryFee || 0);
  }
  if (!trabalhou) continue;
  const total = fee + fretes;
  devidoTotal += total;
  if (ab && ab <= corte) devidoAteCorte += total;
}

let pagoTotal = 0, pagoAteCorte = 0;
for (const l of txs) {
  if (!ehRepasse(l)) continue;
  const v = Math.abs(Number(l.valor) || 0);
  // Um acerto vale pelo período que COBRE (acertoAte), não pelo dia em que foi
  // gravado — senão, relido, ele cairia do lado errado do corte e o relatório
  // mostraria a dívida já quitada como se ainda estivesse em aberto.
  const d = l.tipo === 'acerto_motoboy'
    ? (l.acertoAte ? new Date(`${l.acertoAte}T23:59:59.999`) : emData(l.data))
    : emData(l.data);
  pagoTotal += v;
  if (d && d <= corte) pagoAteCorte += v;
}

const saldoTotal = emDinheiro(devidoTotal - pagoTotal);
const saldoDepoisDoCorte = emDinheiro((devidoTotal - devidoAteCorte) - (pagoTotal - pagoAteCorte));
const acerto = emDinheiro(saldoTotal - saldoDepoisDoCorte);

console.log('\n== SALDO (já contando os vales religados acima) ==');
console.log(`  devido total    ${brl(devidoTotal)}`);
console.log(`  pago total      ${brl(pagoTotal)}`);
console.log(`  SALDO HOJE      ${brl(saldoTotal)}`);
console.log(`\n  fica em aberto (depois de ${dia(corte)}): ${brl(saldoDepoisDoCorte)}`);
console.log(`  ACERTO A GRAVAR:                        ${brl(acerto)}`);

if (acerto <= 0) {
  console.log('\nNada a acertar (saldo até o corte é zero ou negativo). Nenhuma escrita.');
  process.exit(0);
}

// Um acerto por motoboy+corte: reexecutar não duplica a baixa
// ([[encomenda-lancamento-id-deterministico]]).
const acertoId = `acerto_${OWNER}_${MOTOBOY}_${ATE}`.replace(/[^A-Za-z0-9_.-]/g, '');
const jaExiste = txs.find((t) => t.id === acertoId);
if (jaExiste) {
  console.log(`\n!! Já existe o acerto ${acertoId} (${brl(Math.abs(jaExiste.valor))}). Reexecutar vai SOBRESCREVÊ-LO, não somar.`);
}

const doc = {
  caixaId: '', // fora de qualquer sessão: não é movimento de gaveta
  ownerId: OWNER,
  tipo: 'acerto_motoboy',
  titulo: `Acerto de dívida — ${mb.name} (até ${dia(corte)})`,
  valor: -acerto,
  formaPagamento: 'pix',
  data: FieldValue.serverTimestamp(),
  usuario: 'Acerto administrativo',
  destinatarioId: MOTOBOY,
  destinatarioTipo: 'motoboy',
  acertoAte: ATE,
};

if (!APPLY) {
  console.log('\n--- DRY-RUN, nada foi gravado. Rode de novo com --apply ---');
  console.log(`  cash_transactions/${acertoId}`);
  console.log(JSON.stringify({ ...doc, data: '<serverTimestamp>' }, null, 2));
  if (religados.length) console.log(`  + ${religados.length} vale(s) religado(s) a ${mb.name}`);
  process.exit(0);
}

const batch = db.batch();
for (const t of religados) {
  batch.update(db.collection('cash_transactions').doc(t.id), {
    destinatarioId: MOTOBOY,
    titulo: `Adiantamento / Vale para Motoboy: ${mb.name}`,
    religadoEm: FieldValue.serverTimestamp(),
    religadoDe: 'sem destinatário (confirmado pelo dono)',
  });
}
batch.set(db.collection('cash_transactions').doc(acertoId), doc);
await batch.commit();

console.log(`\nGRAVADO: acerto de ${brl(acerto)} + ${religados.length} vale(s) religado(s).`);
console.log(`Saldo do ${mb.name} agora: ${brl(saldoDepoisDoCorte)}`);
