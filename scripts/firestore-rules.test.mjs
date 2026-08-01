/**
 * Teste de integração das Security Rules (sem dependência npm adicional).
 * Requer Java 21+ no PATH e o Firebase CLI:
 *
 * npx firebase-tools@13.35.1 emulators:exec --only firestore \
 *   --project demo-cardapio-rules "node scripts/firestore-rules.test.mjs"
 */
import assert from 'node:assert/strict';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
assert.ok(
  emulatorHost,
  'Execute via Firebase Emulator: firebase emulators:exec --only firestore "node scripts/firestore-rules.test.mjs"',
);

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-cardapio-rules';
const apps = [];

function client(name, auth) {
  const app = initializeClientApp({ projectId, apiKey: 'demo-key', appId: `demo-${name}` }, name);
  apps.push(app);
  const db = getFirestore(app);
  // `mockUserToken` só é reconhecido por connectFirestoreEmulator — passá-lo
  // dentro de initializeFirestore(settings) é silenciosamente ignorado e
  // deixa o client sem auth nenhuma (request.auth == null para todo mundo).
  const [host, port] = emulatorHost.split(':');
  connectFirestoreEmulator(db, host, Number(port), auth
    ? {
        mockUserToken: {
          sub: auth.uid,
          user_id: auth.uid,
          email: `${auth.uid}@example.test`,
          firebase: { sign_in_provider: auth.provider || 'password' },
        },
      }
    : undefined);
  return db;
}

async function allowed(label, operation) {
  try {
    await operation;
  } catch (error) {
    throw new Error(`${label}: deveria ser permitido, mas falhou (${error?.code || error})`, {
      cause: error,
    });
  }
}

async function denied(label, operation) {
  try {
    await operation;
  } catch (error) {
    assert.equal(error?.code, 'permission-denied', `${label}: falhou por motivo inesperado`);
    return;
  }
  throw new Error(`${label}: deveria ser recusado pelas rules`);
}

function operatorRole(ownerId, overrides = {}) {
  return {
    ownerId,
    active: true,
    name: 'Operador',
    permissions: {
      pdv: {
        enabled: true,
        tabs: {
          caixa: false,
          delivery: false,
          novo_pedido: false,
          mesas: false,
          encomendas_pedidos: false,
          ...overrides.tabs,
        },
        actions: {
          caixa: {},
          delivery: {},
          novo_pedido: {},
          mesas: {},
          encomendas_pedidos: {},
          ...overrides.actions,
        },
        global: { botaoRetaguarda: false, toggleDelivery: false, ...overrides.global },
      },
      retaguarda: {},
    },
  };
}

const adminApp = initializeAdminApp({ projectId }, 'rules-seed');
const admin = getAdminFirestore(adminApp);

