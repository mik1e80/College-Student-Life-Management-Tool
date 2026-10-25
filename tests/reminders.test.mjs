import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,readState,saveActual} from '../dist/core.js';
import {saveTimeEntry,deleteTimeEntry,copyTimeDay} from '../dist/time-core.js';
import {reminderEvents,dueReminders,localEntryTime,reminderMessage} from '../dist/reminders.js';
const date='2026-10-25';
function fixture(start='09:00',end='10:00',reminders={start:5,end:5},endDate=date) {
  const state=createState(date);state.reminderSettings.enabled=true;
  const entry=saveTimeEntry(state,{date,start,end,endDate,title:'上课',reminders});
  return {state,entry};
}
test('old ledgers and old tasks remain opted out without changing financial or time data',()=>{
  const s=createState(date);saveActual(s,'meal-0',date,850,date);saveTimeEntry(s,{date,start:'09:00',end:'10:00',title:'旧任务'});
  delete s.reminderSettings;const loaded=readState(JSON.stringify(s));
  assert.deepEqual(loaded.reminderSettings,{enabled:false});assert.deepEqual(loaded.records,s.records);assert.deepEqual(loaded.timeEntries,s.timeEntries);assert.deepEqual(reminderEvents(loaded),[]);
  loaded.reminderSettings.enabled=true;assert.deepEqual(reminderEvents(loaded),[]);
});
test('start and end offsets produce separate five-minute warnings and survive full backup',()=>{
  const {state,entry}=fixture();const events=reminderEvents(state);
  assert.equal(events.length,2);assert.equal(events[0].fireAt,localEntryTime(entry,535));assert.equal(events[1].fireAt,localEntryTime(entry,595));
  assert.deepEqual(readState(JSON.stringify(state)),state);assert.match(reminderMessage(events[0],events[0].fireAt),/5 分钟后开始/);
});
test('overnight warnings use the real end date and do not duplicate the two daily slices',()=>{
  const {state,entry}=fixture('22:00','07:00',{start:5,end:5},'2026-10-26');
  const events=reminderEvents(state);assert.equal(events.length,2);assert.equal(events[1].fireAt,localEntryTime(entry,1855));
  assert.equal(new Date(events[1].fireAt).getDate(),26);
});
test('short-task end warning is clamped to task start, never before it',()=>{
  const {state,entry}=fixture('09:00','09:02');const end=reminderEvents(state).find(e=>e.phase==='end');
  assert.equal(end.fireAt,localEntryTime(entry,540));assert.match(reminderMessage(end,end.fireAt),/2 分钟后结束/);
});
test('editing preserves choice when omitted and supports separately disabling either phase',()=>{
  const {state,entry}=fixture();saveTimeEntry(state,{...entry,start:'09:00',end:'10:00',reminders:undefined,title:'改名'});
  assert.deepEqual(state.timeEntries[0].reminders,{start:5,end:5});
  saveTimeEntry(state,{...entry,start:'09:00',end:'10:00',reminders:{start:null,end:0}});
  assert.deepEqual(reminderEvents(state).map(e=>e.phase),['end']);
});
test('invalid reminder settings fail before any task or finance mutation',()=>{
  const {state,entry}=fixture(),before=structuredClone(state);
  for(const reminders of [null,[],{}, {start:'5',end:5},{start:-1,end:5},{start:5,end:1.2},{start:1441,end:null}]) {
    assert.throws(()=>saveTimeEntry(state,{...entry,start:'09:00',end:'10:00',reminders}),/提醒/);assert.deepEqual(state,before);
  }
  const invalid=structuredClone(state);invalid.timeEntries[0].reminders={start:'5',end:null};assert.throws(()=>readState(JSON.stringify(invalid)),/提醒/);
  invalid.timeEntries=[];invalid.reminderSettings={enabled:'true'};assert.throws(()=>readState(JSON.stringify(invalid)),/提醒/);
});
test('due window ignores old missed reminders, expired warnings and acknowledged events',()=>{
  const {state}=fixture(),[event]=reminderEvents(state),now=event.fireAt;
  assert.equal(dueReminders(state,now-1000,now).length,1);
  assert.equal(dueReminders(state,now,now+1000).length,0);
  assert.equal(dueReminders(state,now-1000,event.expiresAt).some(e=>e.key===event.key),false);
  assert.equal(dueReminders(state,now-1000,now,{[event.key]:now}).length,0);
});
test('changed time or deleted task invalidates the old schedule; rename does not replay a warning',()=>{
  const {state,entry}=fixture(),key=reminderEvents(state)[0].key;
  saveTimeEntry(state,{...entry,start:'09:00',end:'10:00',title:'新名称'});assert.equal(reminderEvents(state)[0].key,key);
  saveTimeEntry(state,{...entry,start:'09:10',end:'10:10'});assert.notEqual(reminderEvents(state)[0].key,key);
  deleteTimeEntry(state,entry.id);assert.deepEqual(reminderEvents(state),[]);
});
test('copy yesterday preserves per-phase options with independent IDs and deduplication',()=>{
  const {state}=fixture('09:00','10:00',{start:null,end:5});copyTimeDay(state,date,'2026-10-26');
  assert.equal(reminderEvents(state).length,2);assert.notEqual(reminderEvents(state)[0].key,reminderEvents(state)[1].key);
  assert.equal(copyTimeDay(state,date,'2026-10-26'),0);assert.deepEqual(state.timeEntries[1].reminders,{start:null,end:5});
});
test('global switch suppresses scheduling without deleting task choices or finance',()=>{
  const {state}=fixture();const before=structuredClone(state.timeEntries);state.reminderSettings.enabled=false;
  assert.deepEqual(reminderEvents(state),[]);assert.deepEqual(state.timeEntries,before);
  state.reminderSettings.enabled=true;assert.equal(reminderEvents(state).length,2);
});
