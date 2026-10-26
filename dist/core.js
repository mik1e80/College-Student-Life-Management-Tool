import { validateTimeEntries } from './time-core.js';
import { validateAlarms } from './alarms.js';
export const SCHEMA = 3;
export const UNITS = ['day', 'month', 'year'];
export const UNIT_LABELS = { day: '天', month: '月', year: '年' };
export const MAX_CENTS = 99999999;
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = new Date(`${key}T12:00:00`);
  return Number.isFinite(d.getTime()) && dateKey(d) === key;
}
export function datesInMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) throw Error('月份无效');
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
export function shiftMonth(month, offset) {
  const [y, m] = month.split('-').map(Number);
  return dateKey(new Date(y, m - 1 + offset, 1, 12)).slice(0, 7);
}
export function datesInYear(year) {
  if (!/^\d{4}$/.test(String(year))) throw Error('年份无效');
  return Array.from({ length: 12 }, (_, i) => datesInMonth(`${year}-${String(i + 1).padStart(2, '0')}`)).flat();
}
export function getUnit(state, itemId, date) {
  return (state.cadences?.[itemId] || []).filter(change => change.from <= date).at(-1)?.unit || 'day';
}
export function getPeriod(state, itemId, date) {
  if (!validDate(date)) throw Error('日期无效');
  const unit = getUnit(state, itemId, date);
  const start = unit === 'day' ? date : unit === 'month' ? `${date.slice(0, 7)}-01` : `${date.slice(0, 4)}-01-01`;
  const end = unit === 'day' ? date : unit === 'month' ? datesInMonth(date.slice(0, 7)).at(-1) : `${date.slice(0, 4)}-12-31`;
  const change = (state.cadences?.[itemId] || []).filter(x => x.from <= date).at(-1);
  const created = state.items.find(x => x.id === itemId)?.createdOn || start;
  const activeStart = [start, created, change?.from || start].sort().at(-1);
  return { unit, start, end, activeStart, key: `${unit}:${start}:${itemId}`, label: unit === 'day' ? date : unit === 'month' ? date.slice(0, 7) : date.slice(0, 4) };
}
export function parseMoney(value) {
  const text = String(value).trim();
  if (!/^(0|[1-9]\d{0,5})(\.\d{1,2})?$/.test(text)) throw Error('请输入 0～999999.99 的金额，最多两位小数');
  const [whole, part = ''] = text.split('.');
  return Number(whole) * 100 + Number(part.padEnd(2, '0'));
}
function checkCents(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CENTS) throw Error('金额无效');
}
function nameCheck(value) {
  const name = String(value).trim();
  if (!name || name.length > 16) throw Error('名称请输入 1～16 个字');
  return name;
}
function uid() { return globalThis.crypto.randomUUID(); }
export function createState(today = dateKey()) {
  return {
    schema: SCHEMA, revision: 0, createdOn: today,
    categories: [
      ['food', '餐饮', 'utensils', '#faeddf'], ['daily', '生活用品', 'bag', '#e9efdf'],
      ['study', '学习支出', 'book', '#e7edfa'], ['social', '社交娱乐', 'smile', '#f7e7e9'],
      ['digital', '服饰数码', 'headphones', '#efe9f8'], ['transport', '通勤交通', 'bus', '#e3f0ed'],
      ['health', '医疗健康', 'heart', '#fae7e0'], ['other', '其他与备用金', 'box', '#eeeee7']
    ].map(([id, name, icon, color]) => ({ id, name, icon, color, createdOn: today })),
    items: ['早餐', '午餐', '晚餐'].map((name, i) => ({ id: `meal-${i}`, categoryId: 'food', name, createdOn: today })),
    plans: {}, records: {}, cadences: {}, periodPlans: {}, periodRecords: {}, timeEntries: [], reminderSettings: {enabled:false}, alarms: []
  };
}
export function addCategory(state, rawName, today = dateKey()) {
  const name = nameCheck(rawName);
  if (state.categories.some(x => x.name === name)) throw Error('已存在同名大类');
  const category = { id: uid(), name, icon: 'box', color: '#e9efdf', createdOn: today };
  state.categories.push(category); return category;
}
export function addItem(state, categoryId, rawName, today = dateKey()) {
  if (!state.categories.some(x => x.id === categoryId)) throw Error('分类不存在');
  const name = nameCheck(rawName);
  if (state.items.some(x => x.categoryId === categoryId && x.name === name)) throw Error('该大类下已存在同名小类');
  const item = { id: uid(), categoryId, name, createdOn: today };
  state.items.push(item); return item;
}
export function renameCategory(state, id, rawName) {
  const category = state.categories.find(x => x.id === id);
  if (!category) throw Error('大类不存在');
  const name = nameCheck(rawName);
  if (state.categories.some(x => x.id !== id && x.name === name)) throw Error('已存在同名大类');
  category.name = name;
}
export function renameItem(state, id, rawName) {
  const item = state.items.find(x => x.id === id);
  if (!item) throw Error('小类不存在');
  const name = nameCheck(rawName);
  if (state.items.some(x => x.id !== id && x.categoryId === item.categoryId && x.name === name)) throw Error('该大类下已存在同名小类');
  item.name = name;
}
const dailyItemId = key => key.slice(key.indexOf(':') + 1);
const periodItemId = key => key.slice(key.indexOf(':', key.indexOf(':') + 1) + 1);
export function hasItemRecords(state, id) {
  // Presence, including zero and backfills, protects every date and former cadence.
  return Object.keys(state.records).some(key => dailyItemId(key) === id)
    || Object.keys(state.periodRecords || {}).some(key => periodItemId(key) === id);
}
export function canDeleteCategory(state, id) {
  return state.categories.some(x => x.id === id)
    && !state.items.some(x => x.categoryId === id && hasItemRecords(state, x.id));
}
export function deleteItem(state, id) {
  if (!state.items.some(x => x.id === id)) throw Error('小类不存在');
  if (hasItemRecords(state, id)) throw Error('此小类已有实际金额记录（含 0 元），不能删除');
  state.items = state.items.filter(x => x.id !== id);
  for (const key of Object.keys(state.plans)) if (dailyItemId(key) === id) delete state.plans[key];
  for (const key of Object.keys(state.periodPlans || {})) if (periodItemId(key) === id) delete state.periodPlans[key];
  if (state.cadences) delete state.cadences[id];
}
export function deleteCategory(state, id) {
  if (!state.categories.some(x => x.id === id)) throw Error('大类不存在');
  if (!canDeleteCategory(state, id)) throw Error('此大类下已有实际金额记录（含 0 元），不能删除');
  const ids = state.items.filter(x => x.categoryId === id).map(x => x.id);
  for (const itemId of ids) deleteItem(state, itemId);
  state.categories = state.categories.filter(x => x.id !== id);
}
export function itemExists(state, itemId, date) {
  return validDate(date) && state.items.some(x => x.id === itemId && x.createdOn <= date);
}
export function getPlan(state, itemId, date) {
  if (!itemExists(state, itemId, date)) return null;
  const period = getPeriod(state, itemId, date);
  if (period.unit !== 'day') return state.periodPlans?.[period.key]?.at(-1)?.cents ?? null;
  const revisions = state.plans[`${date.slice(0, 7)}:${itemId}`] || [];
  return revisions.filter(x => x.from <= date).at(-1)?.cents ?? null;
}
export function setPlans(state, month, entries, today = dateKey()) {
  const dates = datesInMonth(month);
  if (month < today.slice(0, 7)) throw Error('历史月份的预算已锁定');
  const from = month === today.slice(0, 7) ? today : dates[0];
  const seen = new Set();
  for (const [id, cents, unit = 'day'] of entries) {
    if (!state.items.some(x => x.id === id)) throw Error('小类不存在');
    if (seen.has(id)) throw Error('同一个小类不能重复设置');
    seen.add(id);
    if (!UNITS.includes(unit)) throw Error('请选择按天、按月或按年');
    checkCents(cents);
    if (getUnit(state, id, from) !== unit && getRecord(state, id, from) !== null) throw Error('此小类本期已有实际金额，请在本期结束后更改周期');
  }
  state.cadences ??= {}; state.periodPlans ??= {}; state.periodRecords ??= {};
  for (const [id, cents, unit = 'day'] of entries) {
    if (getUnit(state, id, from) !== unit) {
      const changes = (state.cadences[id] || []).filter(x => x.from !== from);
      changes.push({ from, unit }); changes.sort((a, b) => a.from.localeCompare(b.from));
      state.cadences[id] = changes;
    }
    const period = getPeriod(state, id, from);
    const target = unit === 'day' ? state.plans : state.periodPlans;
    const key = unit === 'day' ? `${month}:${id}` : period.key;
    const revisions = (target[key] || []).filter(x => x.from !== from);
    revisions.push({ from, cents }); revisions.sort((a, b) => a.from.localeCompare(b.from));
    target[key] = revisions;
  }
}
export function getRecord(state, itemId, date) {
  if (!itemExists(state, itemId, date)) return null;
  const period = getPeriod(state, itemId, date);
  return period.unit === 'day' ? state.records[`${date}:${itemId}`] ?? null : state.periodRecords?.[period.key] ?? null;
}
export function saveActual(state, itemId, date, cents, today = dateKey(), at = new Date().toISOString()) {
  if (!itemExists(state, itemId, date)) throw Error('该日期还没有此小类，不能记账');
  const period = getPeriod(state, itemId, date);
  if (period.activeStart > today) throw Error('未来周期不能填写实际金额');
  checkCents(cents);
  const previous = getRecord(state, itemId, date);
  if (period.end < today && previous !== null) throw Error('历史记录已锁定，不能再次修改或补录');
  const target = period.unit === 'day' ? state.records : (state.periodRecords ??= {});
  const key = period.unit === 'day' ? `${date}:${itemId}` : period.key;
  target[key] = {
    cents, firstSavedAt: previous?.firstSavedAt || at, updatedAt: at,
    backfilled: period.end < today || previous?.backfilled || false
  };
}
// Integer allocations add back to exactly the entered period amount, including leap years.
function allocate(cents, index, count) {
  return Math.floor(cents * (index + 1) / count) - Math.floor(cents * index / count);
}
export function summarize(state, dates, { categoryId, itemId } = {}) {
  let planned = 0, actual = 0, pairedPlan = 0, pairedActual = 0, recorded = 0, expected = 0, plannedCells = 0, pairedCells = 0;
  const groups = new Map();
  for (const day of new Set(dates)) for (const item of state.items) {
    if ((categoryId && item.categoryId !== categoryId) || (itemId && item.id !== itemId) || !itemExists(state, item.id, day)) continue;
    const period = getPeriod(state, item.id, day);
    if (!groups.has(period.key)) groups.set(period.key, { item, period, selected: [] });
    groups.get(period.key).selected.push(day);
  }
  for (const { item, period, selected } of groups.values()) {
    expected++;
    const days = period.unit === 'day' ? [period.start] : (period.unit === 'month' ? datesInMonth(period.start.slice(0, 7)) : datesInYear(period.start.slice(0, 4)))
      .filter(day => itemExists(state, item.id, day) && getUnit(state, item.id, day) === period.unit);
    const selectedDay = selected.slice().sort().at(-1);
    const plan = getPlan(state, item.id, selectedDay), record = getRecord(state, item.id, selectedDay);
    let planShare = 0, actualShare = 0;
    for (const day of selected) {
      const index = days.indexOf(day);
      if (plan !== null) planShare += allocate(plan, index, days.length);
      if (record !== null) actualShare += allocate(record.cents, index, days.length);
    }
    if (plan !== null) { planned += planShare; plannedCells++; }
    if (record !== null) { actual += actualShare; recorded++; }
    if (record !== null && plan !== null) { pairedPlan += planShare; pairedActual += actualShare; pairedCells++; }
  }
  return { planned, actual, pairedPlan, pairedActual, difference: pairedPlan - pairedActual, recorded, expected, plannedCells, pairedCells };
}
export function readState(raw) {
  const s = JSON.parse(raw);
  if (![1, 2, SCHEMA].includes(s?.schema) || !Number.isSafeInteger(s.revision) || !validDate(s.createdOn) || !Array.isArray(s.categories) || !Array.isArray(s.items) || !s.plans || typeof s.plans !== 'object' || !s.records || typeof s.records !== 'object') throw Error('数据格式不正确');
  if (s.schema === 1) { s.cadences = {}; s.periodPlans = {}; s.periodRecords = {}; }
  if (!Object.hasOwn(s, 'timeEntries') && s.schema !== SCHEMA) s.timeEntries = [];
  s.schema = SCHEMA;
  validateTimeEntries(s.timeEntries);
  if(!Object.hasOwn(s,'alarms'))s.alarms=[];
  validateAlarms(s.alarms);
  if (!Object.hasOwn(s,'reminderSettings')) s.reminderSettings={enabled:false};
  if (!s.reminderSettings || typeof s.reminderSettings.enabled!=='boolean') throw Error('提醒设置不正确');
  for (const value of [s.cadences, s.periodPlans, s.periodRecords]) if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('周期数据不正确');
  if (s.categories.some(x => !x.id || !x.name || !validDate(x.createdOn)) || s.items.some(x => !x.id || !x.name || !validDate(x.createdOn) || !s.categories.some(c => c.id === x.categoryId))) throw Error('分类数据不正确');
  for (const changes of Object.values(s.cadences)) {
    if (!Array.isArray(changes)) throw Error('周期数据不正确');
    let last = '';
    for (const change of changes) {
      if (!validDate(change.from) || !UNITS.includes(change.unit) || change.from <= last) throw Error('周期日期或类型不正确');
      last = change.from;
    }
  }
  for (const revisions of [...Object.values(s.plans), ...Object.values(s.periodPlans)]) {
    if (!Array.isArray(revisions)) throw Error('计划数据不正确');
    for (const r of revisions) { checkCents(r.cents); if (!validDate(r.from)) throw Error('计划日期不正确'); }
  }
  for (const record of [...Object.values(s.records), ...Object.values(s.periodRecords)]) checkCents(record.cents);
  return s;
}
