import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const assets = path.join(root, 'android', 'app', 'src', 'main', 'assets');
const drawable = path.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi');

// Keep the native bundle explicit. Download pages, APKs, and web service workers
// must never accidentally become executable native-bridge content.
const webFiles = [
  'index.html', 'style.css', 'app.js', 'core.js', 'icon.svg',
  'icon-192.png', 'icon-512.png', 'manifest.webmanifest',
];

for (const name of webFiles) {
  const source = path.join(dist, name);
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected ordinary web asset: ${name}`);
}

// Resolve and check the generated target before removing old generated assets.
const androidRoot = path.join(root, 'android');
if ((await lstat(androidRoot)).isSymbolicLink()) throw new Error('Refusing a symlinked Android project');
if (path.relative(androidRoot, assets) !== path.join('app', 'src', 'main', 'assets')) {
  throw new Error('Refusing to clean an unexpected Android asset path');
}
let cursor = androidRoot;
for (const part of ['app', 'src', 'main', 'assets']) {
  cursor = path.join(cursor, part);
  try {
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Refusing symlink target: ${cursor}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
for (const name of webFiles) await copyFile(path.join(dist, name), path.join(assets, name));
await mkdir(drawable, { recursive: true });
await copyFile(path.join(dist, 'icon-512.png'), path.join(drawable, 'ic_launcher.png'));
console.log(`Android bundle prepared: ${(await readdir(assets)).length} local assets; no download page or service worker.`);
