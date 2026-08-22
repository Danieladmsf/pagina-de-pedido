/**
 * O que a loja mostra bate com o que entrou no caixa?
 *
 * Nasceu de um dia real: 22/08/2026, Gostinho de Céu. O Dashboard dizia
 * R$ 181,00 e o caixa tinha R$ 441,00 — a diferença eram duas encomendas
 * entregues, que vivem em `encomendas` e nunca estiveram em `orders`. Este
 * script varre as lojas todas atrás dessa classe de erro: dinheiro que uma
 * tela vê e a outra não, e dinheiro contado duas vezes.
 *
 * Somente leitura. Não escreve nada no Firestore.
 *
 *   npm run audit:faturamento          (últimos 60 dias)
 *   node scripts/auditoria-faturamento.mjs 30
 */
import { adminFirestore } from './lib/firebase-admin-db.mjs';

const db = adminFirestore();
const DIAS = Number(process.argv[2] || 60);
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const emData = (ts) => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null);
const dia = (d) => (d ? d.toLocaleDateString('pt-BR') : '—');
const CANCELADO = new Set(['canceled', 'cancelada', 'cancelled', 'cancelado']);

const desde = new Date();
desde.setDate(desde.getDate() - DIAS);
desde.setHours(0, 0, 0, 0);

const ehFiado = (l) => /^\s*acerto de prazo\b/i.test(l.titulo || '');
const ehEncomenda = (l) => !!l.encomendaId || /^\s*encomenda\b/i.test(l.titulo || '');
const ehVenda = (l) => l.tipo === 'venda' && !l.canceled;

