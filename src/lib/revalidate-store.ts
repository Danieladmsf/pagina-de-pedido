// Dispara a invalidação do cache das páginas públicas da loja após um save no
// admin (fire-and-forget: falhar aqui não pode quebrar o save — no pior caso a
// página pública atualiza sozinha em até 5 minutos pelo revalidate).
export function revalidateStorePages(storeId?: string) {
  if (!storeId) return;
  try {
    fetch('/api/revalidate-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }),
    }).catch(() => {});
  } catch {}
}
