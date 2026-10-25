import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,readState,saveActual,setPlans} from '../dist/core.js';
import {parseClock,timeSpan,dayTimeline,timeSummary,saveTimeEntry,deleteTimeEntry,copyTimeDay,shiftTimeDate} from '../dist/time-core.js';
const date='2026-10-25';
const add=(s,start,end,title='睡觉',kind='normal',day=date)=>saveTimeEntry(s,{date:day,start,end,title,kind});

test('clock boundaries, zero length and midnight normalization are explicit',()=>{
  assert.equal(parseClock('00:00'),0); assert.equal(parseClock('23:59'),1439); assert.equal(parseClock('24:00'),1440);
  for(const value of ['24:01','25:00','12:60','8:00','-1',''])assert.throws(()=>parseClock(value));
  assert.deepEqual(timeSpan(date,'24:00','07:00'),{date:'2026-10-26',start:0,end:420});
  assert.deepEqual(timeSpan(date,'23:00','07:00'),{date,start:1380,end:1860});
  assert.deepEqual(timeSpan(date,'00:00','24:00'),{date,start:0,end:1440});
  const full=createState(date); add(full,'00:00','24:00','自由时间','free');
  assert.deepEqual(timeSummary(full,date),{planned:1440,gap:0,free:1440});
  assert.throws(()=>timeSpan(date,'08:00','08:00')); assert.throws(()=>timeSpan(date,'24:00','00:00')); assert.throws(()=>timeSpan('2026-02-30','08:00','09:00'));
  assert.equal(shiftTimeDate('2028-02-28',1),'2028-02-29');
});
test('day timeline covers all 1440 minutes with leading, inner and trailing gaps',()=>{
  const s=createState(date); add(s,'08:00','09:00','上课'); add(s,'12:00','13:00','自由时间','free');
  assert.deepEqual(dayTimeline(s,date).map(e=>[e.kind,e.start,e.end]),[['gap',0,480],['normal',480,540],['gap',540,720],['free',720,780],['gap',780,1440]]);
  assert.deepEqual(timeSummary(s,date),{planned:120,gap:1320,free:60});
  assert.equal(dayTimeline(s,'2026-10-26')[0].end,1440);
});
test('cross-midnight event appears on both dates with correct duration and continuation labels',()=>{
  const s=createState(date); const e=add(s,'23:00','07:00');
  assert.equal(dayTimeline(s,date).at(-1).toNext,true);
  assert.equal(dayTimeline(s,'2026-10-26')[0].fromPrevious,true);
  assert.equal(timeSummary(s,date).planned,60); assert.equal(timeSummary(s,'2026-10-26').planned,420);
  assert.equal(timeSummary(s,date).planned+timeSummary(s,'2026-10-26').planned,e.end-e.start);
});
test('overlaps including adjacent dates are rejected atomically but touching edges work',()=>{
  const s=createState(date); add(s,'23:00','07:00'); const before=structuredClone(s);
  assert.throws(()=>add(s,'06:30','08:00','上课','normal','2026-10-26'),/重叠/); assert.deepEqual(s,before);
  add(s,'07:00','08:00','吃饭时间','normal','2026-10-26'); add(s,'22:00','23:00','自由时间','free');
  assert.equal(s.timeEntries.length,3);
});
test('editing keeps the event ID, validates name and type, and cannot overwrite other events',()=>{
  const s=createState(date), a=add(s,'08:00','09:00','上课'); add(s,'10:00','11:00','复习');
  saveTimeEntry(s,{id:a.id,date,start:'07:00',end:'09:30',title:'自习',kind:'normal'});
  const before=structuredClone(s);
  assert.throws(()=>saveTimeEntry(s,{id:a.id,date,start:'09:00',end:'10:30',title:'冲突'}));
  for(const value of [{title:''},{title:'字'.repeat(25)},{kind:'gap'},{id:'missing'}])assert.throws(()=>saveTimeEntry(s,{id:a.id,date,start:'07:00',end:'08:00',title:'标题',...value}));
  assert.deepEqual(s,before); assert.equal(s.timeEntries[0].id,a.id);
});
test('time entries, including past ones, can be deleted without altering finance',()=>{
  const s=createState(date); saveActual(s,'meal-0',date,850,date); setPlans(s,'2026-10',[['meal-0',800]],date);
  const before=structuredClone(s); const e=add(s,'00:00','24:00','自由时间','free','2025-01-01');
  deleteTimeEntry(s,e.id); assert.deepEqual(s,before); assert.throws(()=>deleteTimeEntry(s,e.id));
});
test('copy yesterday uses visible daily segments and reuses identical overnight carryover',()=>{
  const s=createState(date); add(s,'00:00','07:00'); add(s,'12:00','13:00','自由时间','free'); add(s,'23:00','07:00');
  assert.equal(copyTimeDay(s,date,'2026-10-26'),2);
  assert.deepEqual(timeSummary(s,'2026-10-26'),{planned:540,gap:900,free:60});
  assert.equal(copyTimeDay(s,date,'2026-10-26'),0);
  assert.equal(timeSummary(s,'2026-10-27').planned,0);
});
test('copy conflicts and empty source are rejected without partial changes',()=>{
  const s=createState(date); add(s,'08:00','09:00','课程'); add(s,'12:00','13:00','午餐'); add(s,'12:30','13:30','社团','normal','2026-10-26');
  const before=structuredClone(s); assert.throws(()=>copyTimeDay(s,date,'2026-10-26'),/冲突/); assert.deepEqual(s,before);
  assert.throws(()=>copyTimeDay(s,'2026-10-24',date)); assert.throws(()=>copyTimeDay(s,date,date));
});
test('schema 1 and 2 ledgers upgrade without changing any financial history',()=>{
  const s=createState(date); saveActual(s,'meal-0',date,850,date);
  for(const schema of [1,2]) {
    const old=structuredClone(s); old.schema=schema; delete old.timeEntries;
    if(schema===1){delete old.cadences;delete old.periodPlans;delete old.periodRecords;}
    const up=readState(JSON.stringify(old)); assert.equal(up.schema,3); assert.deepEqual(up.records,s.records); assert.deepEqual(up.plans,s.plans); assert.deepEqual(up.timeEntries,[]);
  }
});
test('backup roundtrip preserves timelines and rejects corrupted or overlapping time records',()=>{
  const s=createState(date); add(s,'08:00','09:00','上课'); assert.deepEqual(readState(JSON.stringify(s)),s);
  for(const change of [x=>{delete x.timeEntries;},x=>{x.timeEntries[0].end=2000;},x=>{x.timeEntries[0].date='2026-02-30';},x=>{x.timeEntries.push({...x.timeEntries[0],id:'other'});},x=>{x.timeEntries.push({...x.timeEntries[0]});}]) {
    const bad=structuredClone(s); change(bad); assert.throws(()=>readState(JSON.stringify(bad)));
  }
});

