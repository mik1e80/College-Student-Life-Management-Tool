import test from 'node:test';
import assert from 'node:assert/strict';
import {createState, addCategory, addItem, renameCategory, renameItem, hasItemRecords, canDeleteCategory, deleteCategory, deleteItem, setPlans, saveActual, getPlan, getRecord, readState, summarize, datesInMonth} from '../dist/core.js';
const day = '2026-10-25';

test('renaming preserves IDs, dates, budgets and daily/monthly/yearly actual records', () => {
  const s=createState(day);
  setPlans(s,'2026-10',[['meal-0',800,'day'],['meal-1',3000,'month'],['meal-2',12000,'year']],day);
  for (const [id, value] of [['meal-0',850],['meal-1',2900],['meal-2',11800]]) saveActual(s,id,day,value,day);
  const before=structuredClone(s), totals=summarize(s,datesInMonth('2026-10'));
  renameCategory(s,'food','三餐与会员');
  for (const id of ['meal-0','meal-1','meal-2']) renameItem(s,id,`新${id}`);
  for (const key of ['plans','records','periodPlans','periodRecords','cadences']) assert.deepEqual(s[key],before[key]);
  assert.deepEqual(s.items.map(x=>[x.id,x.categoryId,x.createdOn]),before.items.map(x=>[x.id,x.categoryId,x.createdOn]));
  assert.deepEqual(summarize(s,datesInMonth('2026-10')),totals);
  assert.equal(getPlan(s,'meal-1',day),3000); assert.equal(getRecord(s,'meal-2',day).cents,11800);
  assert.deepEqual(readState(JSON.stringify(s)),s);
});
test('rename validates blanks, length, missing IDs and scoped duplicates atomically', () => {
  const s=createState(day), item=addItem(s,'daily','早餐',day);
  renameItem(s,item.id,' 午餐 '); // Other parent may use the same name.
  renameCategory(s,'food',' 餐饮 '); // Own unchanged name is allowed.
  const before=structuredClone(s);
  for(const name of ['', ' '.repeat(2), '字'.repeat(17)]) {
    assert.throws(()=>renameCategory(s,'food',name)); assert.throws(()=>renameItem(s,'meal-0',name));
  }
  assert.throws(()=>renameCategory(s,'food','生活用品'));
  assert.throws(()=>renameItem(s,'meal-0','午餐'));
  assert.throws(()=>renameCategory(s,'missing','新名称'));
  assert.throws(()=>renameItem(s,'missing','新名称'));
  assert.deepEqual(s,before);
});
test('deleting a budget-only item cleans all budget dates/cadences and preserves others', () => {
  const s=createState(day);
  setPlans(s,'2026-10',[['meal-0',800],['meal-1',1000]],day);
  setPlans(s,'2026-11',[['meal-0',3000,'month']],day);
  setPlans(s,'2027-01',[['meal-0',12000,'year']],day);
  saveActual(s,'meal-1',day,500,day);
  assert.equal(hasItemRecords(s,'meal-0'),false);
  deleteItem(s,'meal-0');
  assert(!s.items.some(x=>x.id==='meal-0'));
  assert(!Object.keys(s.plans).some(x=>x.endsWith(':meal-0')));
  assert(!Object.keys(s.periodPlans).some(x=>x.endsWith(':meal-0')));
  assert(!s.cadences['meal-0']);
  assert.equal(getRecord(s,'meal-1',day).cents,500);
  assert.equal(getPlan(s,'meal-1',day),1000);
  assert.deepEqual(readState(JSON.stringify(s)),s);
});
test('any actual, including zero and historical backfills in every cadence, forbids deletion', () => {
  for(const unit of ['day','month','year']) for(const cents of [0,100]) {
    const s=createState('2025-01-01');
    setPlans(s,'2025-01',[['meal-0',300,unit]],'2025-01-01');
    saveActual(s,'meal-0','2025-01-02',cents,'2026-10-25');
    const before=structuredClone(s);
    assert(hasItemRecords(s,'meal-0')); assert.equal(canDeleteCategory(s,'food'),false);
    assert.throws(()=>deleteItem(s,'meal-0'),/不能删除/);
    assert.throws(()=>deleteCategory(s,'food'),/不能删除/);
    assert.deepEqual(s,before);
  }
});
test('former cadence actuals remain protected after switching to another cadence', () => {
  const s=createState('2026-09-01');
  setPlans(s,'2026-09',[['meal-0',100,'month']],'2026-09-01');
  saveActual(s,'meal-0','2026-09-15',100,'2026-09-15');
  setPlans(s,'2026-10',[['meal-0',100,'day']],day);
  assert.equal(getRecord(s,'meal-0',day),null);
  assert.throws(()=>deleteItem(s,'meal-0'),/不能删除/);
});
test('unused default and custom categories can be deleted with descendants and plans', () => {
  const s=createState(day), category=addCategory(s,'临时分类',day), item=addItem(s,category.id,'临时项目',day);
  setPlans(s,'2026-10',[[item.id,200,'month'],['meal-0',800]],day);
  assert(canDeleteCategory(s,category.id));
  deleteCategory(s,category.id);
  assert(!s.items.some(x=>x.id===item.id)); assert.deepEqual(s.periodPlans,{}); assert.deepEqual(s.cadences,{});
  deleteCategory(s,'food');
  assert(!s.items.length); assert.deepEqual(s.plans,{});
  assert.deepEqual(readState(JSON.stringify(s)),s);
});
test('category deletion checks every child before removing any of them', () => {
  const s=createState(day); setPlans(s,'2026-10',[['meal-0',800]],day);
  saveActual(s,'meal-2',day,0,day);
  const before=structuredClone(s);
  assert.throws(()=>deleteCategory(s,'food'),/不能删除/); assert.deepEqual(s,before);
  assert.throws(()=>deleteCategory(s,'missing')); assert.throws(()=>deleteItem(s,'missing'));
  assert.deepEqual(s,before);
});
test('deletion matches exact IDs and permits an empty ledger to reload and add categories', () => {
  const s=createState(day);
  s.items.push({id:'prefix:meal-0',categoryId:'food',name:'同后缀',createdOn:day});
  saveActual(s,'prefix:meal-0',day,100,day);
  assert.equal(hasItemRecords(s,'meal-0'),false); deleteItem(s,'meal-0');
  assert.equal(getRecord(s,'prefix:meal-0',day).cents,100);
  const empty=createState(day);
  for (const c of [...empty.categories]) deleteCategory(empty,c.id);
  assert.deepEqual(readState(JSON.stringify(empty)),empty);
  const c=addCategory(empty,'重新开始',day); addItem(empty,c.id,'新项目',day);
  assert.equal(empty.items.length,1);
});
