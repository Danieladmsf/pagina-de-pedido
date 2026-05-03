'use client';

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getApp } from 'firebase/app';

/**
 * Faz upload de uma imagem para o Firebase Storage e retorna a URL pública.
 */
export async function uploadImage(file: File): Promise<string> {
  // Sanitizar nome do arquivo
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const uniqueName = `${Date.now()}_${safeName}`;

  const storage = getStorage(getApp());
  const storageRef = ref(storage, `products/${uniqueName}`);
  const snapshot = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snapshot.ref);
  
  return url;
}
