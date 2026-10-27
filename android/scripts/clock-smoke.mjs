import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
const app='cn.yiriyoushu.campuslife',checks=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}).trim();
let client;
async function connect(){
  for(let attempt=0;attempt<40;attempt++)try{
    const pid=adb('shell','pidof',app).split(/\s+/)[0];adb('forward','tcp:9222',`localabstract:webview_devtools_remote_${pid}`);
    const target=(await(await fetch('http://127.0.0.1:9222/json')).json()).find(t=>t.type==='page'&&t.url.includes('appassets.androidplatform.net'));
    if(!target)throw Error('No WebView');const socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
    let seq=0;const pending=new Map();socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);});
    return {close:()=>socket.close(),evaluate:async expression=>{const id=++seq,result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout'));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}};
  }catch(e){if(attempt===39)throw e;await pause(500);}
}
async function until(fn,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn()){checks.push(label);console.log('PASS: '+label);return;}await pause(500);}throw Error('Timed out: '+label);}
async function screenshot(name){await mkdir('android/screenshots',{recursive:true});await writeFile(`android/screenshots/${name}.png`,execFileSync('adb',['exec-out','screencap','-p'],{maxBuffer:8*1024*1024}));}
function tapText(text){adb('shell','uiautomator','dump','/sdcard/clock-ui.xml');const xml=adb('shell','cat','/sdcard/clock-ui.xml');const node=xml.match(/<node\b[^>]*>/g)?.find(n=>n.includes(`text="${text}"`));const bounds=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);if(!bounds)throw Error('Native control not found: '+text);adb('shell','input','tap',String(Math.floor((+bounds[1]+ +bounds[3])/2)),String(Math.floor((+bounds[2]+ +bounds[4])/2)));}
try {
  client=await connect();const original=JSON.parse(await client.evaluate('AndroidApp.loadLedger()'));
  adb('shell','pm','grant',app,'android.permission.POST_NOTIFICATIONS');adb('shell','appops','set',app,'SCHEDULE_EXACT_ALARM','allow');adb('shell','appops','set',app,'USE_FULL_SCREEN_INTENT','allow');
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"alarm\"]').click();document.querySelector('[data-add-alarm]').click();true");
  assert.equal(await client.evaluate("document.querySelector('#alarm-snooze').value"),'10');
  const next=await client.evaluate("(() => {const at=Math.ceil((Date.now()+25000)/60000)*60000,d=new Date(at);return {at,time:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};})()");
  await client.evaluate(`document.querySelector('#alarm-time').value=${JSON.stringify(next.time)};document.querySelector('#alarm-label').value='起床验证';document.querySelector('#alarm-form').requestSubmit();true`);
  await until(()=>client.evaluate("!document.querySelector('#modal').open && JSON.parse(AndroidApp.loadLedger()).alarms.length===1"),'An alarm is saved through its independent page with ten-minute snooze');
  let status=JSON.parse(await client.evaluate('AndroidApp.clockStatus()'));assert.equal(status.nextAt,next.at);assert(status.notifications&&status.exact&&status.fullScreen);
  await screenshot('16-alarm-page');
  adb('shell','input','keyevent','3');client.close();client=null;const pid=adb('shell','pidof',app).split(/\s+/)[0];if(pid)adb('shell','run-as',app,'kill','-9',pid);
  adb('shell','input','keyevent','26');
  await until(()=>adb('shell','dumpsys','activity','services',app).includes('AlarmRingingService'),'The real alarm starts its ringing service after process reclamation and screen off',100000);
  await until(()=>{adb('shell','uiautomator','dump','/sdcard/clock-ui.xml');const xml=adb('shell','cat','/sdcard/clock-ui.xml');return xml.includes('起床验证')&&xml.includes('停止闹钟');},'The permitted lock-screen alarm activity opens',15000);
  await screenshot('17-lockscreen-clock');
  adb('shell','am','start','-n',app+'/.MainActivity');client=await connect();
  await until(()=>client.evaluate("!!document.querySelector('.mobile-nav [data-nav=\"alarm\"]')"),'The native ledger page is ready after returning from the lock screen');
  await until(async()=>JSON.parse(await client.evaluate('AndroidApp.clockStatus()')).soundPlaying===true,'Alarm audio is actually playing using the native alarm stream');
  await client.evaluate("(() => {const s=JSON.parse(AndroidApp.loadLedger());s.revision++;s.reminderSettings.enabled=false;return AndroidApp.saveLedger(JSON.stringify(s));})()");
  await until(async()=>JSON.parse(await client.evaluate('AndroidApp.clockStatus()')).ringing===true,'Disabling task reminders and saving the ledger does not stop the independent alarm');
  assert(adb('shell','cmd','notification','list').includes('|4901|'));
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"alarm\"]').click();document.querySelector('[data-open-ring]').click();true");
  // The WebView bridge posts Activity launch asynchronously. Wait for input focus
  // before tapping; a visible accessibility tree may still belong to the old window.
  await until(()=>/mCurrentFocus=.*AlarmRingingActivity/.test(adb('shell','dumpsys','window')),'The reopened ringing activity owns input focus before snooze');
  adb('shell','uiautomator','dump','/sdcard/clock-ready.xml');
  const readyXml=adb('shell','cat','/sdcard/clock-ready.xml');
  assert(readyXml.includes('text="稍后 10 分钟"'));
  await writeFile('android/clock-ready.xml',readyXml);
  tapText('稍后 10 分钟');
  await until(async()=>{const s=JSON.parse(await client.evaluate('AndroidApp.clockStatus()'));return !s.ringing&&!s.soundPlaying&&s.nextAt>Date.now()+570000&&s.nextAt<Date.now()+610000;},'Snooze stops audio and schedules the next alarm ten minutes later');
  await client.evaluate("document.querySelector('[data-cancel-snooze]').click();true");
  await until(async()=>JSON.parse(await client.evaluate('AndroidApp.clockStatus()')).nextAt===0,'Cancelling snooze removes its pending system alarm');
  await client.evaluate("document.querySelector('[data-edit-alarm]').click();document.querySelector('#alarm-time').value='07:30';document.querySelector('[data-days=\"1,2,3,4,5\"]').click();document.querySelector('#alarm-form').requestSubmit();true");
  await until(()=>client.evaluate("JSON.parse(AndroidApp.loadLedger()).alarms[0].days.join(',')==='1,2,3,4,5'"),'The alarm editor saves weekday repetition independently from time tasks');
  await client.evaluate("document.querySelector('[data-toggle-alarm]').click();true");
  await until(async()=>JSON.parse(await client.evaluate('AndroidApp.clockStatus()')).nextAt===0,'Switching the alarm off cancels its recurring schedule');
  await client.evaluate("document.querySelector('[data-edit-alarm]').click();setTimeout(()=>document.querySelector('#delete-alarm').click(),0);true");tapText('确定');
  await until(()=>client.evaluate('JSON.parse(AndroidApp.loadLedger()).alarms.length===0'),'Deleting the alarm removes its row and pending ringing state');
  const raw=JSON.stringify({...original,revision:original.revision+100});
  await client.evaluate(`AndroidApp.saveLedger(${JSON.stringify(raw)});location.reload();true`);
  await until(()=>client.evaluate("!!document.querySelector('[data-category]')"),'Original ledger reloads after the alarm checks');
  const restored=JSON.parse(await client.evaluate('AndroidApp.loadLedger()'));assert.deepEqual(restored.records,original.records);assert.equal(restored.timeEntries.length,6);assert.deepEqual(restored.alarms,original.alarms);
  await writeFile('android/clock-report.json',JSON.stringify({passed:true,checks},null,2));
}catch(error){try{if(client)await writeFile('android/clock-status.json',await client.evaluate('AndroidApp.clockStatus()'));await screenshot('clock-failure');await writeFile('android/clock-diagnostics.txt',adb('logcat','-d','-s','AlarmClock:V','MediaPlayer:V','MediaPlayerNative:V','AudioManager:V','MediaFocusControl:V','AudioService:V','AndroidRuntime:E')+'\n'+adb('shell','dumpsys','window')+'\n'+adb('shell','dumpsys','alarm'));}catch{}await writeFile('android/clock-report.json',JSON.stringify({passed:false,checks,error:error.message},null,2));throw error;}
finally{client?.close();try{adb('forward','--remove','tcp:9222');}catch{}}
