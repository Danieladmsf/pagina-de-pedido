import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function serviceAccountFromEnvironment() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) return cert(JSON.parse(inline));

  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (configuredPath) {
    const keyPath = isAbsolute(configuredPath) ? configuredPath : resolve(process.cwd(), configuredPath);
    if (!existsSync(keyPath)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS aponta para arquivo inexistente: ${keyPath}`);
    }
    return cert(JSON.parse(readFileSync(keyPath, 'utf8')));
  }

  const localKey = readdirSync(PROJECT_ROOT).find((name) => /firebase-adminsdk.*\.json$/i.test(name));
  if (localKey) return cert(JSON.parse(readFileSync(join(PROJECT_ROOT, localKey), 'utf8')));

  // Funciona em ambientes Google com credencial padrao da maquina/servico.
  return applicationDefault();
}

/** Inicializa uma unica instancia do Admin SDK para scripts de manutencao. */
export function adminFirestore() {
  if (!getApps().length) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-cardapio-integridade' });
    } else {
      initializeApp({ credential: serviceAccountFromEnvironment() });
    }
  }
  return getFirestore();
}

export function projectRoot() {
  return PROJECT_ROOT;
}

export function snapshotRecords(snapshot) {
  return snapshot.docs.map((document) => ({
    id: document.id,
    path: document.ref.path,
    parentId: document.ref.parent.parent?.id || null,
    data: document.data(),
    updateTime: document.updateTime,
  }));
}

/** Carrega uma fotografia consistente o bastante para auditoria somente leitura. */
export async function loadIntegrityDataset(db) {
  const [
    profiles,
    menuItems,
    promotions,
    orders,
    encomendas,
    clientes,
    cashRegisters,
    cashTransactions,
    creditTransactions,
  ] = await Promise.all([
    db.collection('store_profiles').get(),
    db.collection('menuItems').get(),
    db.collection('promotions').get(),
    db.collection('orders').get(),
    db.collection('encomendas').get(),
    db.collection('clientes').get(),
    db.collection('cash_registers').get(),
    db.collection('cash_transactions').get(),
    db.collectionGroup('credit_transactions').get(),
  ]);

  return {
    profiles: snapshotRecords(profiles),
    menuItems: snapshotRecords(menuItems),
    promotions: snapshotRecords(promotions),
    orders: snapshotRecords(orders),
    encomendas: snapshotRecords(encomendas),
    clientes: snapshotRecords(clientes),
    cashRegisters: snapshotRecords(cashRegisters),
    cashTransactions: snapshotRecords(cashTransactions),
    creditTransactions: snapshotRecords(creditTransactions),
  };
}

