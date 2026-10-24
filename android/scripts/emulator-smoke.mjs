import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';

const app = 'cn.yiriyoushu.campuslife';
const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30_000 }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
let client;
async function screenshot(name) {
  await mkdir('android/screenshots', {recursive:true});
  await writeFile(`android/screenshots/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p']));
}

async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const pid = adb('shell', 'pidof', app).split(/\s+/)[0];
      if (!pid) throw new Error('Application has no process yet');
      adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);
      const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
      const page = targets.find(target => target.type === 'page' && target.url.includes('appassets.androidplatform.net'));
      if (!page) throw new Error('Bundled WebView is not ready');
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
      let sequence = 0;
      const pending = new Map();
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      });
      return {
        close: () => socket.close(),
        evaluate: async expression => {
          const id = ++sequence;
          const response = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP evaluation timed out')); }, 15_000);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
              expression, returnByValue: true, awaitPromise: true,
            } }));
          });
          if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
          return response.result.value;
        },
      };
    } catch (error) {
      if (attempt === 39) throw error;
      await pause(500);
    }
  }
}

async function until(expression, message) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await client.evaluate(expression)) { report.push(message); return; }
    await pause(250);
  }
  throw new Error(`Timed out: ${message}`);
}

try {
  adb('install', '-r', apk);
  adb('shell', 'pm', 'clear', app);
  adb('shell', 'svc', 'wifi', 'disable');
  adb('shell', 'svc', 'data', 'disable');
  adb('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
  client = await connect();
  await until("!!document.querySelector('[data-category]')", 'Bundled ledger loads while Wi-Fi and mobile data are disabled');
  assert.equal(await client.evaluate('location.href'), 'https://appassets.androidplatform.net/assets/index.html');
  assert.equal(await client.evaluate('AndroidApp.isNative()'), true);
  assert.equal(await client.evaluate("typeof window.YiriNativeBack === 'function'"), true);
  await screenshot('01-home');
  await client.evaluate("document.querySelector('[data-category]').click(); document.querySelector('[data-item]').click(); true");
  await until("!!document.querySelector('#actual-input')", 'Expense editor opens through category and item navigation');
  await screenshot('02-detail');
  await client.evaluate("(() => { const input = document.querySelector('#actual-input'); input.value = '8.50'; input.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('#actual-form').requestSubmit(); return true; })()");
  await until("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).records).some(record => record.cents === 850)", 'A real expense entered through the UI is saved');
  adb('shell', 'input', 'keyevent', '4');
  await until("!document.querySelector('#actual-form') && !!document.querySelector('[data-item]')", 'System Back returns from detail to the category');
  await screenshot('03-category');

  client.close();
  adb('shell', 'am', 'force-stop', app);
  adb('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
  client = await connect();
  await until("!!document.querySelector('[data-category]')", 'Offline app opens again after force-stop');
  assert.equal(await client.evaluate("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).records).some(record => record.cents === 850)"), true);
  report.push('Saved expense survives force-stop and a fresh WebView');
  assert.equal(await client.evaluate("navigator.serviceWorker.getRegistrations().then(items => items.length)"), 0);
  report.push('APK does not register a service worker');

  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"plan\"]').click(); true");
  await until("!!document.querySelector('#plan-form')", 'Monthly plan screen opens');
  await client.evaluate("(() => { const values = ['8','15','12']; document.querySelectorAll('[data-plan-item]').forEach((input,i) => { input.value=values[i]; input.dispatchEvent(new Event('input',{bubbles:true})); }); document.querySelector('#plan-form').requestSubmit(); return true; })()");
  await until("Object.keys(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).plans).length === 3", 'Monthly budget is saved through the UI');
  await screenshot('04-month-plan');
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"report\"]').click(); true");
  await until("!!document.querySelector('.report-section')", 'Spending report opens');
  await screenshot('05-report');
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"settings\"]').click(); true");
  await until("document.body.innerText.includes('安卓版已安装')", 'Native app replaces browser-install instructions');
  await screenshot('06-settings');

  await client.evaluate("window.__exportResult = null; const original = window.YiriNativeExportResult; window.YiriNativeExportResult = (ok, message) => { window.__exportResult = {ok, message}; original?.(ok, message); }; AndroidApp.saveText('oversized.json', 'application/json', 'x'.repeat(1048577)); true");
  await until("window.__exportResult?.ok === false && window.__exportResult.message.includes('1 MiB')", 'Native export rejects content larger than 1 MiB');
  await writeFile('android/smoke-screenshot.png', execFileSync('adb', ['exec-out', 'screencap', '-p']));
  await writeFile('android/smoke-report.json', JSON.stringify({ passed: true, checks: report }, null, 2));
  console.log(report.map(item => `PASS: ${item}`).join('\n'));
} catch (error) {
  await writeFile('android/smoke-report.json', JSON.stringify({ passed: false, checks: report, error: error.message }, null, 2));
  throw error;
} finally {
  client?.close();
  try { adb('forward', '--remove', 'tcp:9222'); } catch { /* Device may already be gone. */ }
}
