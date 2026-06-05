'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { Auth, getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, initializeFirestore, Firestore } from 'firebase/firestore'

// Fixa a persistência da sessão em armazenamento LOCAL (IndexedDB, com fallback
// para localStorage). Sem isto, o padrão pode cair para sessão/memória em alguns
// contextos (PWA/service worker), fazendo o usuário deslogar a cada reload/deploy.
function getAuthWithLocalPersistence(app: FirebaseApp): Auth {
  try {
    return initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  } catch {
    // initializeAuth só pode ser chamado uma vez por app; se já inicializado,
    // retorna a instância existente (que já está com a persistência definida).
    return getAuth(app);
  }
}

// Em redes com antivírus/firewall/proxy que bloqueiam o transporte de streaming
// (WebChannel) do Firestore, o onSnapshot pode parar de receber updates. O
// auto-detect usa streaming normal (eficiente) em redes boas e só troca para
// long-polling se detectar o bloqueio — rede de segurança sem custo no caso comum.
function getFirestoreWithLongPolling(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    // initializeFirestore só pode ser chamado uma vez por app; se já inicializado,
    // retorna a instância existente.
    return getFirestore(app);
  }
}

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  if (!getApps().length) {
    // Important! initializeApp() is called without any arguments because Firebase App Hosting
    // integrates with the initializeApp() function to provide the environment variables needed to
    // populate the FirebaseOptions in production. It is critical that we attempt to call initializeApp()
    // without arguments.
    let firebaseApp;
    try {
      // Attempt to initialize via Firebase App Hosting environment variables
      firebaseApp = initializeApp();
    } catch (e) {
      // Only warn in production because it's normal to use the firebaseConfig to initialize
      // during development
      if (process.env.NODE_ENV === "production") {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', e);
      }
      firebaseApp = initializeApp(firebaseConfig);
    }

    return getSdks(firebaseApp);
  }

  // If already initialized, return the SDKs with the already initialized App
  return getSdks(getApp());
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    auth: getAuthWithLocalPersistence(firebaseApp),
    firestore: getFirestoreWithLongPolling(firebaseApp)
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