await Promise.all([
  admin.doc('roles_admin/owner-a').set({ storeName: 'Loja A' }),
  admin.doc('roles_admin/owner-b').set({ storeName: 'Loja B' }),
  admin.doc('roles_operador/op-status').set(operatorRole('owner-a', {
    tabs: { delivery: true },
    actions: { delivery: { mudarStatus: true } },
  })),
  admin.doc('roles_operador/op-finalize').set(operatorRole('owner-a', {
    tabs: { delivery: true },
    actions: { delivery: { finalizarPedido: true, descontoAcrescimo: false } },
  })),
  admin.doc('roles_operador/op-caixa').set(operatorRole('owner-a', {
    tabs: { caixa: true },
    actions: { caixa: { abrirCaixa: true, fecharCaixa: true, cancelarVenda: false } },
  })),
  admin.doc('roles_operador/op-mesa').set(operatorRole('owner-a', {
    tabs: { mesas: true },
    actions: { mesas: { fecharComanda: true, descontoAcrescimo: false, vendaPrazo: true } },
  })),
  admin.doc('roles_operador/op-balcao').set(operatorRole('owner-a', {
    tabs: { novo_pedido: true },
    actions: { novo_pedido: { finalizarVenda: true, descontoAcrescimo: false, vendaPrazo: true } },
  })),
  admin.doc('roles_operador/op-legacy').set({ ownerId: 'owner-a', active: true, name: 'Legado' }),
  admin.doc('roles_operador/op-inactive').set({
    ...operatorRole('owner-a', {
      tabs: { delivery: true },
      actions: { delivery: { mudarStatus: true } },
    }),
    active: false,
  }),
  admin.doc('admin_secrets/owner-a').set({ hash: 'segredo' }),
  admin.doc('campaigns/campaign-a').set({ ownerId: 'owner-a', name: 'Campanha' }),
  admin.doc('broadcast_lists/list-a').set({ ownerId: 'owner-a', name: 'Lista' }),
  admin.doc('scheduled_campaigns/scheduled-a').set({ ownerId: 'owner-a', status: 'scheduled' }),
  admin.doc('categories/category-a').set({ ownerId: 'owner-a', name: 'Categoria' }),
  admin.doc('menuItems/item-a').set({ ownerId: 'owner-a', name: 'Produto', price: 10, stockQuantity: 10 }),
  admin.doc('addons/addon-a').set({ ownerId: 'owner-a', name: 'Adicional', price: 2 }),
  admin.doc('addonCategories/addon-category-a').set({ ownerId: 'owner-a', name: 'Grupo' }),
  admin.doc('promotions/promotion-a').set({ ownerId: 'owner-a', name: 'Oferta' }),
  admin.doc('stock_movements/move-a').set({
    ownerId: 'owner-a', itemId: 'item-a', itemName: 'Produto', type: 'entrada',
    delta: 5, stockBefore: 10, stockAfter: 15, note: 'producao', userName: 'Camila',
  }),
  admin.doc('stock_movements/move-b').set({
    ownerId: 'owner-b', itemId: 'item-b', itemName: 'Outro', type: 'entrada',
    delta: 1, stockBefore: 0, stockAfter: 1, note: '', userName: '',
  }),
  admin.doc('store_profiles/owner-a').set({ general: { name: 'Loja A', disableDelivery: false }, isCaixaAberto: true }),
  admin.doc('store_profiles/owner-b').set({ general: { name: 'Loja B' }, isCaixaAberto: true }),
  admin.doc('orders/order-a').set({
    ownerId: 'owner-a', customerUid: 'anon-a', orderType: 'delivery', status: 'pending',
    items: [], subtotal: 10, totalAmount: 10,
  }),
  admin.doc('orders/order-b').set({
    ownerId: 'owner-b', customerUid: 'anon-b', orderType: 'delivery', status: 'pending',
    items: [], subtotal: 20, totalAmount: 20,
  }),
  admin.doc('orders/order-credit').set({
    ownerId: 'owner-a', customerUid: 'anon-credit', orderType: 'delivery', status: 'pending',
    items: [], subtotal: 20, totalAmount: 20, paymentMethod: 'conta_casa',
  }),
  admin.doc('orders/table-a').set({
    ownerId: 'owner-a', orderType: 'dine_in', status: 'pending',
    items: [], subtotal: 30, totalAmount: 30,
  }),
  admin.doc('encomendas/encomenda-a').set({
    ownerId: 'owner-a', customerUid: 'anon-a', status: 'pendente', total: 50,
  }),
  admin.doc('clientes/client-a').set({ ownerId: 'owner-a', nome: 'Cliente', celular: '11999999999' }),
  admin.doc('clientes/client-a/credit_transactions/credit-a').set({ type: 'debit', amount: 10 }),
  admin.doc('clientes/client-locked').set({
    ownerId: 'owner-a', nome: 'Em unificação', celular: '11988887777',
    creditEnabled: false, mergeInProgress: { targetCustomerId: 'client-a' },
  }),
  admin.doc('clientes/client-archived').set({
    ownerId: 'owner-a', nome: 'Arquivado', celular: '11977776666', archived: true,
  }),
  admin.doc('cash_registers/register-a').set({
    ownerId: 'owner-a', status: 'aberto', sessao: 1, saldoInicial: 0,
  }),
  admin.doc('cash_transactions/sale-a').set({
    ownerId: 'owner-a', caixaId: 'register-a', tipo: 'venda', valor: 10,
  }),
  admin.doc('active_sessions/session-a').set({ storeId: 'owner-a', lastActive: Date.now() }),
  admin.doc('active_sessions/session-b').set({ storeId: 'owner-b', lastActive: Date.now() }),
  // Dados da loja B + operador da loja B, para os testes cross-tenant.
  admin.doc('cash_registers/register-b').set({
    ownerId: 'owner-b', status: 'aberto', sessao: 1, saldoInicial: 0,
  }),
  admin.doc('cash_transactions/sale-b').set({
    ownerId: 'owner-b', caixaId: 'register-b', tipo: 'venda', valor: 20,
  }),
  admin.doc('roles_operador/op-b').set(operatorRole('owner-b', {
    tabs: { caixa: true, delivery: true },
    actions: { caixa: { abrirCaixa: true, fecharCaixa: true }, delivery: { finalizarPedido: true } },
  })),
]);

