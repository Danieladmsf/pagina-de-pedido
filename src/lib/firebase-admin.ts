import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '@/firebase/config';

export function getOptionalAdminDb() {
  try {
    if (!getApps().length) {
      const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_ADMIN_CREDENTIALS;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;

      if (rawServiceAccount) {
        initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
      } else if (clientEmail && privateKey) {
        initializeApp({
          credential: cert({ projectId, clientEmail, privateKey }),
        });
      } else {
        return null;
      }
    }

    return getFirestore();
  } catch (error) {
    console.warn('[firebase-admin] Admin SDK indisponivel:', error);
    return null;
  }
}
