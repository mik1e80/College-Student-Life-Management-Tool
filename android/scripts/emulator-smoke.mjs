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

  // Mimic an installed 1.1.0 ledger before restarting the upgraded app.
  await client.evaluate("(() => { const old = JSON.parse(localStorage.getItem('yiri-campus-life-v1')); old.schema=1; delete old.cadences; delete old.periodPlans; delete old.periodRecords; localStorage.setItem('yiri-campus-life-v1',JSON.stringify(old)); return true; })()");

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
  await client.evaluate("(() => { const values = ['8','30','120'], units=['day','month','year']; document.querySelectorAll('[data-plan-item]').forEach((input,i) => { input.value=values[i]; input.dispatchEvent(new Event('input',{bubbles:true})); const select = document.querySelector('[data-plan-unit=\"'+input.dataset.planItem+'\"]'); select.value=units[i]; select.dispatchEvent(new Event('change',{bubbles:true})); }); document.querySelector('#plan-form').requestSubmit(); return true; })()");
  await until("(() => { const s=JSON.parse(localStorage.getItem('yiri-campus-life-v1')); return s.schema===2 && Object.keys(s.plans).length===1 && Object.keys(s.periodPlans).length===2; })()", 'Daily, monthly and yearly budgets save with automatic old-ledger migration');
  assert.equal(await client.evaluate("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).records).some(r=>r.cents===850)"),true);
  report.push('Old daily expense survives schema migration');
  await screenshot('04-month-plan');
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"home\"]').click(); document.querySelector('[data-category=\"food\"]').click(); document.querySelector('[data-item=\"meal-1\"]').click(); true");
  await until("!!document.querySelector('#actual-input')", 'Monthly actual editor opens');
  await client.evaluate("(() => { const input=document.querySelector('#actual-input'); input.value='29'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#actual-form').requestSubmit(); return true; })()");
  await until("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).periodRecords).some(r=>r.cents===2900)", 'A monthly actual is stored once');
  await client.evaluate("Array.from(document.querySelectorAll('[data-date]')).at(-1).click(); true");
  await until("document.querySelector('#actual-input')?.value==='29.00'", 'Selecting another date in the same month reuses the same actual');
  assert.equal(await client.evaluate("Object.keys(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).periodRecords).length"),1);
  await screenshot('07-monthly-actual');
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"home\"]').click(); document.querySelector('[data-category=\"food\"]').click(); document.querySelector('[data-item=\"meal-2\"]').click(); true");
  await until("!!document.querySelector('#actual-input')", 'Yearly actual editor opens');
  await client.evaluate("(() => { const input=document.querySelector('#actual-input'); input.value='118'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#actual-form').requestSubmit(); return true; })()");
  await until("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).periodRecords).some(r=>r.cents===11800)", 'A yearly actual is stored once');
  await screenshot('08-yearly-actual');
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"plan\"]').click(); true");
  await until("!!document.querySelector('[data-plan-add=\"food\"]')", 'A populated budget category keeps its add-item entry');
  await client.evaluate("(() => { const input=document.querySelector('[data-plan-item=\"meal-0\"]'); input.value='9.75'; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
  async function addBudgetItem(categoryId, name) {
    await client.evaluate(`document.querySelector('[data-plan-add="${categoryId}"]').click(); true`);
    await until("document.querySelector('#modal').open && !!document.querySelector('#add-form')", `Add-item dialog opens for ${name} without leaving the draft`);
    await client.evaluate(`document.querySelector('#add-form input[name="name"]').value=${JSON.stringify(name)}; document.querySelector('#add-form').requestSubmit(); true`);
    await until(`!document.querySelector('#modal').open && !!document.querySelector('[aria-label="${name}预计金额"]')`, `${name} is added within the budget plan`);
    assert.equal(await client.evaluate("document.querySelector('[data-plan-item=\"meal-0\"]').value"), '9.75');
    assert.equal(await client.evaluate(`!!document.querySelector('[data-plan-add="${categoryId}"]')`), true);
  }
  await addBudgetItem('food', '零食');
  await client.evaluate("(() => { const input=document.querySelector('[aria-label=\"零食预计金额\"]'); input.value='0'; const select=document.querySelector('[data-plan-unit=\"'+input.dataset.planItem+'\"]'); select.value='month'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()");
  await addBudgetItem('food', '水果');
  const supplyId = await client.evaluate("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).categories[1].id");
  await addBudgetItem(supplyId, '洗衣液');
  await addBudgetItem(supplyId, '纸巾');
  assert.equal(await client.evaluate("document.querySelector('[aria-label=\"零食预计金额\"]').value"), '0');
  assert.equal(await client.evaluate("document.querySelector('[aria-label=\"零食计费周期\"]').value"), 'month');
  assert.equal(await client.evaluate("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).plans).flat().some(p=>p.cents===975)"), false);
  report.push('Repeated additions to empty and populated categories preserve unsaved amount, zero and cycle fields without saving budgets');
  await client.evaluate("document.querySelector('[data-plan-add=\"food\"]').click(); document.querySelector('#add-form input[name=\"name\"]').value='零食'; document.querySelector('#add-form').requestSubmit(); true");
  await until("document.querySelector('#modal').open && !document.querySelector('#add-form [type=\"submit\"]').disabled && document.querySelector('#toast').textContent.includes('存在')", 'Duplicate name keeps the dialog open for correction');
  await client.evaluate("document.querySelector('#add-form [data-close]').click(); true");
  assert.equal(await client.evaluate("document.querySelector('[aria-label=\"零食预计金额\"]').value"), '0');
  await screenshot('09-repeat-budget-items');
  await client.evaluate("document.querySelector('#plan-form').requestSubmit(); true");
  await until("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).plans).flat().some(p=>p.cents===975)", 'Preserved budget draft saves only when explicitly submitted');
  await client.evaluate("document.querySelector('[data-plan-shift=\"-1\"]').click(); true");
  assert.equal(await client.evaluate("document.querySelectorAll('[data-plan-add]').length"), 0);
  report.push('Historical budget months remain read-only with no add-item entry');
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"report\"]').click(); true");
  await until("!!document.querySelector('.report-section')", 'Spending report opens');
  await screenshot('05-report');
  await client.evaluate("document.querySelector('[data-report-mode=\"year\"]').click(); true");
  await until("document.body.innerText.includes('全年各周期预算合计')", 'Annual report is available');
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
