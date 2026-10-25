const DAY = 1440;
export const TIME_PRESETS = ['睡觉', '自由时间', '吃饭时间'];
function checkDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10) !== date) throw Error('日期无效');
}
export function shiftTimeDate(date, offset) {
  checkDate(date);
  const d=new Date(date+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+offset);
  return d.toISOString().slice(0,10);
}
export function parseClock(value) {
  if (value === '24:00') return DAY;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('请选择有效时间，24:00 表示次日零点');
  return Number(value.slice(0,2))*60+Number(value.slice(3));
}
export function clockLabel(minute) {
  return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
}
export function timeSpan(date, start, end, endDate = null) {
  checkDate(date);
  let a=parseClock(start), b=parseClock(end);
  if (endDate === null) {
    if (a===b) throw Error('开始与结束不能相同；全天请选择 00:00 至 24:00');
    if (b<a) b+=DAY;
  } else {
    checkDate(endDate);
    b+=(Date.parse(endDate+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/60000;
    if (b<=a) throw Error('结束日期和时间必须晚于开始日期和时间');
  }
  if (a===DAY) { date=shiftTimeDate(date,1); a=0; b-=DAY; }
  if (b<=a || b-a>DAY) throw Error('时间段须大于 0 且不超过 24 小时');
  return {date,start:a,end:b};
}
const absoluteStart = entry => Date.parse(entry.date+'T00:00:00Z')/60000+entry.start;
const absoluteEnd = entry => Date.parse(entry.date+'T00:00:00Z')/60000+entry.end;
function checkEntry(entry) {
  if (!entry || typeof entry.id!=='string' || !entry.id || typeof entry.title!=='string' || !entry.title.trim() || entry.title.length>24 || !['normal','free'].includes(entry.kind)) throw Error('时间安排名称或类型不正确');
  checkDate(entry.date);
  if (!Number.isInteger(entry.start)||entry.start<0||entry.start>=DAY||!Number.isInteger(entry.end)||entry.end<=entry.start||entry.end>entry.start+DAY) throw Error('单条时间安排须大于 0 且不超过 24 小时');
}
export function validateTimeEntries(entries) {
  if (!Array.isArray(entries)) throw Error('时间安排数据不正确');
  const ids=new Set();
  for(const entry of entries) { checkEntry(entry); if(ids.has(entry.id))throw Error('时间安排 ID 重复'); ids.add(entry.id); }
  const sorted=[...entries].sort((a,b)=>absoluteStart(a)-absoluteStart(b));
  for(let i=1;i<sorted.length;i++) if(absoluteStart(sorted[i])<absoluteEnd(sorted[i-1])) throw Error('时间安排存在重叠');
}
export function saveTimeEntry(state, {id, date, start, end, endDate = null, title, kind='normal'}) {
  if (id && !state.timeEntries.some(e=>e.id===id)) throw Error('这条时间安排已不存在');
  const entry={id:id||globalThis.crypto.randomUUID(),...timeSpan(date,start,end,endDate),title:String(title).trim(),kind};
  checkEntry(entry);
  const next=state.timeEntries.filter(e=>e.id!==entry.id);
  const conflict=next.find(e=>absoluteStart(entry)<absoluteEnd(e)&&absoluteEnd(entry)>absoluteStart(e));
  if(conflict) throw Error(`与「${conflict.title}」时间重叠，请调整开始或结束时间`);
  next.push(entry); next.sort((a,b)=>absoluteStart(a)-absoluteStart(b)); state.timeEntries=next;
  return entry;
}
export function deleteTimeEntry(state,id) {
  if(!state.timeEntries.some(e=>e.id===id)) throw Error('这条时间安排已不存在');
  state.timeEntries=state.timeEntries.filter(e=>e.id!==id);
}
export function dayTimeline(state,date) {
  checkDate(date);
  const base=Date.parse(date+'T00:00:00Z')/60000, parts=[];
  for(const entry of state.timeEntries) {
    const start=Math.max(0,absoluteStart(entry)-base), end=Math.min(DAY,absoluteEnd(entry)-base);
    if(start<end) parts.push({...entry,start,end,fromPrevious:entry.date<date,toNext:absoluteEnd(entry)>base+DAY});
  }
  parts.sort((a,b)=>a.start-b.start);
  const result=[]; let cursor=0;
  for(const part of parts) {
    if(part.start>cursor) result.push({kind:'gap',title:'未规划',start:cursor,end:part.start});
    result.push(part); cursor=part.end;
  }
  if(cursor<DAY)result.push({kind:'gap',title:'未规划',start:cursor,end:DAY});
  return result;
}
export function timeSummary(state,date) {
  const parts=dayTimeline(state,date);
  const gap=parts.filter(x=>x.kind==='gap').reduce((n,x)=>n+x.end-x.start,0);
  const free=parts.filter(x=>x.kind==='free').reduce((n,x)=>n+x.end-x.start,0);
  return {planned:DAY-gap,gap,free};
}
export function copyTimeDay(state,from,to) {
  if(from===to)throw Error('请选择不同的日期');
  const source=dayTimeline(state,from).filter(e=>e.kind!=='gap');
  if(!source.length)throw Error('昨天没有可复制的安排，请先添加时间段');
  const target=dayTimeline(state,to).filter(e=>e.kind!=='gap');
  const additions=[];
  for(const entry of source) {
    if(target.some(e=>e.start===entry.start&&e.end===entry.end&&e.title===entry.title&&e.kind===entry.kind))continue;
    if(target.some(e=>e.start<entry.end&&e.end>entry.start))throw Error('复制内容与当天已有安排冲突，未作任何修改；请先调整冲突时段');
    additions.push({id:globalThis.crypto.randomUUID(),date:to,start:entry.start,end:entry.end,title:entry.title,kind:entry.kind});
  }
  const next=[...state.timeEntries,...additions]; validateTimeEntries(next);
  state.timeEntries=next.sort((a,b)=>absoluteStart(a)-absoluteStart(b)); return additions.length;
}
