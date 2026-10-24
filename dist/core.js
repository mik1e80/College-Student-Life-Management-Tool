export const SCHEMA = 1;
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
    plans: {}, records: {}
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
export function itemExists(state, itemId, date) {
  return validDate(date) && state.items.some(x => x.id === itemId && x.createdOn <= date);
}
export function getPlan(state, itemId, date) {
  if (!itemExists(state, itemId, date)) return null;
  const revisions = state.plans[`${date.slice(0, 7)}:${itemId}`] || [];
  return revisions.filter(x => x.from <= date).at(-1)?.cents ?? null;
}
export function setPlans(state, month, entries, today = dateKey()) {
  const dates = datesInMonth(month);
  if (month < today.slice(0, 7)) throw Error('历史月份的预算已锁定');
  const from = month === today.slice(0, 7) ? today : dates[0];
  for (const [id, cents] of entries) {
    if (!state.items.some(x => x.id === id)) throw Error('小类不存在');
    checkCents(cents);
  }
  for (const [id, cents] of entries) {
    const key = `${month}:${id}`;
    const revisions = (state.plans[key] || []).filter(x => x.from !== from);
    revisions.push({ from, cents }); revisions.sort((a, b) => a.from.localeCompare(b.from));
    state.plans[key] = revisions;
  }
}
export function getRecord(state, itemId, date) { return state.records[`${date}:${itemId}`] ?? null; }
export function saveActual(state, itemId, date, cents, today = dateKey(), at = new Date().toISOString()) {
  if (!itemExists(state, itemId, date)) throw Error('该日期还没有此小类，不能记账');
  if (date > today) throw Error('未来日期不能填写实际金额');
  checkCents(cents);
  const previous = getRecord(state, itemId, date);
  if (date < today && previous !== null) throw Error('历史记录已锁定，不能再次修改或补录');
  state.records[`${date}:${itemId}`] = {
    cents, firstSavedAt: previous?.firstSavedAt || at, updatedAt: at,
    backfilled: date < today || previous?.backfilled || false
  };
}
export function summarize(state, dates, { categoryId, itemId } = {}) {
  let planned = 0, actual = 0, pairedPlan = 0, pairedActual = 0, recorded = 0, expected = 0, plannedCells = 0, pairedCells = 0;
  for (const day of dates) for (const item of state.items) {
    if ((categoryId && item.categoryId !== categoryId) || (itemId && item.id !== itemId) || !itemExists(state, item.id, day)) continue;
    expected++;
    const plan = getPlan(state, item.id, day); const record = getRecord(state, item.id, day);
    if (plan !== null) { planned += plan; plannedCells++; }
    if (record !== null) { actual += record.cents; recorded++; }
    if (record !== null && plan !== null) { pairedPlan += plan; pairedActual += record.cents; pairedCells++; }
  }
  return { planned, actual, pairedPlan, pairedActual, difference: pairedPlan - pairedActual, recorded, expected, plannedCells, pairedCells };
}
export function readState(raw) {
  const s = JSON.parse(raw);
  if (s?.schema !== SCHEMA || !Number.isSafeInteger(s.revision) || !validDate(s.createdOn) || !Array.isArray(s.categories) || !Array.isArray(s.items) || !s.plans || typeof s.plans !== 'object' || !s.records || typeof s.records !== 'object') throw Error('数据格式不正确');
  if (s.categories.some(x => !x.id || !x.name || !validDate(x.createdOn)) || s.items.some(x => !x.id || !x.name || !validDate(x.createdOn) || !s.categories.some(c => c.id === x.categoryId))) throw Error('分类数据不正确');
  for (const revisions of Object.values(s.plans)) {
    if (!Array.isArray(revisions)) throw Error('计划数据不正确');
    for (const r of revisions) { checkCents(r.cents); if (!validDate(r.from)) throw Error('计划日期不正确'); }
  }
  for (const record of Object.values(s.records)) checkCents(record.cents);
  return s;
}
