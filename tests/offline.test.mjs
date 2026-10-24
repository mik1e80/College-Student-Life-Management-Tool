import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
function worker({ fetchImpl = async () => { throw Error('offline'); }, matches = {}, names = [] } = {}) {
  const listeners = {}, added = [], deleted = [], saved = [];
  const ctx = {
    self: { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => { listeners[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    URL, Response, fetch: fetchImpl,
    caches: { open: async () => ({ addAll: async assets => added.push(...assets), put: async (...args) => saved.push(args) }), keys: async () => names, delete: async name => deleted.push(name), match: async req => matches[typeof req === 'string' ? req : req.url] }
  };
  vm.runInNewContext(source, ctx);
  return { listeners, added, deleted, saved };
}
test('offline installation includes every required local resource and valid PWA icons', async () => {
  const w = worker(); let pending;
  w.listeners.install({ waitUntil: promise => { pending = promise; } }); await pending;
  assert(w.added.includes('./app.js')); assert(w.added.includes('./core.js')); assert(w.added.includes('./index.html'));
  for (const asset of w.added) await access(new URL(asset === './' ? '../dist/index.html' : `../dist/${asset.slice(2)}`, import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../dist/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const data = await readFile(new URL(`../dist/${icon.src.slice(2)}`, import.meta.url));
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(data.readUInt32BE(16), width); assert.equal(data.readUInt32BE(20), height);
  }
});
test('offline navigation falls back to cached app and resources to their own cache entry', async () => {
  const app = new Response('cached app'), script = new Response('cached script');
  const w = worker({ matches: { './index.html': app, 'https://example.test/app.js': script } });
  let response;
  w.listeners.fetch({ request: { method: 'GET', url: 'https://example.test/', mode: 'navigate' }, respondWith: promise => { response = promise; } });
  assert.equal(await (await response).text(), 'cached app');
  w.listeners.fetch({ request: { method: 'GET', url: 'https://example.test/app.js', mode: 'cors' }, respondWith: promise => { response = promise; } });
  assert.equal(await (await response).text(), 'cached script');
});
test('worker never intercepts cross-origin requests or writes', () => {
  const w = worker(); let intercepted = 0;
  for (const request of [{ method: 'POST', url: 'https://example.test/' }, { method: 'GET', url: 'https://other.test/' }]) w.listeners.fetch({ request, respondWith: () => { intercepted++; } });
  assert.equal(intercepted, 0);
});
test('activation preserves unrelated application caches', async () => {
  const w = worker({ names: ['yiri-v0.9.0', 'yiri-v1.1.0', 'another-app-v1'] }); let pending;
  w.listeners.activate({ waitUntil: promise => { pending = promise; } }); await pending;
  assert.deepEqual(w.deleted, ['yiri-v0.9.0']);
});