test('explicit next-day end date saves 22:00 to 07:00 as one nine-hour sleep',()=>{
  const s=createState(date);
  const entry=saveTimeEntry(s,{date,start:'22:00',endDate:'2026-10-26',end:'07:00',title:'睡觉'});
  assert.deepEqual([entry.date,entry.start,entry.end],[date,1320,1860]);
  assert.equal(timeSummary(s,date).planned,120);assert.equal(timeSummary(s,'2026-10-26').planned,420);
  assert.equal(entry.end-entry.start,540);
});
test('explicit same-day earlier end and invalid dates are rejected instead of inferred',()=>{
  const s=createState(date), before=structuredClone(s);
  for(const endDate of [date,'2026-10-24','2026-02-30',''])assert.throws(()=>saveTimeEntry(s,{date,start:'22:00',endDate,end:'07:00',title:'睡觉'}));
  assert.deepEqual(s,before);
  assert.deepEqual(timeSpan(date,'22:00','07:00'),{date,start:1320,end:1860});
});
test('explicit end dates support full 24-hour periods and calendar boundaries',()=>{
  assert.deepEqual(timeSpan(date,'08:00','08:00','2026-10-26'),{date,start:480,end:1920});
  assert.deepEqual(timeSpan('2028-02-29','22:00','07:00','2028-03-01'),{date:'2028-02-29',start:1320,end:1860});
  assert.deepEqual(timeSpan('2026-12-31','22:00','07:00','2027-01-01'),{date:'2026-12-31',start:1320,end:1860});
  assert.throws(()=>timeSpan(date,'08:00','08:01','2026-10-26'),/24/);
});
test('explicit-date editing preserves old overnight IDs and still protects adjacent-day conflicts',()=>{
  const s=createState(date), old=add(s,'23:00','07:00');
  saveTimeEntry(s,{id:old.id,date,start:'22:00',endDate:'2026-10-26',end:'07:00',title:'睡觉'});
  assert.equal(s.timeEntries[0].id,old.id);
  const before=structuredClone(s);
  assert.throws(()=>saveTimeEntry(s,{date:'2026-10-26',start:'06:00',endDate:'2026-10-26',end:'08:00',title:'早饭'}),/重叠/);
  assert.deepEqual(s,before);assert.deepEqual(readState(JSON.stringify(s)),s);
});
