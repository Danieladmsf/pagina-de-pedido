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
  console.log('[FOTO-DEBUG] upload: iniciando', { name: file.name, size: file.size, type: file.type, uniqueName });

  const storage = getStorage(getApp());
  const storageRef = ref(storage, `products/${uniqueName}`);
  const snapshot = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snapshot.ref);
  console.log('[FOTO-DEBUG] upload: concluido, URL gerada =', url);

  return url;
}
