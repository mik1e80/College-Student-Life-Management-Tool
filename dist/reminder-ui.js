import {REMINDER_OPTIONS,reminderEvents,dueReminders,reminderMessage} from './reminders.js';
export function reminderSelect(phase,choice) {
  const value=choice===null?'off':String(choice);
  const options=[...new Set([...REMINDER_OPTIONS,choice])];
  return `<label class="field">${phase==='start'?'开始':'结束'}提醒<select id="reminder-${phase}" aria-label="${phase==='start'?'开始':'结束'}提醒">${options.map(n=>`<option value="${n===null?'off':n}" ${String(n===null?'off':n)===value?'selected':''}>${n===null?'不提醒':n===0?'准点提醒':`提前 ${n} 分钟`}</option>`).join('')}</select></label>`;
}
export function createReminderUI({modal,native,load,commit,render,toast,openEntry,escape}) {
  const receiptKey='yiri-reminder-delivered-v1',queue=[];
  let since=Date.now(),busy=false;
  const popup=document.createElement('dialog');popup.id='reminder-dialog';popup.setAttribute('aria-labelledby','reminder-title');document.body.append(popup);
  function nativeStatus() { try{return native?JSON.parse(native.reminderStatus()):null;}catch{return null;} }
  function statusLine() {
    if(!load()?.reminderSettings?.enabled)return '任务提醒未开启';
    const status=nativeStatus();
    return !native?'页面打开时弹窗提醒':!status?'提醒状态暂不可用':!status.notifications?'应用内弹窗已开启，后台通知未允许':!status.exact?'提醒已开启，系统可能延迟':'任务提醒已开启';
  }
  function showSettings() {
    const enabled=!!load()?.reminderSettings?.enabled,status=nativeStatus();
    modal.innerHTML=`<div id="reminder-settings"><div class="modal-top"><h2 id="modal-title">任务提醒</h2><button class="icon-btn" data-dismiss aria-label="关闭">×</button></div><p class="modal-body" role="status">${statusLine()}</p><p class="stat-foot">新任务默认开始前、结束前各 5 分钟；每条任务可单独调整。旧任务需在修改安排时开启。</p>${native?'<p class="stat-foot">后台和锁屏使用系统通知；勿扰、省电设置及系统强行停止可能影响提醒。</p>':'<p class="stat-foot">关闭页面或浏览器休眠后无法保证提醒。后台提醒请安装安卓版本。</p>'}<div class="reminder-actions"><button class="btn primary" id="toggle-reminders">${enabled?'关闭任务提醒':'开启任务提醒'}</button>${native?`${enabled&&!status?.notifications?'<button class="btn" id="allow-notifications">允许通知</button>':''}${enabled&&!status?.exact?'<button class="btn" id="allow-exact">允许准时提醒</button>':''}<button class="btn" id="notification-settings">系统通知设置</button>`:''}</div></div>`;
    modal.querySelector('[data-dismiss]').onclick=()=>modal.close();
    modal.querySelector('#toggle-reminders').onclick=async event=>{
      event.target.disabled=true;
      if(await commit(s=>{s.reminderSettings.enabled=!enabled;})) {
        since=Date.now();if(enabled)queue.length=0;
        render();showSettings();
        if(!enabled&&native)native.requestReminderNotifications();
      }else event.target.disabled=false;
    };
    modal.querySelector('#allow-notifications')?.addEventListener('click',()=>native.requestReminderNotifications());
    modal.querySelector('#allow-exact')?.addEventListener('click',()=>native.openReminderSettings('exact'));
    modal.querySelector('#notification-settings')?.addEventListener('click',()=>native.openReminderSettings('notifications'));
    if(!modal.open)modal.showModal();
  }
  function refreshStatus() { if(modal.querySelector('#reminder-settings'))showSettings(); }
  function showNext() {
    if(!queue.length||popup.open||modal.open||document.hidden)return;
    const current=load(),valid=new Set(reminderEvents(current).map(e=>e.key));
    let event;
    while(queue.length) { const candidate=queue.shift();if(valid.has(candidate.key)&&candidate.expiresAt>Date.now()){event=candidate;break;} }
    if(!event)return;
    popup.innerHTML=`<h2 id="reminder-title">${event.phase==='start'?'任务即将开始':'任务即将结束'}</h2><p class="modal-body">${escape(reminderMessage(event))}</p><div class="modal-actions"><button class="btn" id="dismiss-reminder">知道了</button><button class="btn primary" id="view-reminder">查看安排</button></div>`;
    popup.querySelector('#dismiss-reminder').onclick=()=>popup.close();
    popup.querySelector('#view-reminder').onclick=()=>{popup.close();openEntry(event.date,event.id);};
    popup.showModal();
  }
  popup.addEventListener('close',()=>setTimeout(showNext,0));
  async function tick() {
    if(native||busy||document.hidden)return;
    busy=true;
    try {
      const run=()=>{
        const now=Date.now(),state=load();
        const delivered=JSON.parse(localStorage.getItem(receiptKey)||'{}');
        const due=dueReminders(state,since,now,delivered);since=now;
        if(due.length) {
          for(const key of Object.keys(delivered))if(delivered[key]<now-7*86400000)delete delivered[key];
          for(const event of due)delivered[event.key]=now;
          localStorage.setItem(receiptKey,JSON.stringify(delivered));queue.push(...due);
        }
      };
      if(navigator.locks)await navigator.locks.request(receiptKey,run);else run();
      showNext();
    }catch {toast('提醒暂时无法读取，请检查浏览器存储');}finally{busy=false;}
  }
  // Android uses AlarmManager; it does not need a JavaScript polling timer.
  if(!native)setInterval(()=>{tick();showNext();},1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();refreshStatus();}});
  return {showSettings,statusLine,refreshStatus};
}
