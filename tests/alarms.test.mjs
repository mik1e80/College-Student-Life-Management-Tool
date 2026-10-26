import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,readState,saveActual} from '../dist/core.js';
import {saveAlarm,toggleAlarm,deleteAlarm,nextAlarmOccurrence,alarmRepeatLabel,dueAlarms,validateAlarms} from '../dist/alarms.js';
const at=s=>new Date(s).getTime(),date='2026-10-25';
test('one-off alarms choose today or tomorrow and default to ten-minute snooze',()=>{
  const s=createState(date),now=at('2026-10-25T08:00:00');const a=saveAlarm(s,{time:'09:00'},now),b=saveAlarm(s,{time:'07:00'},now);
  assert.equal(a.date,date);assert.equal(b.date,'2026-10-26');assert.equal(a.snoozeMinutes,10);assert.equal(nextAlarmOccurrence(a,now).at,at('2026-10-25T09:00:00'));assert.equal(nextAlarmOccurrence(a,at('2026-10-25T09:01:00')),null);
});
test('weekday and weekend repeats cross the week boundary without duplicating a date',()=>{
  const s=createState(date),now=at('2026-10-25T08:00:00');const a=saveAlarm(s,{time:'07:00',days:[5,3,1,4,2]},now);
  assert.deepEqual(a.days,[1,2,3,4,5]);assert.equal(alarmRepeatLabel(a),'工作日');assert.equal(nextAlarmOccurrence(a,now).date,'2026-10-26');
  const b=saveAlarm(s,{time:'07:00',days:[6,7]},now);assert.equal(nextAlarmOccurrence(b,now).date,'2026-10-31');assert.equal(alarmRepeatLabel(b),'周末');
});
test('daily and weekly alarms handle leap days, month ends and years',()=>{
  const s=createState(date),now=at('2028-02-28T23:59:00');const a=saveAlarm(s,{time:'00:00',days:[1,2,3,4,5,6,7]},now);
  assert.equal(nextAlarmOccurrence(a,now).date,'2028-02-29');assert.equal(nextAlarmOccurrence(a,at('2028-12-31T23:59:00')).date,'2029-01-01');assert.equal(alarmRepeatLabel(a),'每天');
});
test('switching off removes the next occurrence and switching back on re-arms a one-off',()=>{
  const s=createState(date),now=at('2026-10-25T08:00:00');let a=saveAlarm(s,{time:'09:00'},now);const gen=a.generation;
  a=toggleAlarm(s,a.id,false,now);assert.equal(nextAlarmOccurrence(a,now),null);assert.notEqual(a.generation,gen);
  a=toggleAlarm(s,a.id,true,at('2026-10-25T10:00:00'));assert.equal(a.date,'2026-10-26');
});
test('editing preserves identity while invalidating old pending and snoozed generations',()=>{
  const s=createState(date),now=at('2026-10-25T08:00:00');let a=saveAlarm(s,{time:'09:00'},now);const old={...a};a=saveAlarm(s,{...a,label:'早课',time:'09:30'},now);
  assert.equal(a.id,old.id);assert.notEqual(a.generation,old.generation);assert.equal(dueAlarms(s,now,now+1000,{}, {[a.id]:{generation:old.generation,at:now+500,key:'old'}}).length,0);
});
test('invalid input is rejected without changing finances, reminders or existing clocks',()=>{
  const s=createState(date);saveActual(s,'meal-0',date,850,date);const before=structuredClone(s),now=at('2026-10-25T08:00:00');
  for(const v of [{time:'25:00'},{time:'07:00',days:[0]},{time:'07:00',days:[1,1]},{time:'07:00',snoozeMinutes:7},{time:'07:00',enabled:'yes'},{time:'07:00',label:'a'.repeat(25)}]){assert.throws(()=>saveAlarm(s,v,now));assert.deepEqual(s,before);}
});
test('old ledgers migrate to an empty alarm page and complete backups retain clocks',()=>{
  const s=createState(date);delete s.alarms;const old=readState(JSON.stringify(s));assert.deepEqual(old.alarms,[]);
  saveAlarm(old,{time:'07:30',label:'起床',days:[1],vibrate:false},at('2026-10-25T08:00:00'));assert.deepEqual(readState(JSON.stringify(old)),old);
});
test('duplicate IDs and corrupt stored alarm settings cannot replace an existing ledger',()=>{
  const s=createState(date);const a=saveAlarm(s,{time:'07:00'},at('2026-10-25T08:00:00'));assert.throws(()=>validateAlarms([a,{...a}]));a.days=[8];assert.throws(()=>readState(JSON.stringify(s)));
});
test('due alarms fire once and do not replay when already acknowledged or expired',()=>{
  const s=createState(date),now=at('2026-10-25T08:00:00');saveAlarm(s,{time:'09:00'},now);const fire=at('2026-10-25T09:00:00'),[event]=dueAlarms(s,fire-1000,fire);
  assert(event);assert.equal(dueAlarms(s,fire-1000,fire,{[event.key]:fire}).length,0);assert.equal(dueAlarms(s,fire-1000,fire+600001).length,0);
});
test('simultaneous clocks remain independent and ten-minute snoozes use independent receipts',()=>{
  const s=createState(date),now=at('2026-10-25T08:00:00');const a=saveAlarm(s,{time:'09:00'},now);saveAlarm(s,{time:'09:00',label:'另一个'},now);const fire=at('2026-10-25T09:00:00');assert.equal(dueAlarms(s,fire-1,fire).length,2);
  const sn={generation:a.generation,at:fire+600000,key:'snooze-test'};assert.equal(dueAlarms(s,sn.at-1,sn.at,{}, {[a.id]:sn})[0].key,'snooze-test');
});
test('deleting a clock cancels its occurrences and leaves expense/time data intact',()=>{
  const s=createState(date),now=at('2026-10-25T08:00:00');saveActual(s,'meal-0',date,850,date);const a=saveAlarm(s,{time:'09:00'},now),finance=structuredClone(s.records);
  deleteAlarm(s,a.id);assert.deepEqual(s.alarms,[]);assert.deepEqual(s.records,finance);assert.deepEqual(s.timeEntries,[]);assert.equal(dueAlarms(s,now,now+3600000).length,0);
});
