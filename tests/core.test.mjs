import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, parseMoney, setPlans, getPlan, saveActual, getRecord, addCategory, addItem, summarize, datesInMonth, dateKey, shiftMonth, readState } from '../dist/core.js';
const start = '2026-10-20';

test('eight initial categories and only three meals are created', () => {
  const s = createState(start);
  assert.equal(s.categories.length, 8);
  assert.deepEqual(s.items.map(x => x.name), ['早餐', '午餐', '晚餐']);
});
test('amount parsing is exact in integer cents, including zero', () => {
  assert.equal(parseMoney('0'), 0); assert.equal(parseMoney('0.1'), 10);
  assert.equal(parseMoney('19.99'), 1999); assert.equal(parseMoney('999999.99'), 99999999);
  for (const value of ['', '-1', '1.234', '1e2', 'NaN', 'Infinity', '1000000', '01', '1.']) assert.throws(() => parseMoney(value));
});
test('changing a current plan retains prior days and uses exact month boundaries', () => {
  const s = createState(start);
  setPlans(s, '2026-10', [['meal-0', 800]], start);
  setPlans(s, '2026-10', [['meal-0', 1000]], '2026-10-25');
  assert.equal(getPlan(s, 'meal-0', '2026-10-19'), null);
  assert.equal(getPlan(s, 'meal-0', '2026-10-20'), 800);
  assert.equal(getPlan(s, 'meal-0', '2026-10-24'), 800);
  assert.equal(getPlan(s, 'meal-0', '2026-10-25'), 1000);
  assert.equal(getPlan(s, 'meal-0', '2026-10-31'), 1000);
  assert.equal(getPlan(s, 'meal-0', '2026-11-01'), null);
  assert.equal(summarize(s, datesInMonth('2026-10'), { itemId: 'meal-0' }).planned, 5 * 800 + 7 * 1000);
  assert.throws(() => setPlans(s, '2026-09', [['meal-0', 200]], '2026-10-25'));
});
test('same-day plan updates replace only that day effective revision', () => {
  const s = createState(start);
  setPlans(s, '2026-10', [['meal-0', 800]], start);
  setPlans(s, '2026-10', [['meal-0', 900]], start);
  assert.equal(s.plans['2026-10:meal-0'].length, 1);
  assert.equal(getPlan(s, 'meal-0', start), 900);
});
test('future month plan begins on the first and is separate from current month', () => {
  const s = createState(start);
  setPlans(s, '2026-11', [['meal-0', 500]], start);
  assert.equal(getPlan(s, 'meal-0', '2026-11-01'), 500);
  assert.equal(summarize(s, datesInMonth('2026-11'), { itemId: 'meal-0' }).planned, 15000);
  assert.equal(getPlan(s, 'meal-0', '2026-10-31'), null);
});
test('plan validation is atomic for invalid entries', () => {
  const s = createState(start);
  assert.throws(() => setPlans(s, '2026-10', [['meal-0', 100], ['meal-1', -1]], start));
  assert.deepEqual(s.plans, {});
});
test('today can be revised; midnight locks a filled record without background jobs', () => {
  const s = createState(start);
  saveActual(s, 'meal-0', start, 800, start);
  saveActual(s, 'meal-0', start, 900, start);
  assert.equal(getRecord(s, 'meal-0', start).cents, 900);
  assert.throws(() => saveActual(s, 'meal-0', start, 1000, '2026-10-21'), /锁定/);
  assert.equal(getRecord(s, 'meal-0', '2026-10-21'), null);
});
test('a historical blank can be backfilled once, and zero counts as filled', () => {
  const s = createState(start);
  saveActual(s, 'meal-0', start, 0, '2026-10-25', '2026-10-25T02:00:00Z');
  const record = getRecord(s, 'meal-0', start);
  assert.equal(record.cents, 0); assert.equal(record.backfilled, true);
  assert.equal(record.firstSavedAt, '2026-10-25T02:00:00Z');
  assert.throws(() => saveActual(s, 'meal-0', start, 200, '2026-10-25'));
});
test('cannot record future dates, invalid dates, or days before an item existed', () => {
  const s = createState(start);
  for (const day of ['2026-10-26', '2026-10-19', '2026-02-30']) assert.throws(() => saveActual(s, 'meal-0', day, 100, '2026-10-25'));
});
test('missing differs from zero and comparisons only use matched records', () => {
  const s = createState(start);
  setPlans(s, '2026-10', [['meal-0', 800], ['meal-1', 1200], ['meal-2', 1000]], start);
  saveActual(s, 'meal-0', start, 0, start);
  let sum = summarize(s, [start]);
  assert.equal(sum.actual, 0); assert.equal(sum.recorded, 1); assert.equal(sum.expected, 3);
  assert.equal(sum.planned, 3000); assert.equal(sum.difference, 800);
  saveActual(s, 'meal-1', start, 1500, start);
  sum = summarize(s, [start]); assert.equal(sum.difference, 500); assert.equal(sum.actual, 1500);
});
test('unplanned spending is included in actual totals and excluded from paired difference', () => {
  const s = createState(start);
  setPlans(s, '2026-10', [['meal-1', 1000]], start);
  saveActual(s, 'meal-0', start, 900, start);
  const sum = summarize(s, [start]);
  assert.equal(sum.actual, 900); assert.equal(sum.pairedActual, 0); assert.equal(sum.difference, 0); assert.equal(sum.pairedCells, 0);
});
test('custom categories and items preserve existing history and reject duplicates', () => {
  const s = createState(start);
  const c = addCategory(s, '兴趣爱好', '2026-10-25');
  const item = addItem(s, c.id, '摄影', '2026-10-25');
  assert.equal(s.categories.length, 9); assert.equal(s.items.length, 4);
  assert.equal(summarize(s, [start]).expected, 3);
  assert.throws(() => addCategory(s, ' 餐饮 ', start));
  assert.throws(() => addItem(s, 'food', '早餐', start));
  assert.throws(() => addItem(s, 'missing', '零食', start));
  assert.throws(() => saveActual(s, item.id, start, 100, '2026-10-25'));
});
test('local dates, leap years, and year transitions are correct', () => {
  assert.equal(dateKey(new Date(2026, 9, 25, 0, 0, 1)), '2026-10-25');
  assert.equal(datesInMonth('2028-02').length, 29);
  assert.equal(datesInMonth('2026-02').length, 28);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.throws(() => datesInMonth('2026-13'));
});
test('persisted state roundtrips and rejects corrupt records', () => {
  const s = createState(start); saveActual(s, 'meal-0', start, 100, start);
  assert.deepEqual(readState(JSON.stringify(s)), s);
  assert.throws(() => readState('{"schema":22}'));
  s.records[`${start}:meal-0`].cents = -1;
  assert.throws(() => readState(JSON.stringify(s)));
});
