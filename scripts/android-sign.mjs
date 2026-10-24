import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [inputArg, outputArg = 'download-site/yiri-1.1.0.apk'] = process.argv.slice(2);
if (!inputArg) throw Error('Usage: node scripts/android-sign.mjs <unsigned.apk> [signed.apk]');
const input = resolve(root, inputArg), output = resolve(root, outputArg);
const local = resolve(root, '.local/signing'), classes = resolve(root, '.local/classes');
const configPath = resolve(local, 'signing.json'), keystore = resolve(local, 'yiri-release.p12');
const lib = resolve(root, '.local/tools/apksig-8.7.3.jar');
if (!existsSync(lib)) throw Error('Download Google Maven com.android.tools.build:apksig:8.7.3 into .local/tools first');
if (!existsSync(input)) throw Error('Unsigned APK not found');
if (input === output) throw Error('Use separate input and output APK paths');
mkdirSync(local, { recursive: true }); mkdirSync(classes, { recursive: true }); mkdirSync(dirname(output), { recursive: true });
let config;
if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'));
else {
  if (existsSync(keystore)) throw Error('Existing signing key has no config; restore its password, do not replace the key');
  config = { alias: 'yiri-release', password: randomBytes(32).toString('base64url') };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
}
const childEnv = { ...process.env, YIRI_KEYSTORE_PASSWORD: config.password };
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, env: childEnv, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed with status ${result.status}${capture ? ': ' + result.stderr : ''}`);
  return result.stdout;
}
if (!existsSync(keystore)) run('keytool', ['-genkeypair', '-storetype', 'PKCS12', '-keystore', keystore, '-storepass:env', 'YIRI_KEYSTORE_PASSWORD', '-keypass:env', 'YIRI_KEYSTORE_PASSWORD', '-alias', config.alias, '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Yiri Youshu, OU=Application, O=Campus Life, C=CN', '-noprompt']);
run('javac', ['-encoding', 'UTF-8', '-cp', lib, '-d', classes, resolve(root, 'scripts/ApkReleaseSigner.java')]);
const verification = JSON.parse(run('java', ['-cp', `${classes}${delimiter}${lib}`, 'ApkReleaseSigner', input, output, keystore, config.alias], true).trim());
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
const metadata = { version: '1.1.0', versionCode: 2, packageId: 'cn.yiriyoushu.campuslife', minAndroid: '8.0', filename: 'yiri-1.1.0.apk', bytes: statSync(output).size, sha256, ...verification };
writeFileSync(resolve(dirname(output), 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(output + '.sha256', `${sha256}  yiri-1.1.0.apk\n`);
console.log(JSON.stringify({ output, ...metadata }));
