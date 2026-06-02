self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Network-first apenas para navegações (o HTML do app). Assim, toda vez que o
  // app é reaberto ou recarregado ele busca a versão mais nova do servidor em vez
  // de servir um HTML antigo do cache do navegador — evita ficar preso em uma
  // versão velha. Demais requisições (chunks JS com hash, imagens) seguem o
  // comportamento padrão do navegador.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
