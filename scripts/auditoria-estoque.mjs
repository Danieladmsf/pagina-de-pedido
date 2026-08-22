/**
 * O estoque do app fecha com o que entrou e saiu?
 *
 * Nasceu da pergunta "o estoque físico não bate com o do app, será que uma
 * venda duplica quando duas pessoas estão logadas?". A resposta tem que vir dos
 * dados, não de opinião — é isto que este script mede, em todas as lojas:
 *
 *   [A] pedido que reservou MAIS do que tem nele        -> baixa duplicada
 *   [B] venda que não baixou nada, já sob controle      -> baixa perdida
 *   [C] saldo reconstruído x saldo gravado no produto   -> vazamento silencioso
 *   [D] produtos com nome parecido e estoques separados -> a mesma coisa em 2 fichas
 *
 * Venda anterior à data em que o produto passou a ter controle de estoque não
 * conta como erro: naquele tempo ele era ilimitado e não devia mesmo baixar.
 *
 * Somente leitura.
 *
 *   npm run audit:estoque
 *   node scripts/auditoria-estoque.mjs "palha"     (só produtos com esse nome)
 */
import { adminFirestore } from './lib/firebase-admin-db.mjs';

const db = adminFirestore();
const FILTRO = (process.argv[2] || '').trim();
const dt = (ts) => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null);
const q = (d) => (d ? d.toLocaleString('pt-BR') : '—');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dataDoPedido = (o) => new Date(o.orderDateTime || dt(o.createdAt) || 0);

const perfis = new Map(
  (await db.collection('store_profiles').get()).docs.map((d) => [
    d.id,
    d.data()?.general?.name || d.data()?.storeName || '(sem nome)',
  ]),
);
const [itensSnap, movsSnap, ordersSnap] = await Promise.all([
  db.collection('menuItems').get(),
  db.collection('stock_movements').get(),
  db.collection('orders').get(),
]);
const itens = itensSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const movs = movsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const produtoPorId = new Map(itens.map((i) => [i.id, i]));
const interessa = (produto) => !FILTRO || norm(produto?.name).includes(norm(FILTRO));

/** Quando o produto passou a ser contado (primeiro movimento sem estoque anterior). */
function controleComecouEm(itemId) {
  const meus = movs
    .filter((m) => m.itemId === itemId && dt(m.createdAt))
    .sort((a, b) => dt(a.createdAt) - dt(b.createdAt));
  if (!meus.length) return null;
  const inicial = meus.find((m) => m.stockBefore === null || m.stockBefore === undefined);
  return dt((inicial || meus[0]).createdAt);
}

/** O que o pedido deveria ter reservado, com combo expandido nos componentes. */
function demandaDoPedido(pedido) {
  const demanda = {};
  for (const item of pedido.items || []) {
    const qtd = Number(item?.quantity) || 0;
    if (qtd <= 0) continue;
    if (item.isCombo && Array.isArray(item.comboItems)) {
      for (const parte of item.comboItems) {
        if (parte?.itemId) demanda[parte.itemId] = (demanda[parte.itemId] || 0) + qtd;
      }
    } else if (item.id) {
      demanda[item.id] = (demanda[item.id] || 0) + qtd;
    }
  }
  return demanda;
}

const duplicados = [];
const perdidas = [];
for (const pedido of orders) {
  if (String(pedido.status) === 'canceled') continue;
  const reservado = pedido.stockDeductedItems || {};
  const demanda = demandaDoPedido(pedido);

  for (const [itemId, qtd] of Object.entries(reservado)) {
    const produto = produtoPorId.get(itemId);
    if (!interessa(produto)) continue;
    const devido = demanda[itemId] || 0;
    if ((Number(qtd) || 0) > devido) {
      duplicados.push({ pedido, itemId, produto, reservado: Number(qtd), devido });
    }
  }

  for (const [itemId, qtd] of Object.entries(demanda)) {
    const produto = produtoPorId.get(itemId);
    if (!produto || typeof produto.stockQuantity !== 'number' || !interessa(produto)) continue;
    const baixou = Number(reservado[itemId]) || 0;
    if (baixou >= qtd) continue;
    const desde = controleComecouEm(itemId);
    // Sem controle na época = não devia baixar mesmo.
    if (!desde || dataDoPedido(pedido) <= desde) continue;
    perdidas.push({ pedido, produto, baixou, devido: qtd, desde });
  }
}