const owner = client('owner', { uid: 'owner-a' });
const otherOwner = client('other-owner', { uid: 'owner-b' });
const statusOperator = client('operator-status', { uid: 'op-status' });
const finalizeOperator = client('operator-finalize', { uid: 'op-finalize' });
const caixaOperator = client('operator-caixa', { uid: 'op-caixa' });
const mesaOperator = client('operator-mesa', { uid: 'op-mesa' });
const balcaoOperator = client('operator-balcao', { uid: 'op-balcao' });
const legacyOperator = client('operator-legacy', { uid: 'op-legacy' });
const inactiveOperator = client('operator-inactive', { uid: 'op-inactive' });
const anonymous = client('anonymous', { uid: 'anon-a', provider: 'anonymous' });
const stranger = client('stranger', { uid: 'signed-stranger' });
const operatorB = client('operator-b', { uid: 'op-b' });

await allowed('owner lê o próprio segredo', getDoc(doc(owner, 'admin_secrets/owner-a')));
await denied('outro owner não lê segredo alheio', getDoc(doc(otherOwner, 'admin_secrets/owner-a')));
await allowed('owner altera o próprio cadastro', updateDoc(doc(owner, 'menuItems/item-a'), { price: 11 }));
await allowed('owner cria categoria no próprio tenant', setDoc(doc(owner, 'categories/category-temp'), {
  ownerId: 'owner-a', name: 'Temporária',
}));
await allowed('owner atualiza categoria sem trocar tenant', updateDoc(doc(owner, 'categories/category-temp'), {
  name: 'Temporária atualizada',
}));
await allowed('owner exclui categoria do próprio tenant', deleteDoc(doc(owner, 'categories/category-temp')));
await allowed('owner cria campanha no próprio tenant', setDoc(doc(owner, 'campaigns/campaign-temp'), {
  ownerId: 'owner-a', name: 'Temporária',
}));
await allowed('owner exclui campanha do próprio tenant', deleteDoc(doc(owner, 'campaigns/campaign-temp')));

await allowed('operador lê o próprio papel', getDoc(doc(statusOperator, 'roles_operador/op-status')));
await denied('operador não edita o próprio papel', updateDoc(doc(statusOperator, 'roles_operador/op-status'), { active: false }));
await denied('owner não edita operador pelo cliente', updateDoc(doc(owner, 'roles_operador/op-status'), { active: false }));
await denied('operador não se autopromove a master', setDoc(doc(statusOperator, 'roles_admin/op-status'), { storeName: 'Ataque' }));
await denied('operador não lê segredo administrativo', getDoc(doc(statusOperator, 'admin_secrets/owner-a')));
await denied('operador não lê campanhas', getDoc(doc(statusOperator, 'campaigns/campaign-a')));
await denied('operador não altera configuração da loja', updateDoc(doc(statusOperator, 'store_profiles/owner-a'), {
  general: { name: 'Loja adulterada', disableDelivery: false },
}));

