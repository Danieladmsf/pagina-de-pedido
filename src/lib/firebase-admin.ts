import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '@/firebase/config';

function getOptionalAdminApp(): App | null {
  try {
    const existingApp = getApps()[0];
    if (existingApp) return existingApp;

    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_ADMIN_CREDENTIALS;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;

    if (rawServiceAccount) {
      return initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
    }

    if (clientEmail && privateKey) {
      return initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
    }

    return null;
  } catch (error) {
    console.warn('[firebase-admin] Admin SDK indisponivel:', error);
    return null;
  }
}

export function getOptionalAdminDb() {
  const app = getOptionalAdminApp();
  return app ? getFirestore(app) : null;
}

/** Firebase Auth privilegiado para rotas exclusivamente servidor. */
export function getOptionalAdminAuth() {
  const app = getOptionalAdminApp();
  return app ? getAuth(app) : null;
}
