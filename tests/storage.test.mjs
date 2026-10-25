import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../dist/core.js';
import {createLedgerStore} from '../dist/ledger-store.js';
const key='ledger';
function fixture() {
  let browser=null, checkpoint=null;
  const storage={getItem:()=>browser,setItem:(_,raw)=>{browser=raw;}};
  const bridge={loadLedger:()=>checkpoint,saveLedger:raw=>{checkpoint=raw;return true;}};
  return {storage,bridge,setBrowser:raw=>{browser=raw;},getBrowser:()=>browser,getCheckpoint:()=>checkpoint};
}
test('native durable revision survives loss of the most recent WebView writes',()=>{
  const f=fixture(), store=createLedgerStore(f.storage,key,f.bridge), s=createState('2026-10-25');
  store.save(s); const old=f.getBrowser(); s.revision=2; s.timeEntries=[{id:'sleep',date:'2026-10-25',start:0,end:420,title:'睡觉',kind:'normal'}]; store.save(s);
  f.setBrowser(old); // Process death kept only the older WebView snapshot.
  const restarted=createLedgerStore(f.storage,key,f.bridge); assert.deepEqual(restarted.load(),s);
  restarted.save(restarted.load()); assert.deepEqual(JSON.parse(f.getBrowser()),s);
});
test('native checkpoint failure is reported before the WebView mirror is changed',()=>{
  const f=fixture(), s=createState('2026-10-25'); const store=createLedgerStore(f.storage,key,f.bridge); store.save(s);
  const old=f.getBrowser();f.bridge.saveLedger=()=>false;s.revision++;
  assert.throws(()=>store.save(s),/未确认保存/);assert.equal(f.getBrowser(),old);
});
test('a native durable save remains loadable when the WebView mirror is unavailable',()=>{
  const f=fixture(), s=createState('2026-10-25');s.revision=3;
  f.storage.setItem=()=>{throw Error('quota');}; f.storage.getItem=()=>{throw Error('unavailable');};
  const store=createLedgerStore(f.storage,key,f.bridge);store.save(s);assert.deepEqual(store.load(),s);
});
test('web-only storage retains quota errors and has no silent fallback',()=>{
  const f=fixture(), store=createLedgerStore(f.storage,key), s=createState('2026-10-25');
  assert.equal(store.native,false);assert.equal(store.load(),null);store.save(s);assert.deepEqual(store.load(),s);
  f.storage.setItem=()=>{throw Error('quota');};assert.throws(()=>store.save(s),/quota/);
});
test('initial upgrades and equal revisions preserve newer browser edits',()=>{
  const f=fixture(), s=createState('2026-10-25');s.revision=4;
  const legacy=structuredClone(s);legacy.schema=2;delete legacy.timeEntries;f.setBrowser(JSON.stringify(legacy));
  const initial=createLedgerStore(f.storage,key,f.bridge);assert.equal(initial.load().schema,3);assert.deepEqual(initial.load().records,s.records);initial.save(initial.load());
  f.bridge.saveLedger(JSON.stringify(s));const browser=structuredClone(s);browser.categories[0].name='新名称';f.setBrowser(JSON.stringify(browser));
  const store=createLedgerStore(f.storage,key,f.bridge);assert.equal(store.load().categories[0].name,'新名称');
  browser.revision=5;f.setBrowser(JSON.stringify(browser));assert.equal(store.load().revision,5);
});
test('corrupt native data is reported rather than overwritten with an empty ledger',()=>{
  const f=fixture();f.bridge.saveLedger('{broken');const raw=f.getCheckpoint();
  assert.throws(()=>createLedgerStore(f.storage,key,f.bridge).load());assert.equal(f.getCheckpoint(),raw);
});
