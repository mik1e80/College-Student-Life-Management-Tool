export const ALARM_DAYS=['周一','周二','周三','周四','周五','周六','周日'];
export const alarmDate=d=>`${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function alarmTimeAt(date,time) {return new Date(`${date}T${time}:00`).getTime();}
function validDate(date) {try{return /^\d{4}-\d{2}-\d{2}$/.test(date)&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}catch{return false;}}
export function validateAlarms(alarms) {
  if(!Array.isArray(alarms))throw Error('闹钟数据不正确');
  const ids=new Set();
  for(const a of alarms) {
    if(!a||typeof a.id!=='string'||!a.id||ids.has(a.id)||typeof a.generation!=='string'||!a.generation||typeof a.label!=='string'||a.label.length>24||!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)||typeof a.enabled!=='boolean'||typeof a.vibrate!=='boolean'||![0,5,10,15].includes(a.snoozeMinutes)||!Array.isArray(a.days)||a.days.some(n=>!Number.isInteger(n)||n<1||n>7)||new Set(a.days).size!==a.days.length||(!a.days.length&&!validDate(a.date)))throw Error('闹钟时间、重复日期或设置不正确');
    ids.add(a.id);
  }
}
export function nextAlarmOccurrence(alarm,now=Date.now()) {
  if(!alarm.enabled)return null;
  if(!alarm.days.length){const at=alarmTimeAt(alarm.date,alarm.time);return at>now?{at,date:alarm.date,key:`${alarm.id}|${alarm.generation}|${alarm.date}`} : null;}
  for(let i=0;i<=7;i++) {
    const d=new Date(now);d.setHours(12,0,0,0);d.setDate(d.getDate()+i);
    const date=alarmDate(d),at=alarmTimeAt(date,alarm.time);
    if(alarm.days.includes(d.getDay()||7)&&at>now)return {at,date,key:`${alarm.id}|${alarm.generation}|${date}`};
  }
  return null;
}
export function saveAlarm(state,{id,time,label='',days=[],enabled=true,vibrate=true,snoozeMinutes=10},now=Date.now()) {
  if(id&&!state.alarms.some(a=>a.id===id))throw Error('这个闹钟已不存在');
  const next={id:id||crypto.randomUUID(),generation:crypto.randomUUID(),time,label:String(label).trim(),days:[...days].sort((a,b)=>a-b),enabled,vibrate,snoozeMinutes,date:null};
  if(!days.length){const today=alarmDate(new Date(now));let at=alarmTimeAt(today,time);if(at<=now){const d=new Date(now);d.setDate(d.getDate()+1);next.date=alarmDate(d);}else next.date=today;}
  validateAlarms([next]);const list=state.alarms.filter(a=>a.id!==next.id);list.push(next);state.alarms=list;return next;
}
export function toggleAlarm(state,id,enabled,now=Date.now()) {const a=state.alarms.find(a=>a.id===id);if(!a)throw Error('这个闹钟已不存在');return saveAlarm(state,{...a,enabled},now);}
export function deleteAlarm(state,id) {if(!state.alarms.some(a=>a.id===id))throw Error('这个闹钟已不存在');state.alarms=state.alarms.filter(a=>a.id!==id);}
export function alarmRepeatLabel(a) {return !a.days.length?'仅一次':a.days.length===7?'每天':a.days.join(',')==='1,2,3,4,5'?'工作日':a.days.join(',')==='6,7'?'周末':a.days.map(n=>ALARM_DAYS[n-1]).join('、');}
export function dueAlarms(state,since,now,receipts={},snoozes={}) {
  const result=[];
  for(const alarm of state.alarms) {
    if(!alarm.enabled)continue;
    const sn=snoozes[alarm.id];
    if(sn?.generation===alarm.generation&&sn.at>since&&sn.at<=now&&sn.at>now-600000&&!receipts[sn.key])result.push({...sn,alarm});
    for(let offset=-1;offset<=0;offset++) {
      const d=new Date(now);d.setHours(12,0,0,0);d.setDate(d.getDate()+offset);const date=alarmDate(d);
      if(alarm.days.length?!alarm.days.includes(d.getDay()||7):date!==alarm.date)continue;
      const at=alarmTimeAt(date,alarm.time),key=`${alarm.id}|${alarm.generation}|${date}`;
      if(at>since&&at<=now&&at>now-600000&&!receipts[key])result.push({at,key,alarm});
    }
  }
  return result.sort((a,b)=>a.at-b.at);
}
