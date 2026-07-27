/**
 * Auditoria dos cadastros de cliente e das contas de Prazo (somente leitura).
 *
 * Confere, loja por loja:
 *   A. o saldo do Prazo bate com a soma do extrato (credit_transactions);
 *   B. toda venda a prazo lançada no caixa tem o débito na conta de um cliente;
 *   C. todo débito na conta de um cliente tem a venda correspondente no caixa;
 *   D. cadastros duplicados, sem telefone ou com telefone inválido.
 *
 * O extrato é a fonte de verdade do saldo: `creditBalance` é só um contador e
 * pode dessincronizar. Divergência em A quase sempre significa que alguém
 * recadastrou um cliente que já existia.
 *
 * Uso:
 *   node scripts/auditoria-clientes.mjs                 # todas as lojas
 *   node scripts/auditoria-clientes.mjs <ownerId>       # uma loja só
 *
 * Precisa da chave de service account (`*firebase-adminsdk*.json` na raiz do
 * projeto, fora do git). O Admin SDK ignora as regras do Firestore.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

function acharChave() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const arquivo = readdirSync(RAIZ).find((f) => f.includes('firebase-adminsdk') && f.endsWith('.json'));
  if (!arquivo) {
    console.error('Nao achei a chave de service account (*firebase-adminsdk*.json) na raiz do projeto.');
    process.exit(1);
  }
  return join(RAIZ, arquivo);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(acharChave(), 'utf8'))) });
const db = getFirestore();

const filtroOwner = process.argv[2] || null;

const brl = (v) => 'R$ ' + (Number(v) || 0).toFixed(2);
const num = (v) => Number(v) || 0;
const norm = (s) => (s || '').toString().normalize('NFD')
  .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toLowerCase().replace(/\s+/g, ' ').trim();
const normPhone = (p) => (p || '').toString().replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
const telValido = (p) => p.length === 10 || p.length === 11;
/** Código curto do pedido, que liga o lançamento do caixa ao débito do cliente. */
const refCode = (s) => { const m = (s || '').match(/#(\w+)/); return m ? m[1] : null; };

/** Lê em lotes: um a um, uma loja grande leva minutos. */
async function emLotes(itens, tamanho, fn) {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...await Promise.all(itens.slice(i, i + tamanho).map(fn)));
  }
  return saida;
}

const perfis = (await db.collection('store_profiles').get()).docs
  .filter((d) => !filtroOwner || d.id === filtroOwner)
  .map((d) => ({ ownerId: d.id, nome: d.data()?.general?.name || d.id }));

if (!perfis.length) {
  console.error(filtroOwner ? `Loja ${filtroOwner} nao encontrada.` : 'Nenhuma loja encontrada.');
  process.exit(1);
}

let totalProblemas = 0;