await allowed('operador autorizado lê pedidos da própria loja', getDoc(doc(statusOperator, 'orders/order-a')));
await denied('operador não lê pedido de outra loja', getDoc(doc(statusOperator, 'orders/order-b')));
await allowed('mudarStatus permite status operacional', updateDoc(doc(statusOperator, 'orders/order-a'), { status: 'received' }));
await denied('mudarStatus não permite editar itens', updateDoc(doc(statusOperator, 'orders/order-a'), {
  items: [{ id: 'x', quantity: 1 }], subtotal: 1, totalAmount: 1,
}));
await denied('mudarStatus não permite finalizar venda', updateDoc(doc(statusOperator, 'orders/order-a'), {
  status: 'delivered', paymentMethod: 'pix',
}));
await denied('operador sem capacidade comercial não lê base de clientes', getDoc(doc(statusOperator, 'clientes/client-a')));

await denied('base de clientes é owner-only para operador', getDoc(doc(finalizeOperator, 'clientes/client-a')));
await denied('operador não sincroniza cadastro de cliente', updateDoc(doc(finalizeOperator, 'clientes/client-a'), {
  nome: 'Alterado',
}));
await denied('extrato da Conta da Casa é owner-only para operador', getDoc(doc(finalizeOperator, 'clientes/client-a/credit_transactions/credit-a')));
// O caso que derrubou a venda em 01/08/2026: antes de cadastrar, o app pergunta
// "este cliente já existe?" lendo o id determinístico. Documento inexistente
// respondia permission-denied em vez de "não existe", e a venda com cliente novo
// morria inteira. Ler o que não existe não revela dado nenhum.
await allowed('owner consulta cliente que ainda não existe (venda com cliente novo)',
  getDoc(doc(owner, 'clientes/owner-a_11988887777')));
await denied('operador não consulta cliente inexistente',
  getDoc(doc(finalizeOperator, 'clientes/owner-a_11988887777')));
// Anônimo já lê `clientes` por design legado (o my-orders busca a Conta da Casa
// por telefone), então também lê o inexistente — o ramo novo não afrouxa nada
// para ele. Fechar isso é item do plano de permissões, não deste conserto.

await allowed('owner mantém gestão da base de clientes', updateDoc(doc(owner, 'clientes/client-a'), {
  nome: 'Cliente Owner',
}));
await allowed('owner lança no extrato de cliente ativo', setDoc(doc(owner, 'clientes/client-a/credit_transactions/credit-owner'), {
  type: 'credit', amount: 1,
}));
await denied('unificação bloqueia alteração financeira concorrente no cadastro', updateDoc(doc(owner, 'clientes/client-locked'), {
  creditBalance: 10,
}));
await denied('unificação bloqueia novo lançamento concorrente no extrato', setDoc(doc(owner, 'clientes/client-locked/credit_transactions/credit-race'), {
  type: 'debit', amount: 10,
}));
await denied('cadastro arquivado não recebe novo lançamento no extrato', setDoc(doc(owner, 'clientes/client-archived/credit_transactions/credit-late'), {
  type: 'debit', amount: 10,
}));
await allowed('owner conclui o arquivamento da origem travada', updateDoc(doc(owner, 'clientes/client-locked'), {
  archived: true,
  archiveReason: 'merged',
  mergedInto: 'client-a',
  creditEnabled: false,
  mergeInProgress: null,
}));
await allowed('finalizador descobre o caixa mesmo sem exibir a aba Caixa', getDoc(doc(finalizeOperator, 'cash_registers/register-a')));
await allowed('finalizarPedido permite concluir sem ajuste', updateDoc(doc(finalizeOperator, 'orders/order-a'), {
  status: 'delivered', paymentMethod: 'pix',
}));
await admin.doc('orders/order-a').update({ status: 'received' });
await denied('ajuste financeiro exige descontoAcrescimo', updateDoc(doc(finalizeOperator, 'orders/order-a'), {
  status: 'delivered', paymentMethod: 'pix', discount: 2, totalAmount: 8,
}));
await denied('operador nunca atualiza pedido da Conta da Casa', updateDoc(doc(finalizeOperator, 'orders/order-credit'), {
  status: 'delivered',
}));
await denied('operador nunca lança Conta da Casa no caixa', setDoc(doc(finalizeOperator, 'cash_transactions/credit-forbidden'), {
  ownerId: 'owner-a', caixaId: 'register-a', tipo: 'venda', titulo: 'Prazo',
  valor: 20, formaPagamento: 'conta_casa',
}));

