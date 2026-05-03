'use client';

/**
 * Faz upload de uma imagem para o Vercel Blob e retorna a URL pública.
 */
export async function uploadImage(file: File): Promise<string> {
  // Sanitizar nome do arquivo
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');

  // Faz upload para a rota da API do Vercel Blob
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
