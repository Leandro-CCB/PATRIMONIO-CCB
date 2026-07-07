// ═══════════════════════════════════════════════
// Service Worker — PatrimônioIgreja PWA
// ═══════════════════════════════════════════════
const CACHE_NAME = 'patrimonio-igreja-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

// Instala e faz cache do "app shell" (arquivos essenciais para abrir o app offline)
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

// Remove caches antigos ao ativar uma nova versão
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia de rede:
// - Chamadas para a API do Supabase: sempre vão para a rede (dados precisam estar atualizados)
// - Demais arquivos (HTML/CSS/JS/ícones/CDNs): cache-first, com atualização em segundo plano
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // Nunca cacheia chamadas à API/Realtime do Supabase
  if (url.hostname.endsWith('supabase.co')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