await allowed('mesa fecha sem ajuste mesmo gravando zeros explícitos', updateDoc(doc(mesaOperator, 'orders/table-a'), {
  status: 'delivered', paymentMethod: 'pix', subtotal: 30,
  discount: 0, surcharge: 0, totalAmount: 30,
}));
await admin.doc('orders/table-a').update({ status: 'pending' });
await denied('mesa sem descontoAcrescimo não altera valor', updateDoc(doc(mesaOperator, 'orders/table-a'), {
  status: 'delivered', paymentMethod: 'pix', subtotal: 30,
  discount: 2, surcharge: 0, totalAmount: 28,
}));
await denied('mesa não usa Conta da Casa mesmo com flag armazenada', updateDoc(doc(mesaOperator, 'orders/table-a'), {
  status: 'delivered', paymentMethod: 'conta_casa', subtotal: 30,
  discount: 0, surcharge: 0, totalAmount: 30,
}));

await allowed('balcão cria venda comum', setDoc(doc(balcaoOperator, 'orders/balcao-ok'), {
  ownerId: 'owner-a', orderType: 'pickup', source: 'pdv', status: 'delivered',
  items: [], subtotal: 10, discount: 0, surcharge: 0, totalAmount: 10, paymentMethod: 'pix',
}));
await denied('balcão sem descontoAcrescimo não cria venda ajustada', setDoc(doc(balcaoOperator, 'orders/balcao-ajuste'), {
  ownerId: 'owner-a', orderType: 'pickup', source: 'pdv', status: 'delivered',
  items: [], subtotal: 10, discount: 2, surcharge: 0, totalAmount: 8, paymentMethod: 'pix',
}));
await denied('balcão não cria venda a prazo mesmo com flag armazenada', setDoc(doc(balcaoOperator, 'orders/balcao-prazo'), {
  ownerId: 'owner-a', orderType: 'pickup', source: 'pdv', status: 'delivered',
  items: [], subtotal: 10, discount: 0, surcharge: 0, totalAmount: 10, paymentMethod: 'conta_casa',
}));

await allowed('catálogo continua público para cardápio anônimo', getDoc(doc(anonymous, 'menuItems/item-a')));
await allowed('cliente anônimo preserva baixa de estoque', updateDoc(doc(anonymous, 'menuItems/item-a'), { stockQuantity: 9 }));
await denied('cliente anônimo nunca aumenta estoque', updateDoc(doc(anonymous, 'menuItems/item-a'), { stockQuantity: 10 }));
await denied('operador não altera preço/cadastro', updateDoc(doc(statusOperator, 'menuItems/item-a'), { price: 999 }));
await denied('operador legado sem permissions é fail-closed', getDoc(doc(legacyOperator, 'orders/order-a')));
await denied('operador inativo é recusado', getDoc(doc(inactiveOperator, 'orders/order-a')));

await allowed('cliente anônimo cria o próprio pedido', setDoc(doc(anonymous, 'orders/order-anon'), {
  ownerId: 'owner-a', customerUid: 'anon-a', orderType: 'delivery', status: 'pending', items: [], totalAmount: 5,
}));
await allowed('cliente anônimo lê o próprio pedido', getDoc(doc(anonymous, 'orders/order-anon')));
await denied('cliente anônimo não altera pedido', updateDoc(doc(anonymous, 'orders/order-anon'), { status: 'delivered' }));
await allowed('Conta da Casa anônima preserva leitura legada', getDoc(doc(anonymous, 'clientes/client-a')));
await denied('conta password aleatória não enumera clientes', getDoc(doc(stranger, 'clientes/client-a')));

