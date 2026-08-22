/**
 * Validação das permissões de funcionário contra o Firestore DE VERDADE.
 *
 * Existe porque o emulador não sobe nesta máquina (o node não conecta em
 * loopback — ver a memória do projeto). Em vez de confiar só na leitura das
 * regras, aqui um funcionário de mentira é criado na LOJA DE TESTE, cada
 * cenário é executado pela REST do Firestore com o token dele, e no fim tudo é
 * apagado. O que o servidor responde é o veredito: 200/404 = permitido,
 * 403 = negado.
 *
 * Só mexe na loja de teste, e só em documentos que ele mesmo cria.
 *
 * Uso:
 *   node scripts/validar-permissoes-loja-teste.mjs
 *
 * Precisa da chave de service account (`*firebase-adminsdk*.json` na raiz).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const LOJA_TESTE = 'fjKdTyjDJigZAE7johkJaKS5Kh43';
const PROJECT_ID = 'studio-2243391254-75492';
const API_KEY = 'AIzaSyAVes6z9Na9FpGkxtq-1HyD9ufrkumHYtA';
const LOGIN = 'validacao.permissoes@usuarios.polarispdv.app';
const SENHA = 'validacao-' + Math.random().toString(36).slice(2, 10);
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const chave = readdirSync(process.cwd()).find(
  (nome) => nome.includes('firebase-adminsdk') && nome.endsWith('.json'),
);
if (!chave) {
  console.error('Chave de service account não encontrada na raiz do projeto.');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(chave, 'utf8'))) });
const db = getFirestore();
const auth = getAuth();

const resultados = [];
let idToken = '';

/** Permissões do funcionário de mentira, trocadas entre um cenário e outro. */
async function definirPermissoes(retaguarda, pdv = {}) {
  await db.doc(`roles_operador/${uidOperador}`).set({
    ownerId: LOJA_TESTE,
    active: true,
    name: 'Validação de permissões',
    login: 'validacao.permissoes',
    email: LOGIN,
    permissions: { pdv: { enabled: true, tabs: {}, actions: {}, global: {}, ...pdv }, retaguarda },
    updatedAt: FieldValue.serverTimestamp(),
  });
  // As regras leem o documento do funcionario a cada request, mas a permissao
  // recem-gravada leva um instante para valer: sem esta pausa, o PRIMEIRO
  // request depois da troca ainda e julgado pelo perfil antigo. Isso vale para
  // a loja tambem - mudou a permissao, o funcionario sente em segundos, nao no
  // mesmo clique.
  await new Promise((resolver) => setTimeout(resolver, 2000));
}

async function entrar() {
  const resposta = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOGIN, password: SENHA, returnSecureToken: true }),
    },
  );
  const dados = await resposta.json();
  if (!dados.idToken) throw new Error('Não consegui entrar como o funcionário: ' + JSON.stringify(dados));
  return dados.idToken;
}

async function chamar(caminho, init = {}) {
  const resposta = await fetch(BASE + caminho, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return resposta.status;
}

/** Uma consulta de lista (é o que a tela faz: filtrar pela loja). */
function consulta(colecao, campo, valor) {
  return {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: colecao }],
        where: {
          fieldFilter: {
            field: { fieldPath: campo },
            op: 'EQUAL',
            value: { stringValue: valor },
          },
        },
        limit: 1,
      },
    }),
  };
}

async function cenario(descricao, esperado, executar) {
  const status = await executar();
  const permitido = status >= 200 && status < 300;
  const negado = status === 403;
  const passou = esperado === 'permitido' ? permitido : negado;
  resultados.push({ descricao, esperado, status, passou });
  const marca = passou ? 'OK  ' : 'FALHOU';
  console.log(`${marca} ${descricao} (esperado: ${esperado}, HTTP ${status})`);
}

let uidOperador = '';
let itemTemporario = '';