for (const loja of perfis) {
  const clientes = (await db.collection('clientes').where('ownerId', '==', loja.ownerId).get()).docs;
  if (!clientes.length && filtroOwner === null) continue;

  console.log('\n' + '='.repeat(72));
  console.log(`LOJA: ${loja.nome}  (${clientes.length} clientes)`);
  console.log('='.repeat(72));

  const cash = (await db.collection('cash_transactions').where('ownerId', '==', loja.ownerId).get()).docs;
  const extratos = new Map(await emLotes(clientes, 25, async (d) => [
    d.id,
    (await db.collection('clientes').doc(d.id).collection('credit_transactions').get()).docs.map((t) => t.data()),
  ]));

  // ── A. Saldo x extrato ──
  console.log('\n--- A. SALDO DO PRAZO x EXTRATO ---');
  let divergentes = 0;
  for (const d of clientes) {
    const c = d.data();
    const tx = extratos.get(d.id) || [];
    const somaExtrato = tx.reduce((s, t) => s + (t.type === 'debit' ? 1 : -1) * num(t.amount), 0);
    if (Math.abs(somaExtrato - num(c.creditBalance)) > 0.009) {
      divergentes++; totalProblemas++;
      console.log(`  [DIVERGE] ${c.nome} (${d.id})`);
      console.log(`            saldo gravado ${brl(c.creditBalance)} | extrato ${brl(somaExtrato)} | diferenca ${brl(num(c.creditBalance) - somaExtrato)} | ${tx.length} lancamento(s)`);
    }
  }
  if (!divergentes) console.log('  ok - todos os saldos batem com o extrato');

  // ── B/C. Caixa x conta do cliente ──
  const debitosPorRef = new Map();
  for (const [id, tx] of extratos) {
    for (const t of tx) {
      if (t.type !== 'debit') continue;
      const chave = refCode(t.description) || norm(t.description);
      if (!debitosPorRef.has(chave)) debitosPorRef.set(chave, []);
      debitosPorRef.get(chave).push({ id, valor: num(t.amount) });
    }
  }
  const vendasPrazo = cash.filter((d) => (d.data().formaPagamento || '').includes('conta_casa') && !d.data().canceled);
  const refsNoCaixa = new Set(vendasPrazo.map((d) => refCode(d.data().titulo) || norm((d.data().titulo || '').replace(/ \(Prazo\)$/, ''))));

  console.log('\n--- B. VENDA A PRAZO NO CAIXA SEM DEBITO EM CLIENTE ---');
  let semDono = 0, valorSemDono = 0;
  for (const d of vendasPrazo) {
    const t = d.data();
    const chave = refCode(t.titulo) || norm((t.titulo || '').replace(/ \(Prazo\)$/, ''));
    const casou = (debitosPorRef.get(chave) || []).some((h) => Math.abs(h.valor - num(t.valor)) < 0.009);
    if (!casou) {
      semDono++; valorSemDono += num(t.valor); totalProblemas++;
      const dt = t.data?.toDate?.();
      console.log(`  [SEM DONO] ${t.titulo} | ${brl(t.valor)} | ${dt ? dt.toLocaleString('pt-BR') : '?'}`);
    }
  }
  console.log(`  -> ${vendasPrazo.length} venda(s) a prazo no caixa, ${semDono} sem dono (${brl(valorSemDono)})`);

  console.log('\n--- C. DEBITO NO CLIENTE SEM VENDA NO CAIXA ---');
  let semCaixa = 0;
  for (const [id, tx] of extratos) {
    const nome = clientes.find((d) => d.id === id)?.data().nome;
    for (const t of tx) {
      if (t.type !== 'debit') continue;
      const chave = refCode(t.description) || norm(t.description);
      if (!refsNoCaixa.has(chave)) {
        semCaixa++; totalProblemas++;
        console.log(`  [SEM CAIXA] ${nome} | ${t.description} | ${brl(t.amount)} | ${String(t.date).slice(0, 10)}`);
      }
    }
  }
  if (!semCaixa) console.log('  ok');

  // ── D. Cadastros ──
  console.log('\n--- D. CADASTROS ---');
  const porTelefone = new Map();
  for (const d of clientes) {
    const p = normPhone(d.data().celular);
    if (!telValido(p)) continue;
    if (!porTelefone.has(p)) porTelefone.set(p, []);
    porTelefone.get(p).push(d);
  }
  let duplicados = 0;
  for (const [tel, lista] of porTelefone) {
    if (lista.length < 2) continue;
    duplicados++; totalProblemas++;
    console.log(`  [DUPLICADO] telefone ${tel} em ${lista.length} cadastros:`);
    lista.forEach((d) => console.log(`     ${d.id} | ${d.data().nome} | ${num(d.data().totalPedidos)} pedido(s) | saldo ${brl(d.data().creditBalance)}`));
  }
  if (!duplicados) console.log('  nenhum telefone repetido');

  // Sem telefone o cadastro nao liga ao app nem ao Prazo. Com Prazo ativo é grave.
  const semTelefone = clientes.filter((d) => !normPhone(d.data().celular));
  const orfaosComPrazo = semTelefone.filter((d) => d.data().creditEnabled === true);
  if (orfaosComPrazo.length) {
    totalProblemas += orfaosComPrazo.length;
    console.log(`\n  [GRAVE] ${orfaosComPrazo.length} cadastro(s) com Prazo ativo e SEM telefone - a venda a prazo nunca vai achar esse cliente:`);
    orfaosComPrazo.forEach((d) => console.log(`     ${d.id} | ${d.data().nome} | limite ${brl(d.data().creditLimit)}`));
  }
  const semTelSemPrazo = semTelefone.length - orfaosComPrazo.length;
  if (semTelSemPrazo) console.log(`\n  ${semTelSemPrazo} cadastro(s) sem telefone e sem Prazo (so contam venda de balcao)`);

  const telRuim = clientes.filter((d) => { const p = normPhone(d.data().celular); return p && !telValido(p); });
  if (telRuim.length) {
    console.log(`\n  ${telRuim.length} telefone(s) invalido(s) (nem 10 nem 11 digitos):`);
    telRuim.forEach((d) => console.log(`     ${d.id} | ${d.data().nome} | "${d.data().celular}"`));
  }
}

console.log('\n' + '='.repeat(72));
console.log(totalProblemas ? `${totalProblemas} ponto(s) para olhar.` : 'Tudo certo: nenhum problema encontrado.');
process.exit(totalProblemas ? 1 : 0);
