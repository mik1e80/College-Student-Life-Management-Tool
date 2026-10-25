import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This validates the committed release manifest. CI separately verifies the
// actual APK signature with the Android SDK's apksigner before publishing.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const filename = `yiri-${packageMetadata.version}.apk`;
const apk = resolve(root, 'download-site', filename);
const manifest = JSON.parse(readFileSync(resolve(root, 'download-site/release.json'), 'utf8'));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

requireValue(manifest.version === packageMetadata.version, 'Release version must match package.json');
requireValue(manifest.filename === filename, `Release filename must be ${filename}`);
requireValue(manifest.verified === true, 'Release manifest must record verified: true');
requireValue(manifest.v2 === true, 'Release manifest must record v2: true');
requireValue(Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0, 'Release bytes must be a positive integer');
requireValue(typeof manifest.sha256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.sha256), 'Release SHA-256 must be 64 lowercase hexadecimal characters');

const info = statSync(apk);
requireValue(info.isFile(), 'Release APK must be a regular file');
requireValue(info.size === manifest.bytes, 'Release APK size does not match release.json');
const sha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
requireValue(sha256 === manifest.sha256, 'Release APK SHA-256 does not match release.json');

const sidecar = readFileSync(`${apk}.sha256`, 'utf8').trim();
requireValue(sidecar === `${sha256}  ${filename}`, 'APK checksum sidecar does not match the verified APK');

console.log(`Release metadata verified: ${filename}, ${info.size} bytes, SHA-256 ${sha256}`);
