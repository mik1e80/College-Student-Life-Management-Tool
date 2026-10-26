import {ALARM_DAYS,saveAlarm,toggleAlarm,deleteAlarm,nextAlarmOccurrence,alarmRepeatLabel,dueAlarms} from './alarms.js';
export function createAlarmUI({modal,native,load,commit,refresh,toast,escape:esc}) {
  const cacheKey='shuangheng-alarm-runtime-v1';let since=Date.now(),audio,armed=false,ringing=[],pulse,timeout,busy=false;
  const ring=document.createElement('dialog');ring.id='alarm-ring';ring.setAttribute('aria-labelledby','alarm-ring-title');document.body.append(ring);
  const runtime=()=>JSON.parse(localStorage.getItem(cacheKey)||'{"receipts":{},"snoozes":{}}');
  function status(){try{return native?JSON.parse(native.clockStatus()):{snoozes:runtime().snoozes};}catch{return {snoozes:{}};}}
  const dateLabel=at=>new Date(at).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  function page() {
    const s=load(),permission=status(),now=Date.now();
    const entries=[...s.alarms].sort((a,b)=>a.time.localeCompare(b.time));
    return `<section class="alarm-page wide"><div class="alarm-tools"><button class="btn" data-clock-settings>闹钟设置</button><button class="btn primary" data-add-alarm>＋ 添加闹钟</button></div>${native?(!permission.exact||!permission.notifications?'<p class="alert">请在闹钟设置中允许通知与准时响铃。</p>':'<p class="stat-foot">使用系统闹钟音量 · 可在后台响铃</p>'):`<p class="stat-foot">网页需保持打开；后台和锁屏闹钟请使用安卓版。</p><button class="btn small" data-arm-audio>${armed?'页面响铃已启用':'启用页面响铃'}</button>`}${permission.ringing?'<button class="btn primary alarm-active" data-open-ring>闹钟正在响铃 · 查看</button>':''}<div class="alarm-list">${entries.length?entries.map(a=>{
      const sn=permission.snoozes?.[a.id],next=nextAlarmOccurrence(a,now),snoozed=sn?.generation===a.generation&&sn.at>now;
      const on=a.enabled&&(!!next||snoozed),line=snoozed?`稍后提醒 ${dateLabel(sn.at)}`:next?`下次 ${dateLabel(next.at)}`:'已关闭';
      return `<article class="alarm-card"><div><button class="alarm-time" data-edit-alarm="${esc(a.id)}" aria-label="编辑闹钟 ${a.time}">${a.time}</button><strong>${esc(a.label||'闹钟')}</strong><p>${alarmRepeatLabel(a)}${!a.days.length&&!next&&!snoozed?' · 已结束':''}</p><small>${line}</small>${snoozed?`<button class="text-button" data-cancel-snooze="${esc(a.id)}">取消稍后提醒</button>`:''}</div><button class="alarm-switch ${on?'on':''}" role="switch" aria-checked="${on}" aria-label="${esc(a.label||a.time)}闹钟开关" data-toggle-alarm="${esc(a.id)}" data-enabled="${!on}"><span></span></button></article>`;
    }).join(''):'<div class="empty">还没有闹钟，点击上方添加。</div>'}</div></section>`;
  }
  async function arm() {
    if(native)return;
    try{audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();armed=audio.state==='running';if(!armed)throw Error();refresh();}catch{toast('当前浏览器未允许播放声音，仍可显示闹钟弹窗');}
  }
  function edit(id=null) {
    const a=id?load().alarms.find(a=>a.id===id):null;if(id&&!a){toast('这个闹钟已不存在');return;}
    modal.innerHTML=`<form id="alarm-form"><div class="modal-top"><h2 id="modal-title">${a?'编辑':'添加'}闹钟</h2><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></div><label class="field">闹钟时间<input id="alarm-time" type="time" required value="${a?.time||'07:00'}"></label><label class="field">标签<input id="alarm-label" maxlength="24" placeholder="起床、上课…" value="${esc(a?.label||'')}"></label><div class="alarm-presets"><button type="button" class="btn small" data-days="">仅一次</button><button type="button" class="btn small" data-days="1,2,3,4,5,6,7">每天</button><button type="button" class="btn small" data-days="1,2,3,4,5">工作日</button><button type="button" class="btn small" data-days="6,7">周末</button></div><fieldset class="alarm-days"><legend>每周重复</legend>${ALARM_DAYS.map((d,i)=>`<label><input type="checkbox" value="${i+1}" ${(a?.days||[]).includes(i+1)?'checked':''}>${d}</label>`).join('')}</fieldset><label class="field">稍后提醒<select id="alarm-snooze">${[0,5,10,15].map(n=>`<option value="${n}" ${(a?.snoozeMinutes??10)===n?'selected':''}>${n?n+' 分钟':'关闭'}</option>`).join('')}</select></label><label class="alarm-check"><input id="alarm-vibrate" type="checkbox" ${a?.vibrate!==false?'checked':''}>振动</label><p id="alarm-error" class="form-error" role="alert"></p><div class="modal-actions">${a?'<button type="button" class="btn danger" id="delete-alarm">删除</button>':''}<button type="button" class="btn" data-close>取消</button><button class="btn primary" type="submit">保存闹钟</button></div></form>`;
    const form=modal.querySelector('form');form.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.close());
    form.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>form.querySelectorAll('.alarm-days input').forEach(input=>input.checked=b.dataset.days.split(',').includes(input.value)));
    form.onsubmit=async event=>{
      event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
      const v={id:a?.id,time:form.querySelector('#alarm-time').value,label:form.querySelector('#alarm-label').value,days:[...form.querySelectorAll('.alarm-days input:checked')].map(i=>Number(i.value)),vibrate:form.querySelector('#alarm-vibrate').checked,snoozeMinutes:Number(form.querySelector('#alarm-snooze').value),enabled:true};
      if(await commit(s=>saveAlarm(s,v),error=>form.querySelector('#alarm-error').textContent=error)){modal.close();if(!native)arm();refresh();toast('闹钟已保存');if(native&&!status().notifications)native.requestClockNotifications();}else button.disabled=false;
    };
    form.querySelector('#delete-alarm')?.addEventListener('click',async()=>{if(confirm('确认删除这个闹钟？'))if(await commit(s=>deleteAlarm(s,a.id))){modal.close();refresh();}});
    modal.showModal();
  }
  function settings() {
    const s=status();modal.innerHTML=`<div id="clock-settings"><div class="modal-top"><h2 id="modal-title">闹钟设置</h2><button class="icon-btn" data-close aria-label="关闭">×</button></div>${native?`<p class="modal-body">通知${s.notifications?'已允许':'未允许'} · 准时响铃${s.exact?'已允许':'未允许'}</p><div class="reminder-actions"><button class="btn" id="clock-notifications">${s.notifications?'闹钟通知设置':'允许闹钟通知'}</button>${!s.exact?'<button class="btn primary" id="clock-exact">允许准时响铃</button>':''}${!s.fullScreen?'<button class="btn" id="clock-fullscreen">允许锁屏闹钟界面</button>':''}</div><p class="stat-foot">铃声使用系统闹钟音量。勿扰、省电及强行停止可能影响响铃；单次最多响 5 分钟。</p>`:'<p class="modal-body">网页关闭、休眠或静音后无法保证响铃；后台和锁屏闹钟请安装安卓版。</p>'}</div>`;
    modal.querySelector('[data-close]').onclick=()=>modal.close();
    modal.querySelector('#clock-notifications')?.addEventListener('click',()=>s.notifications?native.openClockSettings('notifications'):native.requestClockNotifications());
    modal.querySelector('#clock-exact')?.addEventListener('click',()=>native.openClockSettings('exact'));
    modal.querySelector('#clock-fullscreen')?.addEventListener('click',()=>native.openClockSettings('full-screen'));
    if(!modal.open)modal.showModal();
  }
  function bind(root) {
    root.querySelector('[data-add-alarm]')?.addEventListener('click',()=>edit());root.querySelector('[data-clock-settings]')?.addEventListener('click',settings);
    root.querySelector('[data-arm-audio]')?.addEventListener('click',arm);root.querySelector('[data-open-ring]')?.addEventListener('click',()=>native.openRingingClock());
    root.querySelectorAll('[data-edit-alarm]').forEach(b=>b.onclick=()=>edit(b.dataset.editAlarm));
    root.querySelectorAll('[data-toggle-alarm]').forEach(b=>b.onclick=async()=>{b.disabled=true;if(await commit(s=>toggleAlarm(s,b.dataset.toggleAlarm,b.dataset.enabled==='true'))){if(!native)arm();refresh();}else b.disabled=false;});
    root.querySelectorAll('[data-cancel-snooze]').forEach(b=>b.onclick=()=>{if(native)native.cancelClockSnooze(b.dataset.cancelSnooze);else{const data=runtime();delete data.snoozes[b.dataset.cancelSnooze];localStorage.setItem(cacheKey,JSON.stringify(data));}refresh();});
  }
  function silence(){clearInterval(pulse);pulse=null;clearTimeout(timeout);if(ring.open)ring.close();ringing=[];refresh();}
  function showRing(events) {
    ringing.push(...events);ring.innerHTML=`<h2 id="alarm-ring-title">闹钟响了</h2><p class="alarm-ring-label">${ringing.map(e=>esc(e.alarm.label||e.alarm.time)).join('、')}</p><div class="modal-actions">${ringing.some(e=>e.alarm.snoozeMinutes)?'<button class="btn" id="web-snooze">稍后提醒</button>':''}<button class="btn primary" id="web-dismiss">停止</button></div>`;
    ring.querySelector('#web-dismiss').onclick=silence;
    ring.querySelector('#web-snooze')?.addEventListener('click',()=>{const data=runtime(),now=Date.now();for(const {alarm} of ringing)if(alarm.snoozeMinutes){const at=now+alarm.snoozeMinutes*60000;data.snoozes[alarm.id]={generation:alarm.generation,at,key:`snooze|${alarm.id}|${alarm.generation}|${at}`};}localStorage.setItem(cacheKey,JSON.stringify(data));silence();});
    ring.oncancel=event=>{event.preventDefault();silence();};if(!ring.open)ring.showModal();
    if(!pulse)pulse=setInterval(()=>{if(armed&&audio?.state==='running'){const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=880;gain.gain.value=.15;oscillator.connect(gain).connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.4);}},1000);
    clearTimeout(timeout);timeout=setTimeout(silence,300000);
  }
  if(!native)setInterval(async()=>{
    if(busy||document.hidden)return;busy=true;
    try{const run=()=>{const now=Date.now(),s=load(),data=runtime();const due=dueAlarms(s,since,now,data.receipts,data.snoozes);since=now;
      for(const k of Object.keys(data.receipts))if(data.receipts[k]<now-8*86400000)delete data.receipts[k];
      for(const e of due){data.receipts[e.key]=now;delete data.snoozes[e.alarm.id];}if(due.length){localStorage.setItem(cacheKey,JSON.stringify(data));showRing(due);}
      if(ringing.length&&!ringing.some(e=>s.alarms.some(a=>a.id===e.alarm.id&&a.generation===e.alarm.generation&&a.enabled)))silence();};
      if(navigator.locks)await navigator.locks.request(cacheKey,run);else run();
    }catch{toast('闹钟状态暂时无法读取');}finally{busy=false;}
  },1000);
  return {page,bind,settings,refreshStatus:()=>{if(modal.querySelector('#clock-settings'))settings();refresh();}};
}
