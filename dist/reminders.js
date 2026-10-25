// Entries store local wall-clock dates; financial records are never changed by reminders.
export const REMINDER_OPTIONS = [null,0,1,5,10,15,30,60];
export function localEntryTime(entry, minute) {
  const [year,month,day]=entry.date.split('-').map(Number);
  return new Date(year,month-1,day,0,minute,0,0).getTime();
}
export function reminderEvents(state) {
  if(!state.reminderSettings?.enabled)return [];
  return state.timeEntries.flatMap(entry=>['start','end'].flatMap(phase=>{
    const lead=entry.reminders?.[phase];
    if(!Number.isInteger(lead)||lead<0||lead>1440)return [];
    const start=localEntryTime(entry,entry.start), boundary=localEntryTime(entry,entry[phase]);
    // A short task's end warning cannot precede the task itself.
    const fireAt=phase==='end'?Math.max(start,boundary-lead*60000):boundary-lead*60000;
    return [{key:[entry.id,entry.date,entry.start,entry.end,phase,lead].join('|'),id:entry.id,date:entry.date,title:entry.title,phase,lead,fireAt,boundary,expiresAt:boundary+60000}];
  })).sort((a,b)=>a.fireAt-b.fireAt||a.key.localeCompare(b.key));
}
export function dueReminders(state,since,now,delivered={}) {
  return reminderEvents(state).filter(e=>e.fireAt>since && e.fireAt<=now && e.expiresAt>now && !Object.hasOwn(delivered,e.key));
}
export function reminderMessage(event,now=Date.now()) {
  const minutes=Math.max(0,Math.ceil((event.boundary-now)/60000));
  return `${event.title} · ${minutes ? minutes+' 分钟后' : '现在'}${event.phase==='start'?'开始':'结束'}`;
}
