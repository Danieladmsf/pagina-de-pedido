'use client';

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getApp } from 'firebase/app';

/**
 * Faz upload de uma imagem para o Firebase Storage e retorna a URL pública.
 * Tenta primeiro o Firebase Storage; se não estiver disponível, tenta a API local (Vercel Blob).
 */
export async function uploadImage(file: File): Promise<string> {
  // Sanitizar nome do arquivo
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const uniqueName = `${Date.now()}_${safeName}`;

  // Tentar Firebase Storage primeiro
  try {
    const storage = getStorage(getApp());
    const storageRef = ref(storage, `products/${uniqueName}`);
    const snapshot = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);
    return url;
  } catch (firebaseError: any) {
    console.warn('[upload] Firebase Storage falhou, tentando Vercel Blob...', firebaseError?.message);
  }

  // Fallback: Vercel Blob via API route
  const response = await fetch(`/api/upload?filename=${encodeURIComponent(safeName)}`, {
    method: 'POST',
    body: file,
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMsg = 'Falha no upload da imagem';
    try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
    throw new Error(errorMsg);
  }

  const blob = await response.json();
  if (!blob.url) throw new Error('Upload não retornou URL válida');
  return blob.url;
}
