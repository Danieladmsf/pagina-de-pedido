'use client';

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getApp, type FirebaseApp } from 'firebase/app';

/**
 * Sobe um arquivo para o Firebase Storage de um app específico e retorna a URL.
 * Usado pelo admin (app default) e pelas páginas públicas (app "customer",
 * auth anônimo — ver useCustomerFirebase), que são apps Firebase separados.
 */
export async function uploadFileToApp(app: FirebaseApp, file: File, folder: string): Promise<string> {
  // Sanitizar nome do arquivo
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const uniqueName = `${Date.now()}_${safeName}`;

  const storageRef = ref(getStorage(app), `${folder}/${uniqueName}`);
  const snapshot = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

/**
 * Faz upload de uma imagem para o Firebase Storage e retorna a URL pública.
 * (admin: usa o app default, pasta products/ — comportamento original)
 */
export async function uploadImage(file: File): Promise<string> {
  return uploadFileToApp(getApp(), file, 'products');
}
