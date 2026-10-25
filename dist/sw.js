const CACHE = 'yiri-v1.4.0-r2';
const ASSETS = ['./', './index.html', './style.css', './app.js', './core.js', './time-core.js', './ledger-store.js', './icon.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('yiri-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic') { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('./index.html') : Response.error())));
});
