// Service worker do Pendências: app shell em cache (cache-first) para abrir offline.
// A cada publicação, AUMENTE A VERSÃO abaixo — é isso que faz os aparelhos baixarem a nova.
// Todos os caminhos são relativos à pasta do sw.js (funciona em /pendencias/ e em localhost).

const VERSAO = 'v4';
const CACHE = `pendencias-${VERSAO}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'fonts/manrope-var.woff2',
  'js/app.js',
  'js/db.js',
  'js/parse.js',
  'js/pwa.js',
  'js/store.js',
  'js/sync.js',
  'js/util.js',
  'js/ui/chips.js',
  'js/ui/dom.js',
  'js/ui/drag.js',
  'js/ui/list.js',
  'js/ui/panels.js',
  'js/ui/row.js',
  'js/ui/search.js',
  'js/ui/toast.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' ignora o cache HTTP (o GitHub Pages guarda arquivos por ~10 min): a versão
  // nova do cache nunca é montada com arquivos velhos. Não chama skipWaiting: o app pergunta antes.
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n.startsWith('pendencias-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Só GET da própria origem. O Apps Script (script.google.com, POST) passa direto pela rede.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Abrir o app (inclusive em modo avião): sempre o index.html do cache.
    event.respondWith(caches.match('index.html', { cacheName: CACHE }).then(r => r || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(r => r || fetch(req)),
  );
});

self.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.tipo === 'versao') event.ports[0]?.postMessage(VERSAO);
  if (msg.tipo === 'atualizar') self.skipWaiting();
});