await allowed('operador de caixa lê caixa operacional', getDoc(doc(caixaOperator, 'cash_registers/register-a')));
await denied('operador sem cancelarVenda não cancela lançamento', updateDoc(doc(caixaOperator, 'cash_transactions/sale-a'), {
  canceled: true,
}));

await allowed('sessões são consultáveis com filtro da própria loja', getDocs(query(
  collection(statusOperator, 'active_sessions'),
  where('storeId', '==', 'owner-a'),
)));
await denied('sessões de outra loja são negadas', getDoc(doc(statusOperator, 'active_sessions/session-b')));

// ── Cenários de ataque adicionais: escalação de privilégio e cross-tenant ──
await denied('operador não rouba pedido mudando o ownerId', updateDoc(doc(statusOperator, 'orders/order-a'), { ownerId: 'owner-b' }));
await denied('operador não cria pedido para outra loja', setDoc(doc(balcaoOperator, 'orders/atk-cross-order'), {
  ownerId: 'owner-b', orderType: 'pickup', source: 'pdv', status: 'delivered',
  items: [], subtotal: 10, discount: 0, surcharge: 0, totalAmount: 10, paymentMethod: 'pix',
}));
await denied('operador não lê o papel de outro operador', getDoc(doc(statusOperator, 'roles_operador/op-caixa')));
await denied('operador não se autoconcede permissões no próprio papel', updateDoc(doc(statusOperator, 'roles_operador/op-status'), {
  permissions: { pdv: { enabled: true, tabs: { caixa: true }, actions: { caixa: { fecharCaixa: true } } } },
}));
await denied('operador não atualiza pedido de outra loja', updateDoc(doc(statusOperator, 'orders/order-b'), { status: 'received' }));
await denied('operador de caixa não lê caixa de outra loja', getDoc(doc(caixaOperator, 'cash_registers/register-b')));
await denied('operador de caixa não lê lançamento de outra loja', getDoc(doc(caixaOperator, 'cash_transactions/sale-b')));
await denied('operador não abre caixa em outra loja', setDoc(doc(caixaOperator, 'cash_registers/atk-reg'), {
  ownerId: 'owner-b', status: 'aberto', sessao: 9, saldoInicial: 0,
  dataAbertura: new Date().toISOString(), usuarioAbertura: 'op-caixa',
}));
await denied('operador não lê o admin_secret da própria loja', getDoc(doc(caixaOperator, 'admin_secrets/owner-a')));
await denied('operador B não lê pedidos da loja A', getDoc(doc(operatorB, 'orders/order-a')));
await allowed('operador B lê o caixa da própria loja', getDoc(doc(operatorB, 'cash_registers/register-b')));

// O dono pode administrar os documentos do próprio tenant, mas não pode
// "transferi-los" alterando ownerId: isso injetaria dados nas consultas de
// outra loja. Cobertura completa das coleções mutáveis que carregam ownerId.
const tenantTransferTargets = [
  ['categoria', 'categories/category-a'],
  ['produto', 'menuItems/item-a'],
  ['adicional', 'addons/addon-a'],
  ['grupo de adicionais', 'addonCategories/addon-category-a'],
  ['pedido', 'orders/order-a'],
  ['encomenda', 'encomendas/encomenda-a'],
  ['caixa', 'cash_registers/register-a'],
  ['lançamento de caixa', 'cash_transactions/sale-a'],
  ['cliente', 'clientes/client-a'],
  ['promoção', 'promotions/promotion-a'],
  ['campanha', 'campaigns/campaign-a'],
  ['lista de transmissão', 'broadcast_lists/list-a'],
  ['campanha agendada', 'scheduled_campaigns/scheduled-a'],
];

for (const [kind, path] of tenantTransferTargets) {
  await denied(`owner não transfere ${kind} para outro tenant`, updateDoc(doc(owner, path), {
    ownerId: 'owner-b',
  }));
}

