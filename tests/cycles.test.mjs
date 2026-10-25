import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, datesInMonth, datesInYear, getPeriod, getUnit, getPlan, getRecord, readState, saveActual, setPlans, summarize } from '../dist/core.js';

test('monthly subscription is entered once and is not multiplied by days', () => {
  const s = createState('2026-01-01');
  setPlans(s, '2026-01', [['meal-0', 3000, 'month']], '2026-01-01');
  saveActual(s, 'meal-0', '2026-01-18', 2500, '2026-01-18');
  assert.equal(getUnit(s, 'meal-0', '2026-01-31'), 'month');
  assert.equal(getPlan(s, 'meal-0', '2026-01-31'), 3000);
  assert.equal(getRecord(s, 'meal-0', '2026-01-02').cents, 2500);
  const sum = summarize(s, datesInMonth('2026-01'), { itemId: 'meal-0' });
  assert.equal(sum.planned, 3000); assert.equal(sum.actual, 2500); assert.equal(sum.difference, 500);
  assert.equal(sum.expected, 1); assert.equal(sum.recorded, 1);
  assert.equal(Object.keys(s.periodRecords).length, 1);
  assert.equal(getPlan(s, 'meal-0', '2026-02-01'), null);
  assert.equal(getRecord(s, 'meal-0', '2026-02-01'), null);
  assert.equal(getUnit(s, 'meal-0', '2026-02-01'), 'month');
});
test('monthly actual is adjustable inside its month and locks at the next month', () => {
  const s = createState('2026-01-01');
  setPlans(s, '2026-01', [['meal-0', 3000, 'month']], '2026-01-01');
  saveActual(s, 'meal-0', '2026-01-05', 2000, '2026-01-05');
  saveActual(s, 'meal-0', '2026-01-28', 2800, '2026-01-28');
  assert.equal(getRecord(s, 'meal-0', '2026-01-01').cents, 2800);
  assert.throws(() => saveActual(s, 'meal-0', '2026-01-20', 0, '2026-02-01'), /锁定/);
});
test('historical monthly blank permits exactly one backfill, including zero', () => {
  const s = createState('2026-01-01');
  setPlans(s, '2026-01', [['meal-0', 3000, 'month']], '2026-01-01');
  saveActual(s, 'meal-0', '2026-01-18', 0, '2026-03-01');
  assert.equal(getRecord(s, 'meal-0', '2026-01-31').backfilled, true);
  assert.throws(() => saveActual(s, 'meal-0', '2026-01-02', 100, '2026-03-01'));
  assert.equal(summarize(s, datesInMonth('2026-01'), {itemId:'meal-0'}).recorded, 1);
});
test('yearly budget and actual each appear once and allocations sum exactly in a leap year', () => {
  const s = createState('2028-01-01');
  setPlans(s, '2028-01', [['meal-0', 12001, 'year']], '2028-01-01');
  saveActual(s, 'meal-0', '2028-03-10', 10003, '2028-03-10');
  const sum = summarize(s, datesInYear('2028'), {itemId:'meal-0'});
  assert.equal(sum.expected, 1); assert.equal(sum.recorded, 1);
  assert.equal(sum.planned, 12001); assert.equal(sum.actual, 10003); assert.equal(sum.difference, 1998);
  assert.equal(getPlan(s, 'meal-0', '2028-12-31'), 12001);
  assert.equal(getRecord(s, 'meal-0', '2028-11-10').cents, 10003);
  const months = Array.from({length:12}, (_,i) => summarize(s, datesInMonth(`2028-${String(i+1).padStart(2,'0')}`), {itemId:'meal-0'}));
  assert.equal(months.reduce((sum,x) => sum+x.planned, 0), 12001);
  assert.equal(months.reduce((sum,x) => sum+x.actual, 0), 10003);
  assert.equal(getPlan(s, 'meal-0', '2029-01-01'), null);
  assert.equal(getRecord(s, 'meal-0', '2029-01-01'), null);
});
test('yearly record locks only at year rollover and backfill is once per year', () => {
  const s = createState('2026-01-01');
  setPlans(s, '2026-01', [['meal-0', 12000, 'year']], '2026-01-01');
  saveActual(s, 'meal-0', '2026-02-01', 10000, '2026-02-01');
  saveActual(s, 'meal-0', '2026-09-01', 11000, '2026-09-01');
  assert.throws(() => saveActual(s, 'meal-0', '2026-04-01', 0, '2027-01-01'));
  setPlans(s, '2027-01', [['meal-0', 12000, 'year']], '2027-01-01');
  saveActual(s, 'meal-0', '2027-08-01', 5000, '2028-01-01');
  assert.throws(() => saveActual(s, 'meal-0', '2027-01-01', 6000, '2028-01-01'));
});
test('switching after daily history preserves it and allocates only active remaining days', () => {
  const s = createState('2026-10-20');
  setPlans(s, '2026-10', [['meal-0', 800]], '2026-10-20');
  saveActual(s, 'meal-0', '2026-10-20', 800, '2026-10-20');
  const original = structuredClone(s.records);
  setPlans(s, '2026-10', [['meal-0', 3500, 'month']], '2026-10-25');
  saveActual(s, 'meal-0', '2026-10-25', 3000, '2026-10-25');
  assert.deepEqual(s.records, original);
  assert.equal(getUnit(s, 'meal-0', '2026-10-24'), 'day');
  assert.equal(getRecord(s, 'meal-0', '2026-10-20').cents, 800);
  assert.equal(getPeriod(s, 'meal-0', '2026-10-25').activeStart, '2026-10-25');
  const sum = summarize(s, datesInMonth('2026-10'), {itemId:'meal-0'});
  assert.equal(sum.planned, 7500); assert.equal(sum.actual, 3800); assert.equal(sum.expected, 6); assert.equal(sum.recorded, 2);
});
test('a filled current period blocks cycle changes atomically, including future changes inside a year', () => {
  const s = createState('2026-01-01');
  setPlans(s, '2026-01', [['meal-0', 12000, 'year']], '2026-01-01');
  saveActual(s, 'meal-0', '2026-01-01', 10000, '2026-01-01');
  const original = structuredClone(s);
  assert.throws(() => setPlans(s, '2026-11', [['meal-1', 200], ['meal-0', 3000, 'month']], '2026-10-25'), /已有实际/);
  assert.deepEqual(s, original);
  setPlans(s, '2027-01', [['meal-0', 3000, 'month']], '2026-10-25');
  assert.equal(getUnit(s, 'meal-0', '2026-12-31'), 'year');
  assert.equal(getUnit(s, 'meal-0', '2027-01-01'), 'month');
});
test('future cadence cannot be used to prefill actual even within the current calendar year', () => {
  const s = createState('2026-10-01');
  setPlans(s, '2026-11', [['meal-0', 10000, 'year']], '2026-10-25');
  assert.throws(() => saveActual(s, 'meal-0', '2026-11-01', 10000, '2026-10-25'), /未来/);
});
test('old schema migrates without changing budget cents, record cents, dates, or locks', () => {
  const old = createState('2026-10-20');
  setPlans(old, '2026-10', [['meal-0', 800]], '2026-10-20');
  saveActual(old, 'meal-0', '2026-10-20', 950, '2026-10-20');
  old.schema = 1; delete old.cadences; delete old.periodPlans; delete old.periodRecords;
  const upgraded = readState(JSON.stringify(old));
  assert.equal(upgraded.schema, 3);
  assert.deepEqual(upgraded.records, old.records); assert.deepEqual(upgraded.plans, old.plans);
  assert.equal(getUnit(upgraded, 'meal-0', '2026-10-20'), 'day');
  assert.throws(() => saveActual(upgraded, 'meal-0', '2026-10-20', 1, '2026-10-25'));
});
test('invalid cycle input and corrupt persisted cadence are rejected', () => {
  const s = createState('2026-01-01');
  assert.throws(() => setPlans(s, '2026-01', [['meal-0', 1000, 'week']], '2026-01-01'));
  assert.equal(Object.keys(s.plans).length, 0);
  s.cadences['meal-0'] = [{from:'2026-01-01',unit:'week'}];
  assert.throws(() => readState(JSON.stringify(s)));
});
