import {readState, validDate, MAX_CENTS, getPeriod} from './core.js';

export const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) && !['__proto__','prototype','constructor'].includes(value);
function requireValue(ok, message) { if (!ok) throw Error(message); }
function validateLedger(s) {
  requireValue(s.revision >= 0, '账本版本无效');
  const categories = new Set(), items = new Map();
  for (const c of s.categories) {
    requireValue(safeId(c.id) && !categories.has(c.id) && typeof c.name === 'string' && c.name.trim() && c.name.length <= 16 && typeof c.icon === 'string', '大类名称或 ID 无效、重复');
    categories.add(c.id);
  }
  for (const i of s.items) {
    requireValue(safeId(i.id) && !items.has(i.id) && categories.has(i.categoryId) && typeof i.name === 'string' && i.name.trim() && i.name.length <= 16, '小类名称、归属或 ID 无效、重复');
    items.set(i.id, i);
  }
  for (const map of [s.plans,s.records,s.periodPlans,s.periodRecords,s.cadences]) requireValue(object(map), '账本记录格式无效');
  for (const [id, changes] of Object.entries(s.cadences)) {
    requireValue(items.has(id), '周期引用了不存在的小类');
    for (const change of changes) requireValue(change.from >= items.get(id).createdOn, '周期早于小类创建日期');
  }
  for (const [map, type, period] of [[s.plans,'plan',false],[s.records,'record',false],[s.periodPlans,'plan',true],[s.periodRecords,'record',true]]) {
    for (const [key, value] of Object.entries(map)) {
      const match = period ? /^(month|year):(\d{4}-\d{2}-\d{2}):([A-Za-z0-9_-]+)$/.exec(key) : /^(\d{4}-\d{2}(?:-\d{2})?):([A-Za-z0-9_-]+)$/.exec(key);
      requireValue(match, '金额记录键格式无效');
      const date = match[period ? 2 : 1], id = match[period ? 3 : 2], item = items.get(id);
      requireValue(item, '金额记录引用了不存在的小类');
      const day = date.length === 7 ? date+'-01' : date;
      requireValue(validDate(day) && (type === 'plan' && !period ? date.length === 7 : date.length === 10), '金额记录日期无效');
      if (period) requireValue(match[1] === 'month' ? date.endsWith('-01') : date.endsWith('-01-01'), '周期起始日期无效');
      if (type === 'plan') {
        let last = '';
        for (const r of value) {
          requireValue(r.from > last && r.from >= item.createdOn, '预算版本日期无效或重复'); last = r.from;
          requireValue(period ? getPeriod({...s,cadences:{[id]:[{from:item.createdOn,unit:match[1]}]}}, id, r.from).start === date : r.from.slice(0,7) === date, '预算日期与周期不一致');
        }
      } else {
        requireValue(object(value) && Number.isSafeInteger(value.cents) && value.cents >= 0 && value.cents <= MAX_CENTS && typeof value.backfilled === 'boolean' && [value.firstSavedAt,value.updatedAt].every(t => typeof t === 'string' && Number.isFinite(Date.parse(t))), '实际金额或保存时间无效');
        requireValue((period ? getPeriod({...s,cadences:{[id]:[{from:item.createdOn,unit:match[1]}]}},id,item.createdOn).start <= date : item.createdOn <= date), '实际金额早于小类创建日期');
      }
    }
  }
  return s;
}
export function makeBackup(ledger, exportedAt = new Date().toISOString()) {
  return JSON.stringify({format:'shuangheng-backup',version:1,exportedAt,ledger},null,2);
}
export function parseBackup(raw) {
  requireValue(typeof raw === 'string' && new TextEncoder().encode(raw).length <= MAX_BACKUP_BYTES, '备份文件不能超过 4 MiB');
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^\uFEFF/,'')); } catch { throw Error('文件不是有效的 JSON 备份'); }
  const wrapped = parsed?.format === 'shuangheng-backup';
  if (wrapped) requireValue(parsed.version === 1 && typeof parsed.exportedAt === 'string' && Number.isFinite(Date.parse(parsed.exportedAt)), '备份版本或导出时间无效');
  let ledger;
  try { ledger = validateLedger(readState(JSON.stringify(wrapped ? parsed.ledger : parsed))); }
  catch (error) { throw Error('备份校验失败：'+error.message); }
  return {ledger, exportedAt:wrapped?parsed.exportedAt:null, categories:ledger.categories.length, items:ledger.items.length, records:Object.keys(ledger.records).length+Object.keys(ledger.periodRecords).length, timeEntries:ledger.timeEntries.length, alarms:ledger.alarms.length};
}
export function restoreBackup(store, backup, expectedRevision) {
  const current = store.load();
  requireValue(current && current.revision === expectedRevision, '当前账本已变化，请重新选择备份并核对');
  const next = parseBackup(makeBackup(backup.ledger)).ledger;
  next.revision = Math.max(current.revision,next.revision)+1;
  requireValue(Number.isSafeInteger(next.revision), '账本版本超出范围，未恢复');
  // Restore data without unexpectedly re-arming old alarms or task reminders.
  next.reminderSettings.enabled = false;
  for (const alarm of next.alarms) { alarm.enabled = false; alarm.generation = crypto.randomUUID(); }
  store.saveRecovery(makeBackup(current));
  store.save(next);
  return next;
}