// ── Histórico de estoque (stock_movements) ──
// É um livro de registro: nasce e não muda. E o cliente anônimo do cardápio
// NÃO pode escrever aqui — foi justamente para não abrir essa porta que a venda
// não é gravada nesta coleção (a tela deriva as vendas dos pedidos).
const movimento = (overrides = {}) => ({
  ownerId: 'owner-a', itemId: 'item-a', itemName: 'Produto', type: 'entrada',
  delta: 3, stockBefore: 10, stockAfter: 13, note: '', userName: 'teste',
  ...overrides,
});

await allowed('owner lê a própria movimentação', getDoc(doc(owner, 'stock_movements/move-a')));
await allowed('owner lista as movimentações da própria loja', getDocs(
  query(collection(owner, 'stock_movements'), where('ownerId', '==', 'owner-a')),
));
await denied('owner não lê movimentação de outra loja', getDoc(doc(owner, 'stock_movements/move-b')));
await denied('owner não lista movimentação de outra loja', getDocs(
  query(collection(owner, 'stock_movements'), where('ownerId', '==', 'owner-b')),
));
await allowed('operador ativo lê o histórico da própria loja', getDoc(doc(statusOperator, 'stock_movements/move-a')));
await denied('operador inativo não lê o histórico', getDoc(doc(inactiveOperator, 'stock_movements/move-a')));
await denied('operador de outra loja não lê o histórico', getDoc(doc(operatorB, 'stock_movements/move-a')));
await denied('cliente anônimo não lê o histórico de estoque', getDoc(doc(anonymous, 'stock_movements/move-a')));

await allowed('owner registra movimentação', setDoc(doc(owner, 'stock_movements/mv-owner'), movimento()));
await allowed('owner registra "sem controle" (stockAfter nulo)', setDoc(doc(owner, 'stock_movements/mv-null'), movimento({
  type: 'sem_controle', delta: -10, stockAfter: null,
})));
await allowed('operador com permissão de estoque registra movimentação', setDoc(
  doc(balcaoOperator, 'stock_movements/mv-operador'), movimento({ userName: 'op-balcao' }),
));

await denied('operador sem permissão de estoque não registra', setDoc(
  doc(statusOperator, 'stock_movements/atk-mv-status'), movimento(),
));
await denied('CLIENTE ANÔNIMO não escreve no histórico de estoque', setDoc(
  doc(anonymous, 'stock_movements/atk-mv-anon'), movimento(),
));
await denied('estranho logado não escreve no histórico', setDoc(
  doc(stranger, 'stock_movements/atk-mv-stranger'), movimento(),
));
await denied('owner não registra movimentação para outra loja', setDoc(
  doc(owner, 'stock_movements/atk-mv-cross'), movimento({ ownerId: 'owner-b' }),
));
await denied('não aceita estoque final negativo', setDoc(
  doc(owner, 'stock_movements/atk-mv-neg'), movimento({ stockAfter: -5 }),
));
await denied('não aceita delta que não é número', setDoc(
  doc(owner, 'stock_movements/atk-mv-delta'), movimento({ delta: 'tres' }),
));
await denied('não aceita movimentação sem produto', setDoc(
  doc(owner, 'stock_movements/atk-mv-item'), movimento({ itemId: 42 }),
));

// Imutabilidade: sem isto, um lançamento errado poderia ser reescrito e o
// histórico deixaria de servir para conferir o estoque.
await denied('owner não altera lançamento já gravado', updateDoc(doc(owner, 'stock_movements/move-a'), { delta: 999 }));
await denied('owner não apaga lançamento', deleteDoc(doc(owner, 'stock_movements/move-a')));
await denied('operador não altera lançamento', updateDoc(doc(balcaoOperator, 'stock_movements/move-a'), { delta: 1 }));
await denied('operador não apaga lançamento', deleteDoc(doc(balcaoOperator, 'stock_movements/move-a')));

console.log('Firestore Rules: todos os cenários passaram.');

await Promise.all(apps.map((app) => deleteClientApp(app)));
await deleteAdminApp(adminApp);