try {
  // ── funcionário de mentira ──
  try {
    const existente = await auth.getUserByEmail(LOGIN);
    await auth.deleteUser(existente.uid);
  } catch { /* não existia, ótimo */ }

  const usuario = await auth.createUser({ email: LOGIN, password: SENHA, displayName: 'Validação' });
  uidOperador = usuario.uid;
  console.log('Funcionário de teste criado na loja de teste:', uidOperador, '\n');

  // Produto temporário da loja de teste, para os cenários de escrita.
  const item = await db.collection('menuItems').add({
    ownerId: LOJA_TESTE,
    name: 'PRODUTO DE VALIDACAO (apagar)',
    price: 1,
    isAvailable: false,
  });
  itemTemporario = item.id;

  // ── 1. Sem módulo nenhum: tudo fechado ──
  await definirPermissoes({});
  idToken = await entrar();
  console.log('— funcionário sem nenhum módulo da Retaguarda —');
  await cenario('base de clientes', 'negado', () => chamar(':runQuery', consulta('clientes', 'ownerId', LOJA_TESTE)));
  await cenario('visitantes do cardápio', 'negado', () => chamar(':runQuery', consulta('store_visitors', 'storeId', LOJA_TESTE)));
  await cenario('histórico de pedidos', 'negado', () => chamar(':runQuery', consulta('orders', 'ownerId', LOJA_TESTE)));
  await cenario('mudar preço de produto', 'negado', () => chamar(
    `/menuItems/${itemTemporario}?updateMask.fieldPaths=price`,
    { method: 'PATCH', body: JSON.stringify({ fields: { price: { doubleValue: 2 } } }) },
  ));

  // ── 2. Visitantes ligado ──
  await definirPermissoes({ visitantes: { ver: true, editar: false } });
  console.log('\n— com o módulo Visitantes —');
  await cenario('visitantes do cardápio', 'permitido', () => chamar(':runQuery', consulta('store_visitors', 'storeId', LOJA_TESTE)));
  await cenario('visitas do cardápio', 'permitido', () => chamar(':runQuery', consulta('store_visits', 'storeId', LOJA_TESTE)));
  await cenario('base de clientes continua fechada', 'negado', () => chamar(':runQuery', consulta('clientes', 'ownerId', LOJA_TESTE)));

  // ── 3. Números do negócio ──
  await definirPermissoes({ dashboard: { ver: true, editar: false } });
  console.log('\n— com o módulo Dashboard —');
  await cenario('histórico de pedidos', 'permitido', () => chamar(':runQuery', consulta('orders', 'ownerId', LOJA_TESTE)));
  await cenario('histórico de caixa', 'permitido', () => chamar(':runQuery', consulta('cash_transactions', 'ownerId', LOJA_TESTE)));

  // ── 4. Cardápio: ver x alterar ──
  await definirPermissoes({ produtos: { ver: true, editar: false } });
  console.log('\n— com Produtos só para VER —');
  await cenario('mudar preço de produto', 'negado', () => chamar(
    `/menuItems/${itemTemporario}?updateMask.fieldPaths=price`,
    { method: 'PATCH', body: JSON.stringify({ fields: { price: { doubleValue: 3 } } }) },
  ));

  await definirPermissoes({ produtos: { ver: true, editar: true } });
  console.log('\n— com Produtos para ALTERAR —');
  await cenario('mudar preço de produto', 'permitido', () => chamar(
    `/menuItems/${itemTemporario}?updateMask.fieldPaths=price`,
    { method: 'PATCH', body: JSON.stringify({ fields: { price: { doubleValue: 4 } } }) },
  ));
  await cenario('mudar o produto de loja', 'negado', () => chamar(
    `/menuItems/${itemTemporario}?updateMask.fieldPaths=ownerId`,
    { method: 'PATCH', body: JSON.stringify({ fields: { ownerId: { stringValue: 'outra-loja' } } }) },
  ));

  // ── 5. Clientes ──
  await definirPermissoes({ clientes: { ver: true, editar: false } });
  console.log('\n— com Clientes só para VER —');
  await cenario('base de clientes', 'permitido', () => chamar(':runQuery', consulta('clientes', 'ownerId', LOJA_TESTE)));

  // ── 6. Perfil da loja ──
  await definirPermissoes({});
  console.log('\n— sem o módulo Perfil —');
  await cenario('mexer na configuração da loja', 'negado', () => chamar(
    `/store_profiles/${LOJA_TESTE}?updateMask.fieldPaths=validacaoTemporaria`,
    { method: 'PATCH', body: JSON.stringify({ fields: { validacaoTemporaria: { booleanValue: true } } }) },
  ));

  // ── 7. Cross-tenant: o funcionário desta loja não alcança outra ──
  await definirPermissoes({ clientes: { ver: true, editar: true }, produtos: { ver: true, editar: true } });
  console.log('\n— tentando alcançar outra loja —');
  await cenario('clientes de outra loja', 'negado', () => chamar(':runQuery', consulta('clientes', 'ownerId', '5Hg3VG3qYAZNsobVnReK9aPntjx1')));

  // ── 8. Funcionário desativado perde tudo na hora ──
  await db.doc(`roles_operador/${uidOperador}`).update({ active: false });
  console.log('\n— funcionário desativado —');
  await cenario('base de clientes', 'negado', () => chamar(':runQuery', consulta('clientes', 'ownerId', LOJA_TESTE)));
  await cenario('mudar preço de produto', 'negado', () => chamar(
    `/menuItems/${itemTemporario}?updateMask.fieldPaths=price`,
    { method: 'PATCH', body: JSON.stringify({ fields: { price: { doubleValue: 9 } } }) },
  ));
} finally {
  // ── limpeza: nada de teste fica na loja ──
  if (itemTemporario) await db.doc(`menuItems/${itemTemporario}`).delete().catch(() => {});
  if (uidOperador) {
    await db.doc(`roles_operador/${uidOperador}`).delete().catch(() => {});
    await auth.deleteUser(uidOperador).catch(() => {});
  }
  console.log('\nLimpeza concluída (funcionário e produto de teste apagados).');

  const falhas = resultados.filter((r) => !r.passou);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} cenários como esperado.`);
  if (falhas.length > 0) {
    console.log('\nFalhas:');
    for (const f of falhas) console.log(`  - ${f.descricao}: esperado ${f.esperado}, HTTP ${f.status}`);
    process.exitCode = 1;
  }
}
