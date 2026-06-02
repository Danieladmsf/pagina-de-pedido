'use client';

import { useEffect, useState } from 'react';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, User, getAuth, onAuthStateChanged } from 'firebase/auth';
import { Firestore, getFirestore, initializeFirestore } from 'firebase/firestore';
import { firebaseConfig } from '@/firebase/config';

const CUSTOMER_APP_NAME = 'customer';

interface CustomerFirebaseServices {
  firebaseApp: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
}

export interface CustomerFirebaseState {
  firebaseApp: FirebaseApp | null;
  auth: Auth | null;
  firestore: Firestore | null;
  user: User | null;
  isUserLoading: boolean;
}

function getCustomerFirebaseServices(): CustomerFirebaseServices {
  const existing = getApps().find((app) => app.name === CUSTOMER_APP_NAME);
  const firebaseApp = existing || initializeApp(firebaseConfig, CUSTOMER_APP_NAME);

  // Auto-detecta bloqueio do transporte de streaming (antivírus/firewall/proxy)
  // e troca para long-polling, mantendo o tempo real funcionando. Ver index.ts.
  let firestore: Firestore;
  try {
    firestore = initializeFirestore(firebaseApp, { experimentalAutoDetectLongPolling: true });
  } catch {
    firestore = getFirestore(firebaseApp);
  }

  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore,
  };
}

export function useCustomerFirebase(): CustomerFirebaseState {
  const [services, setServices] = useState<CustomerFirebaseServices | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);

  useEffect(() => {
    const nextServices = getCustomerFirebaseServices();
    setServices(nextServices);

    return onAuthStateChanged(
      nextServices.auth,
      (nextUser) => {
        setUser(nextUser);
        setIsUserLoading(false);
      },
      (error) => {
        console.error('[customer-auth] onAuthStateChanged error:', error);
        setUser(null);
        setIsUserLoading(false);
      },
    );
  }, []);

  return {
    firebaseApp: services?.firebaseApp || null,
    auth: services?.auth || null,
    firestore: services?.firestore || null,
    user,
    isUserLoading,
  };
}
