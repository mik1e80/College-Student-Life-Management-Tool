import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
const app='cn.yiriyoushu.campuslife',key='yiri-campus-life-v1',checks=[];
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',timeout:30000}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let client;
async function connect() {
  for(let attempt=0;attempt<40;attempt++)try {
    const pid=adb('shell','pidof',app).split(/\s+/)[0];if(!pid)throw Error('No app process');
    adb('forward','tcp:9222',`localabstract:webview_devtools_remote_${pid}`);
    const target=(await (await fetch('http://127.0.0.1:9222/json')).json()).find(t=>t.type==='page'&&t.url.includes('appassets.androidplatform.net'));
    if(!target)throw Error('No WebView');
    const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let seq=0;const pending=new Map();
    socket.addEventListener('message',e=>{const message=JSON.parse(e.data),p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);});
    return {close:()=>socket.close(),evaluate:async expression=>{
      const id=++seq;const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout'));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
      if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
    }};
  }catch(error){if(attempt===39)throw error;await pause(500);}
}
async function until(fn,label,timeout=15000) {
  const end=Date.now()+timeout;while(Date.now()<end){if(await fn()){checks.push(label);console.log('PASS: '+label);return;}await pause(500);}throw Error('Timed out: '+label);
}
async function screenshot(name){await mkdir('android/screenshots',{recursive:true});await writeFile(`android/screenshots/${name}.png`,execFileSync('adb',['exec-out','screencap','-p']));}
async function replace(state) {
  assert.equal(await client.evaluate(`(() => {const raw=${JSON.stringify(JSON.stringify(state))};if(!AndroidApp.saveLedger(raw))return false;localStorage.setItem(${JSON.stringify(key)},raw);location.reload();return true;})()`),true);
  await until(()=>client.evaluate("!!document.querySelector('[data-category]')"),'Ledger reloads with the reminder configuration');
}
try {
  client=await connect();
  const original=JSON.parse(await client.evaluate('AndroidApp.loadLedger()'));
  await client.evaluate("document.querySelector('.mobile-nav [data-nav=\"time\"]').click();document.querySelector('[data-action=\"add-time\"]').click();true");
  assert.equal(await client.evaluate("document.querySelector('#reminder-start').value==='5'&&document.querySelector('#reminder-end').value==='5'"),true);
  await client.evaluate("document.querySelector('#time-form [data-close]').click();true");
  checks.push('New task editor defaults to five minutes before start and end');
  adb('shell','pm','revoke',app,'android.permission.POST_NOTIFICATIONS');
  adb('shell','appops','set',app,'SCHEDULE_EXACT_ALARM','deny');
  client.close();adb('shell','am','start','-n',app+'/.MainActivity');client=await connect();
  let status=JSON.parse(await client.evaluate('AndroidApp.reminderStatus()'));
  assert.equal(status.notifications,false);assert.equal(status.exact,false);
  checks.push('Denied notification and exact-alarm permissions are reported without breaking the ledger');
  adb('shell','pm','grant',app,'android.permission.POST_NOTIFICATIONS');
  adb('shell','appops','set',app,'SCHEDULE_EXACT_ALARM','allow');
  // Two real wall-clock alarms: an end warning in 20–80 s, a start warning 60 s later.
  const fixture=await client.evaluate(`(() => {
    const s=JSON.parse(AndroidApp.loadLedger()),now=Date.now(),first=Math.ceil((now+20000)/60000)*60000;
    const entry=(id,title,start,end,reminders)=>{const d=new Date(start),day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');const a=d.getHours()*60+d.getMinutes();return {id,title,date:day,start:a,end:a+(end-start)/60000,kind:'normal',reminders};};
    s.revision++;s.reminderSettings={enabled:true};s.timeEntries=[entry('end-warning-test','结束提醒验证',first-600000,first+300000,{start:null,end:5}),entry('start-warning-test','开始提醒验证',first+360000,first+1200000,{start:5,end:null})];return {state:s,first};
  })()`);
  await replace(fixture.state);
  status=JSON.parse(await client.evaluate('AndroidApp.reminderStatus()'));
  assert.equal(status.notifications,true);assert.equal(status.exact,true);assert.equal(status.nextAt,fixture.first);
  checks.push('Original local task dates schedule the first exact alarm at the five-minute warning');
  await until(()=>adb('shell','cmd','notification','list').includes('end-warning-test'),'A real end-warning alarm posts the system notification',95000);
  adb('shell','uiautomator','dump','/sdcard/reminder-ui.xml');
  assert.match(adb('shell','cat','/sdcard/reminder-ui.xml'),/任务提醒/);
  assert.match(adb('shell','cat','/sdcard/reminder-ui.xml'),/结束提醒验证/);
  await screenshot('14-foreground-reminder');
  checks.push('Foreground task reminder is a visible native popup');
  adb('shell','input','keyevent','4');adb('shell','input','keyevent','3');
  client.close();client=null;await pause(500);adb('shell','am','kill',app);
  await until(()=>{try{return !adb('shell','pidof',app);}catch{return true;}},'App process exits normally while its next alarm remains registered');
  await until(()=>adb('shell','cmd','notification','list').includes('start-warning-test'),'A real start warning is delivered after the app process was killed',80000);
  adb('shell','cmd','statusbar','expand-notifications');await screenshot('15-background-reminder');adb('shell','cmd','statusbar','collapse');
  adb('shell','am','start','-n',app+'/.MainActivity');client=await connect();
  await until(async()=>JSON.parse(await client.evaluate('AndroidApp.reminderStatus()')).nextAt===0,'Delivered reminders are not scheduled again on app reopen');
  const pending=structuredClone(fixture.state);pending.revision+=20;
  const task=pending.timeEntries[1];task.date='2099-01-01';task.start=540;task.end=600;pending.timeEntries=[task];await replace(pending);
  const firstPending=JSON.parse(await client.evaluate('AndroidApp.reminderStatus()')).nextAt;assert(firstPending>Date.now());
  pending.revision++;task.start+=10;task.end+=10;await replace(pending);
  assert.equal(JSON.parse(await client.evaluate('AndroidApp.reminderStatus()')).nextAt,firstPending+600000);
  pending.revision++;pending.timeEntries=[];await replace(pending);assert.equal(JSON.parse(await client.evaluate('AndroidApp.reminderStatus()')).nextAt,0);
  pending.revision++;pending.timeEntries=[task];pending.reminderSettings.enabled=false;await replace(pending);
  assert.equal(JSON.parse(await client.evaluate('AndroidApp.reminderStatus()')).nextAt,0);assert(!adb('shell','cmd','notification','list').includes(app));
  checks.push('Changing time replaces the pending alarm; deleting a task or turning reminders off cancels it and clears notifications');
  original.revision=pending.revision+1;await replace(original);
  assert.deepEqual(JSON.parse(await client.evaluate('AndroidApp.loadLedger()')).records,original.records);
  assert.equal(JSON.parse(await client.evaluate('AndroidApp.loadLedger()')).timeEntries.length,6);
  checks.push('Reminder tests preserve the existing expense and six saved time entries');
  await writeFile('android/reminder-report.json',JSON.stringify({passed:true,checks},null,2));
}catch(error){
  try{await screenshot('reminder-failure');await writeFile('android/reminder-diagnostics.txt',adb('shell','dumpsys','alarm')+'\n'+adb('shell','dumpsys','notification','--noredact'));}catch{}
  await writeFile('android/reminder-report.json',JSON.stringify({passed:false,checks,error:error.message},null,2));throw error;
}finally{client?.close();try{adb('forward','--remove','tcp:9222');}catch{}}