console.log(`\n[A] BAIXA DUPLICADA (pedido reservou mais do que tem): ${duplicados.length}`);
for (const d of duplicados.slice(0, 25)) {
  console.log(`   ${q(dataDoPedido(d.pedido))} | ${perfis.get(d.pedido.ownerId)} | "${d.produto?.name || d.itemId}"`);
  console.log(`      reservado=${d.reservado} vs no pedido=${d.devido} | pedido ${d.pedido.id}`);
}
if (!duplicados.length) console.log('   nenhuma. A baixa é transacional e idempotente por pedido.');

console.log(`\n[B] BAIXA PERDIDA (venda sob controle que não descontou): ${perdidas.length}`);
for (const p of perdidas.slice(0, 25)) {
  console.log(`   ${q(dataDoPedido(p.pedido))} | ${perfis.get(p.pedido.ownerId)} | "${p.produto.name}"`);
  console.log(`      baixou=${p.baixou} de ${p.devido} | controle desde ${q(p.desde)} | pedido ${p.pedido.id}`);
}
if (!perdidas.length) console.log('   nenhuma.');

console.log(`\n[C] SALDO DIVERGENTE (reconstruído x gravado):`);
let divergentes = 0;
for (const produto of itens) {
  if (typeof produto.stockQuantity !== 'number' || !interessa(produto)) continue;
  const meus = movs
    .filter((m) => m.itemId === produto.id && dt(m.createdAt))
    .sort((a, b) => dt(a.createdAt) - dt(b.createdAt));
  const ultimo = meus[meus.length - 1];
  if (!ultimo || typeof ultimo.stockAfter !== 'number') continue;
  const desde = dt(ultimo.createdAt);

  let baixasDepois = 0;
  for (const pedido of orders) {
    if (pedido.ownerId !== produto.ownerId || String(pedido.status) === 'canceled') continue;
    if (dataDoPedido(pedido) <= desde) continue;
    baixasDepois += Number(pedido.stockDeductedItems?.[produto.id]) || 0;
  }
  const esperado = ultimo.stockAfter - baixasDepois;
  if (esperado !== produto.stockQuantity) {
    divergentes += 1;
    console.log(`   ${perfis.get(produto.ownerId)} | "${produto.name}"`);
    console.log(`      ${q(desde)} deixou ${ultimo.stockAfter}, vendas depois -${baixasDepois} => esperado ${esperado}`);
    console.log(`      gravado no produto: ${produto.stockQuantity}  (diferença ${produto.stockQuantity - esperado})`);
  }
}
if (!divergentes) console.log('   nenhum: todo produto com movimento registrado fecha com as vendas.');

// [D] nao e defeito: e lista para conferir. Uma familia de sabores ("Caseiro
// Sensacao", "Caseiro Cenoura") aparece aqui do mesmo jeito que o produto que
// foi recadastrado e deixou saldo preso na ficha velha. Para investigar um
// caso: node scripts/auditoria-estoque.mjs "palha"
const LIMITE_D = FILTRO ? 999 : 8;
console.log(`
[D] PARA CONFERIR - mesma familia em fichas separadas, com estoque proprio:`);
const porLoja = {};
for (const produto of itens) {
  if (!interessa(produto)) continue;
  // Primeira palavra: "Palha de Ninho e Brigadeiro" e "Palha Italiana com
  // cocada" são o mesmo doce na bandeja, e duas fichas separadas no app.
  const chave = `${produto.ownerId}|${norm(produto.name).split(/\s+/)[0]}`;
  (porLoja[chave] = porLoja[chave] || []).push(produto);
}
let paresSuspeitos = 0;
for (const grupo of Object.values(porLoja)) {
  if (grupo.length < 2) continue;
  // Só interessa quando ALGUÉM do par é contado: dois produtos ilimitados com
  // nome parecido não descasam estoque nenhum (é só o cardápio tendo sabores).
  if (!grupo.some((p) => typeof p.stockQuantity === 'number')) continue;
  paresSuspeitos += 1;
  if (paresSuspeitos > LIMITE_D) continue;
  console.log(`   ${perfis.get(grupo[0].ownerId)}:`);
  for (const p of grupo) {
    console.log(`      "${p.name}" | estoque=${JSON.stringify(p.stockQuantity)} | à venda=${p.isAvailable !== false} | id=${p.id}`);
  }
}
if (!paresSuspeitos) console.log('   nenhum par com nome parecido.');
else if (paresSuspeitos > LIMITE_D) console.log(`   ... e mais ${paresSuspeitos - LIMITE_D} grupo(s). Use o filtro por nome para ver um caso.`);

console.log('\nNenhuma escrita foi feita no Firestore.');
process.exit(0);
