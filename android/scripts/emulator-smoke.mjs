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
  assert.equal(await client.evaluate('document.title'), '双衡 · 生活与时间管理');
  assert.equal(await client.evaluate('getComputedStyle(document.documentElement).backgroundColor'), 'rgb(255, 255, 255)');
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('.hero')).backgroundColor"), 'rgb(23, 23, 23)');
  report.push('Shuangheng name and monochrome background/hero render in the native WebView');
  await screenshot('01-home');
  await client.evaluate("document.querySelector('[data-category]').click(); document.querySelector('[data-item]').click(); true");
  await until("!!document.querySelector('#actual-input')", 'Expense editor opens through category and item navigation');
  await screenshot('02-detail');
  await client.evaluate("(() => { const input = document.querySelector('#actual-input'); input.value = '8.50'; input.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('#actual-form').requestSubmit(); return true; })()");
  await until("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).records).some(record => record.cents === 850)", 'A real expense entered through the UI is saved');
  // Persistence completes before the asynchronous form handler resets its draft.
  // Wait for the user-visible completion before exercising native navigation.
  await until("document.querySelector('#toast').textContent.startsWith('已保存') && document.querySelector('#actual-input')?.value==='8.50'", 'The expense form has completed saving before System Back');
  adb('shell', 'input', 'keyevent', '4');
  await until("!document.querySelector('#actual-form') && !!document.querySelector('[data-item]')", 'System Back returns from detail to the category');
  await screenshot('03-category');

  // Mimic an installed 1.1.0 ledger before restarting the upgraded app.
  assert.equal(await client.evaluate("(() => { const old = JSON.parse(localStorage.getItem('yiri-campus-life-v1')); old.schema=1; delete old.cadences; delete old.periodPlans; delete old.periodRecords; delete old.timeEntries; const raw=JSON.stringify(old); localStorage.setItem('yiri-campus-life-v1',raw); return AndroidApp.saveLedger(raw); })()"),true);

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
  await until("(() => { const s=JSON.parse(localStorage.getItem('yiri-campus-life-v1')); return s.schema===3 && Object.keys(s.plans).length===1 && Object.keys(s.periodPlans).length===2; })()", 'Daily, monthly and yearly budgets save with automatic old-ledger migration');
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
  await client.evaluate("document.querySelector('[data-action=\"manage-categories\"]').click(); true");
  await until("document.querySelector('#modal').open && !!document.querySelector('[data-rename-id=\"food\"]')", 'Category manager opens from the budget plan');
  await client.evaluate("document.querySelector('[data-rename-id=\"food\"] input').value='餐饮与会员'; document.querySelector('[data-rename-id=\"food\"]').requestSubmit(); true");
  await until("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).categories.find(c=>c.id==='food').name==='餐饮与会员'", 'A category with existing expenses can be renamed');
  await client.evaluate("document.querySelector('[data-rename-id=\"meal-0\"] input').value='早餐餐费'; document.querySelector('[data-rename-id=\"meal-0\"]').requestSubmit(); true");
  await until("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).items.find(i=>i.id==='meal-0').name==='早餐餐费'", 'An item with existing expenses can be renamed without changing its ID');
  assert.equal(await client.evaluate("document.querySelector('[data-delete-id=\"food\"]').disabled && document.querySelector('[data-delete-id=\"meal-0\"]').disabled"),true);
  assert.equal(await client.evaluate("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).records).some(r=>r.cents===850)"),true);
  await client.evaluate("document.querySelector('[data-rename-id=\"meal-0\"] input').value='午餐'; document.querySelector('[data-rename-id=\"meal-0\"]').requestSubmit(); true");
  await until("document.querySelector('#manage-error').textContent.includes('同名')", 'Duplicate rename reports an inline error and keeps the ledger intact');
  const snackId=await client.evaluate("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).items.find(i=>i.name==='零食').id");
  await client.evaluate(`document.querySelector('[data-delete-id="${snackId}"]').click(); true`);
  await until("!!document.querySelector('#confirm-category-delete')", 'Budget-only item deletion requires confirmation');
  await client.evaluate("document.querySelector('[data-cancel-delete]').click(); true");
  assert.equal(await client.evaluate(`JSON.parse(localStorage.getItem('yiri-campus-life-v1')).items.some(i=>i.id==='${snackId}')`),true);
  await client.evaluate(`document.querySelector('[data-delete-id="${snackId}"]').click(); document.querySelector('#confirm-category-delete').click(); true`);
  await until(`!JSON.parse(localStorage.getItem('yiri-campus-life-v1')).items.some(i=>i.id==='${snackId}')`, 'Confirmed deletion removes an unused item and its budget');
  assert.equal(await client.evaluate(`Object.keys(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).periodPlans).some(key=>key.endsWith(':${snackId}'))`),false);
  await client.evaluate(`document.querySelector('[data-delete-id="${supplyId}"]').click(); document.querySelector('#confirm-category-delete').click(); true`);
  await until(`!JSON.parse(localStorage.getItem('yiri-campus-life-v1')).categories.some(c=>c.id==='${supplyId}')`, 'An unused category and its children are removed together');
  assert.equal(await client.evaluate(`JSON.parse(localStorage.getItem('yiri-campus-life-v1')).items.some(i=>i.categoryId==='${supplyId}')`),false);
  const fruitId=await client.evaluate("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).items.find(i=>i.name==='水果').id");
  await client.evaluate(`document.querySelector('[data-delete-id="${fruitId}"]').click(); true`);
  // Simulate another window saving zero after the delete confirmation was opened.
  await client.evaluate(`(async () => { const core=await import('./core.js'); const key='yiri-campus-life-v1'; const ledger=JSON.parse(localStorage.getItem(key)); core.saveActual(ledger,'${fruitId}',core.dateKey(),0); const value=JSON.stringify(ledger); localStorage.setItem(key,value); window.dispatchEvent(new StorageEvent('storage',{key,newValue:value})); return true; })()`);
  await client.evaluate("document.querySelector('#confirm-category-delete').click(); true");
  await until("document.querySelector('#manage-error').textContent.includes('不能删除')", 'A newly saved zero record blocks deletion even after confirmation was opened');
  assert.equal(await client.evaluate(`JSON.parse(localStorage.getItem('yiri-campus-life-v1')).items.some(i=>i.id==='${fruitId}')`),true);
  await client.evaluate("document.querySelector('[data-cancel-delete]').click(); true");
  assert.equal(await client.evaluate(`document.querySelector('[data-delete-id="${fruitId}"]').disabled`),true);
  await screenshot('10-category-manager');
  await client.evaluate("Array.from(document.querySelectorAll('#modal [data-close]')).at(-1).click(); true");
  report.push('Category and item rename preserve expenses; protected deletion is disabled; cancellation and confirmed unused-category cleanup work');
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

  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"time\"]').click(); const input=document.querySelector('#time-date'); input.value=JSON.parse(localStorage.getItem('yiri-campus-life-v1')).createdOn; input.dispatchEvent(new Event('change',{bubbles:true})); true");
  await until("document.querySelector('[data-time-gap]').dataset.timeGap==='1440'", 'New time planner shows the entire unplanned day');
  async function addTime(title,start,end,nextDay=false) {
    await client.evaluate("document.querySelector('[data-action=\"add-time\"]').click(); true");
    await until("!!document.querySelector('#time-form')", `Time editor opens for ${title}`);
    await client.evaluate(`(() => { const form=document.querySelector('#time-form'); const preset=form.querySelector('[data-time-preset="${title}"]'); if(preset)preset.click(); else form.querySelector('#time-title').value=${JSON.stringify(title)}; const day=new Date(form.querySelector('#time-entry-date').value+'T12:00:00Z'); day.setUTCDate(day.getUTCDate()+${nextDay?1:0}); form.querySelector('#time-end-date').value=day.toISOString().slice(0,10); form.querySelector('#time-start').value=${JSON.stringify(start)}; form.querySelector('#time-end').value=${JSON.stringify(end)}; form.dispatchEvent(new Event('change',{bubbles:true})); form.requestSubmit(); return true; })()`);
    await until("!document.querySelector('#modal').open", `${title} time range saves`);
  }
  await addTime('睡觉','00:00','07:00');
  await addTime('自由时间','12:00','13:00');
  assert.equal(await client.evaluate("document.querySelectorAll('[data-time-kind=\"free\"]').length"),1);
  await client.evaluate("document.querySelector('[data-action=\"add-time\"]').click(); document.querySelector('[data-time-preset=\"吃饭时间\"]').click(); document.querySelector('#time-end-date').value=document.querySelector('#time-entry-date').value; document.querySelector('#time-start').value='06:00'; document.querySelector('#time-end').value='08:00'; document.querySelector('#time-form').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#time-form').requestSubmit(); true");
  await until("document.querySelector('#time-error').textContent.includes('重叠')", 'Overlapping time is rejected without closing the editor');
  await client.evaluate("document.querySelector('#time-start').value='07:00'; document.querySelector('#time-form').requestSubmit(); true");
  await until("!document.querySelector('#modal').open", 'An adjusted adjacent meal time saves');
  await addTime('睡觉','22:00','07:00',true);
  const nightId=await client.evaluate("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).timeEntries.find(e=>e.start===1320&&e.end===1860).id");
  await client.evaluate(`document.querySelector('[data-time-edit="${nightId}"]').click(); true`);
  assert.equal(await client.evaluate("document.querySelector('#time-start').value==='22:00' && document.querySelector('#time-end').value==='07:00' && document.querySelector('#time-entry-date').value!==document.querySelector('#time-end-date').value"),true);
  assert.equal(await client.evaluate("document.querySelectorAll('#time-start-midnight,#time-end-midnight').length"),0);
  await screenshot('13-explicit-end-date');
  await client.evaluate("document.querySelector('#time-form [data-close]').click(); true");
  report.push('Explicit end date preserves 22:00 to next-day 07:00 on reopen; midnight toggles are removed');
  await screenshot('11-day-timeline');
  await client.evaluate("document.querySelector('[data-time-kind=\"free\"] [data-time-edit]').click(); document.querySelector('#time-title').value='午间休息'; document.querySelector('#time-form').requestSubmit(); true");
  await until("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).timeEntries.some(e=>e.title==='午间休息' && e.kind==='free')", 'Custom title retains the explicit free-time designation');
  await client.evaluate("document.querySelector('[data-time-shift=\"1\"]').click(); true");
  await until("document.querySelector('#time-timeline').textContent.includes('接上日')", 'Overnight sleep carries into the next date');
  await client.evaluate("document.querySelector('[data-action=\"copy-time\"]').click(); true");
  await until("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).timeEntries.length===7", 'Copy yesterday reuses identical overnight sleep and adds only missing daily segments');
  await client.evaluate("document.querySelector('[data-action=\"copy-time\"]').click(); true");
  await until("document.querySelector('#toast').textContent.includes('没有重复')", 'Copying again does not duplicate events');
  await client.evaluate("document.querySelector('[data-time-kind=\"free\"] [data-time-edit]').click(); document.querySelector('#delete-time').click(); document.querySelector('#confirm-time-delete').click(); true");
  await until("!document.querySelector('#modal').open && JSON.parse(localStorage.getItem('yiri-campus-life-v1')).timeEntries.length===6", 'Time entries may be deleted and their slots become unplanned');
  assert.equal(await client.evaluate("JSON.parse(AndroidApp.loadLedger()).timeEntries.length"),6);
  report.push('Native atomic checkpoint contains the confirmed latest six entries before immediate process death');
  assert.equal(await client.evaluate("Object.values(JSON.parse(localStorage.getItem('yiri-campus-life-v1')).records).some(r=>r.cents===850)"),true);
  client.close(); adb('shell','am','force-stop',app); adb('shell','am','start','-n',`${app}/.MainActivity`); client=await connect();
  await until("!!document.querySelector('#time-timeline') && !!document.querySelector('[data-category]')", 'Home combines the full time overview and expense categories');
  assert.equal(await client.evaluate("JSON.parse(localStorage.getItem('yiri-campus-life-v1')).timeEntries.length"),6);
  await screenshot('12-combined-home');
  report.push('Time planner presets, free/gap colors, overlap protection, cross-midnight view, copying, editing, deletion and offline restart all pass');

  await client.evaluate("window.__exportResult = null; const original = window.YiriNativeExportResult; window.YiriNativeExportResult = (ok, message) => { window.__exportResult = {ok, message}; original?.(ok, message); }; AndroidApp.saveText('oversized.json', 'application/json', 'x'.repeat(1048577)); true");
  await until("window.__exportResult?.ok === false && window.__exportResult.message.includes('1 MiB')", 'Native export rejects content larger than 1 MiB');
  await writeFile('android/smoke-screenshot.png', execFileSync('adb', ['exec-out', 'screencap', '-p']));
  await writeFile('android/smoke-report.json', JSON.stringify({ passed: true, checks: report }, null, 2));
  console.log(report.map(item => `PASS: ${item}`).join('\n'));
} catch (error) {
  try {
    await screenshot('failure');
    const page = await client?.evaluate("JSON.stringify({title:document.title,text:document.body.innerText,active:document.activeElement?.outerHTML})");
    await writeFile('android/smoke-failure.json', JSON.stringify({page, activity:adb('shell','dumpsys','activity','activities')},null,2));
  } catch { /* Preserve the original failure if the emulator disconnected. */ }
  await writeFile('android/smoke-report.json', JSON.stringify({ passed: false, checks: report, error: error.message }, null, 2));
  throw error;
} finally {
  client?.close();
  try { adb('forward', '--remove', 'tcp:9222'); } catch { /* Device may already be gone. */ }
}
