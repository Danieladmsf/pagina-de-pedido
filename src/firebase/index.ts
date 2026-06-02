'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, Firestore } from 'firebase/firestore'

// Em redes com antivírus/firewall/proxy que bloqueiam o transporte de streaming
// (WebChannel) do Firestore, o onSnapshot em tempo real para de receber updates —
// o app funciona em uma máquina e "não atualiza" em outra.
// Forçamos long-polling (em vez de só auto-detectar) porque algumas redes engolem
// a conexão de streaming silenciosamente, sem disparar a detecção automática. O
// long-polling é compatível com qualquer firewall/proxy ao custo de um pouco mais
// de requisições — troca aceitável para um PDV que precisa de tempo real confiável.
function getFirestoreWithLongPolling(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, { experimentalForceLongPolling: true });
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
    auth: getAuth(firebaseApp),
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