/** Mesma regra conservadora do app: prefixo de 5, pedido anterior, e um só. */
function pedidoDoTitulo(pedidos, titulo, quandoLancou) {
  const achou = String(titulo || '').match(/#([A-Za-z0-9]+)/);
  if (!achou) return null;
  const prefixo = achou[1].substring(0, 5);
  if (prefixo.length < 5 || !quandoLancou) return null;
  const candidatos = pedidos.filter((p) => {
    if (!String(p.id || '').startsWith(prefixo)) return false;
    const criado = emData(p.createdAt) || emData(p.orderDateTime);
    return criado && criado <= quandoLancou;
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

const porLoja = (snap) => {
  const mapa = new Map();
  for (const doc of snap.docs) {
    const dado = { id: doc.id, ...doc.data() };
    if (!dado.ownerId) continue;
    if (!mapa.has(dado.ownerId)) mapa.set(dado.ownerId, []);
    mapa.get(dado.ownerId).push(dado);
  }
  return mapa;
};

const perfis = (await db.collection('store_profiles').get()).docs;
const [ordersSnap, encomendasSnap, cashSnap] = await Promise.all([
  db.collection('orders').get(),
  db.collection('encomendas').get(),
  db.collection('cash_transactions').get(),
]);
const O = porLoja(ordersSnap);
const E = porLoja(encomendasSnap);
const C = porLoja(cashSnap);

const geral = { lojas: 0, encomendas: 0, semLancar: 0, duplicados: 0, encomendaAberta: 0 };
const soma = (lista, campo = 'valor') => lista.reduce((s, x) => s + (Number(x[campo]) || 0), 0);

for (const perfil of perfis) {
  const ownerId = perfil.id;
  const nome = perfil.data()?.general?.name || perfil.data()?.storeName || '(sem nome)';
  const pedidos = O.get(ownerId) || [];
  const encomendas = E.get(ownerId) || [];
  const lancamentos = (C.get(ownerId) || []).filter((l) => (emData(l.data) || 0) >= desde);
  const vendas = lancamentos.filter(ehVenda);
  const pedidosDoPeriodo = pedidos.filter((p) => {
    const quando = emData(p.orderDateTime) || emData(p.createdAt);
    return quando && quando >= desde && !CANCELADO.has(String(p.status));
  });
  if (!vendas.length && !pedidosDoPeriodo.length) continue;
  geral.lojas += 1;

  console.log(`\n${'='.repeat(78)}\n${nome}  — últimos ${DIAS} dias\n${'='.repeat(78)}`);

  const semFiado = vendas.filter((l) => !ehFiado(l));
  const doCaixa = soma(semFiado);
  const fiado = soma(vendas.filter(ehFiado));
  const soDePedidos = soma(pedidosDoPeriodo, 'totalAmount');

  console.log(`  Vendas no caixa (sem fiado)  : ${brl(doCaixa).padStart(14)}  (${semFiado.length} lanç.)`);
  console.log(`  Só a coleção orders          : ${brl(soDePedidos).padStart(14)}  (${pedidosDoPeriodo.length} pedidos)`);
  if (fiado) console.log(`  Fiado recebido (à parte)     : ${brl(fiado).padStart(14)}`);

  // 1. Encomendas: dinheiro que só o caixa enxerga.
  const deEncomenda = semFiado.filter(ehEncomenda);
  if (deEncomenda.length) {
    console.log(`\n  [1] ENCOMENDAS no caixa: ${brl(soma(deEncomenda))} em ${deEncomenda.length} lançamentos`);
    geral.encomendas += soma(deEncomenda);
  }

  // 2. Pedido válido que nunca foi lançado no caixa.
  const cobertos = new Set();
  for (const l of semFiado) {
    if (ehEncomenda(l)) continue;
    if (l.orderId) {
      cobertos.add(l.orderId);
      continue;
    }
    const achado = pedidoDoTitulo(pedidos, l.titulo, emData(l.data));
    if (achado) cobertos.add(achado.id);
  }
  const semLancar = pedidosDoPeriodo.filter((p) => !cobertos.has(p.id));
  if (semLancar.length) {
    const total = soma(semLancar, 'totalAmount');
    console.log(`\n  [2] PEDIDOS sem lançamento no caixa: ${semLancar.length} — ${brl(total)}`);
    for (const p of semLancar.slice(-5)) {
      console.log(`      ${dia(emData(p.orderDateTime) || emData(p.createdAt))} | ${String(p.status).padEnd(14)} | ${brl(p.totalAmount).padStart(11)} | pgto="${p.paymentMethod || '-'}"`);
    }
    geral.semLancar += total;
  }

  // 3. Duplo clique: mesmo vínculo, mesma forma, mesmo valor, segundos depois.
  const grupos = new Map();
  for (const l of vendas) {
    const chave = l.orderId ? `o:${l.orderId}` : l.encomendaId ? `e:${l.encomendaId}` : null;
    if (!chave) continue;
    const k = `${chave}|${String(l.formaPagamento || '').toLowerCase()}|${Number(l.valor) || 0}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  }
  const duplicados = [];
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => emData(a.data) - emData(b.data));
    for (let i = 1; i < lista.length; i++) {
      const intervalo = (emData(lista[i].data) - emData(lista[i - 1].data)) / 1000;
      if (intervalo <= 120) duplicados.push({ lanc: lista[i], intervalo });
    }
  }
  if (duplicados.length) {
    const total = soma(duplicados.map((d) => d.lanc));
    console.log(`\n  [3] LANÇAMENTO DUPLICADO (duplo clique): ${duplicados.length} — ${brl(total)} a mais`);
    for (const d of duplicados) {
      console.log(`      ${dia(emData(d.lanc.data))} ${emData(d.lanc.data).toLocaleTimeString('pt-BR')} (+${d.intervalo}s) | ${brl(d.lanc.valor)} | ${d.lanc.titulo} | id=${d.lanc.id}`);
    }
    geral.duplicados += total;
  }

  // 4. Encomenda com dinheiro em aberto (ou recebido a mais).
  const pagoPorEncomenda = {};
  for (const l of C.get(ownerId) || []) {
    if (ehVenda(l) && l.encomendaId) {
      pagoPorEncomenda[l.encomendaId] = (pagoPorEncomenda[l.encomendaId] || 0) + (Number(l.valor) || 0);
    }
  }
  const divergentes = encomendas.filter((e) => {
    if (CANCELADO.has(String(e.status))) return false;
    const total = Number(e.total ?? e.totalAmount) || 0;
    return Math.abs(total - (pagoPorEncomenda[e.id] || 0)) > 0.01;
  });
  if (divergentes.length) {
    console.log(`\n  [4] ENCOMENDAS com valor em aberto:`);
    for (const e of divergentes) {
      const total = Number(e.total ?? e.totalAmount) || 0;
      const pago = pagoPorEncomenda[e.id] || 0;
      const rotulo = pago > total ? `SOBRA ${brl(pago - total)}` : `FALTA ${brl(total - pago)}`;
      console.log(`      ${e.id} | ${String(e.status).padEnd(11)} | total=${brl(total).padStart(11)} | entrou=${brl(pago).padStart(11)} | ${rotulo}`);
      if (pago < total) geral.encomendaAberta += total - pago;
    }
  }
}

console.log(`\n\n${'#'.repeat(78)}\nRESUMO (${DIAS} dias · ${geral.lojas} loja(s))\n${'#'.repeat(78)}`);
console.log(`  Encomendas que só o caixa vê           : ${brl(geral.encomendas)}`);
console.log(`  Pedidos que não passaram no caixa      : ${brl(geral.semLancar)}`);
console.log(`  Lançamentos duplicados                 : ${brl(geral.duplicados)}`);
console.log(`  Encomenda em aberto (falta receber)    : ${brl(geral.encomendaAberta)}`);
console.log(`\nNenhuma escrita foi feita no Firestore.`);
process.exit(0);
