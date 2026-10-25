import { createState, readState, dateKey, datesInMonth, shiftMonth, parseMoney, addCategory, addItem, getPlan, setPlans, getRecord, saveActual, summarize, itemExists, UNITS, UNIT_LABELS, getUnit, getPeriod, datesInYear } from './core.js';

const KEY = 'yiri-campus-life-v1';
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const isAndroidApp = location.origin === 'https://appassets.androidplatform.net' && typeof window.AndroidApp?.isNative === 'function' && window.AndroidApp.isNative();
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  book: '<path d="M4 4h7v16H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm7 0h9a2 2 0 0 1 2 2v12a2 2 0 0 0-2 2h-9M6 8h2m7 0h3m-3 4h3"/>',
  chart: '<path d="M4 3v18h17M8 16v-5m5 5V6m5 10V9"/>',
  settings: '<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  utensils: '<path d="M5 3v7m3-7v7m3-7v7M5 7h6m-6 3a3 3 0 0 0 6 0M8 13v8M19 3c-3 2-4 5-4 10h5M20 3v18"/>',
  bag: '<path d="M5 7h14l2 14H3L5 7Zm3 0V5a4 4 0 0 1 8 0v2M8 11v1m8-1v1"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c2 3 6 3 8 0M8 9h.01M16 9h.01"/>',
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h5v-7H4Zm16 0h1v7h-5v-7h4Z"/>',
  bus: '<rect x="4" y="3" width="16" height="16" rx="3"/><path d="M4 11h16M8 6h8M7 19v2m10-2v2M8 15h.01M16 15h.01"/>',
  heart: '<path d="M20 5c-2-3-6-2-8 1C10 3 6 2 4 5-1 12 12 21 12 21S25 12 20 5Z"/><path d="M6 12h3l2-4 2 8 2-4h3"/>',
  box: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v11l9 4 9-4V7M12 11v11M7 5l10 4"/>',
  leaf: '<path d="M19 3C8 2 2 8 5 15c4 6 15 3 14-12ZM4 21 15 9"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18M7 15h.01M12 15h.01M17 15h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  wallet: '<path d="M20 6H5a3 3 0 0 1 0-6h13v6M3 3v15a3 3 0 0 0 3 3h14V6M20 11h-6v5h6M16 13.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.box}</svg>`;
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = cents => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amountInput = cents => cents === null ? '' : (cents / 100).toFixed(2);
const signed = cents => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
const color = cents => cents > 0 ? 'positive' : cents < 0 ? 'negative' : '';
const monthLabel = month => `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
let today = dateKey();
let selectedDate = today;
let calendarMonth = today.slice(0, 7);
let planMonth = today.slice(0, 7);
let reportMonth = today.slice(0, 7);
let reportMode = 'month';
let view = 'home', currentCategory = null, currentItem = null, state, storageBroken = false;
let installPrompt = null, draftDirty = false;
const navs = [['home', 'grid', '生活费'], ['plan', 'book', '预算计划'], ['report', 'chart', '支出统计'], ['settings', 'settings', '我的账本']];
try {
  const raw = localStorage.getItem(KEY);
  state = raw ? readState(raw) : createState(today);
  if (!raw) localStorage.setItem(KEY, JSON.stringify(state));
} catch (error) {
  storageBroken = true;
  app.innerHTML = `<div class="fatal"><h1>账本暂时无法打开</h1><p>浏览器存储不可用或已有数据格式异常。为保护原记录，没有覆盖已有数据。请开启浏览器存储权限后刷新；如仍无法打开，可先下载原始数据。</p><button class="btn primary" id="recover">下载原始数据</button><p>${esc(error.message)}</p></div>`;
  document.querySelector('#recover').onclick = () => { try { download(localStorage.getItem(KEY) || '', '一日有数-原始数据.json', 'application/json'); } catch { alert('当前浏览器禁止访问存储，请调整浏览器权限。'); } };
}
function toast(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3800);
}
function refreshDay() {
  const next = dateKey();
  if (next === today) return false;
  const followed = selectedDate === today; today = next;
  if (followed) { selectedDate = today; calendarMonth = today.slice(0, 7); }
  if (modal.open) modal.close(); draftDirty = false;
  render(); toast('新的一天开始了，已结束的天 / 月 / 年周期已锁定'); return true;
}
async function commit(change) {
  const run = () => {
    // Re-read inside the cross-tab lock so two open pages cannot overwrite each other.
    const latest = readState(localStorage.getItem(KEY));
    const copy = structuredClone(latest); change(copy); copy.revision++;
    localStorage.setItem(KEY, JSON.stringify(copy)); state = copy;
  };
  try {
    if (navigator.locks) await navigator.locks.request(KEY, run); else run();
    return true;
  } catch (error) { toast(error.name === 'QuotaExceededError' ? '存储空间不足，未保存。请先导出备份。' : error.message); return false; }
}
function navigate(next, categoryId = null, itemId = null) {
  if (draftDirty && !confirm('当前内容还没保存，确定离开？')) return;
  draftDirty = false; view = next; currentCategory = categoryId; currentItem = itemId;
  render(); window.scrollTo({ top: 0 });
}
function button(action, text, symbol, extra = '') { return `<button class="btn ${extra}" data-action="${action}">${symbol ? icon(symbol) : ''}${text}</button>`; }
function navMarkup(mobile = false) {
  return `<nav class="${mobile ? 'mobile-nav' : 'nav'}" aria-label="主导航">${navs.map(([id, symbol, label]) => `<button data-nav="${id}" class="${(view === id || (id === 'home' && ['category', 'detail'].includes(view))) ? 'active' : ''}">${icon(symbol)}<span>${label}</span></button>`).join('')}</nav>`;
}
function render() {
  if (storageBroken) return;
  const category = state.categories.find(x => x.id === currentCategory);
  const name = navs.find(x => x[0] === view)?.[2] || category?.name || '生活费';
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="./icon.svg" alt=""><div><strong>一日有数</strong><small>A LITTLE EVERY DAY</small></div></div><div class="side-caption">MY CAMPUS LIFE</div>${navMarkup()}<div class="side-note"><div class="sprout">${icon('leaf')}</div><p>把生活安排好，<br>也给快乐留一点预算。</p><small>从今天的一笔开始</small></div><div class="side-footer"><span class="dot"></span>你的生活，慢慢有数</div></aside><main class="main"><header class="topbar"><span class="top-breadcrumb">我的校园生活&nbsp; / &nbsp;${esc(name)}</span><div class="mobile-brand"><img src="./icon.svg" alt="">一日有数</div><div class="right"><span>${esc(dateLabel(today))}</span><span class="device-label">本机账本</span><span class="avatar" aria-label="学生账本">同学</span></div></header>${view === 'home' ? home() : view === 'category' ? categoryPage() : view === 'detail' ? detail() : view === 'plan' ? planPage() : view === 'report' ? report() : settings()}<footer class="bottom-note">${icon('leaf')}认真生活的每一笔，都算数。</footer></main>${navMarkup(true)}</div>`;
  if (isAndroidApp && view === 'settings') {
    const installPanel = app.querySelector('[data-action="install"]')?.closest('section');
    if (installPanel) installPanel.innerHTML = `<h2>${icon('phone')}安卓版已安装</h2><p>已安装一日有数 1.2.1。记账、月计划与统计均可离线使用，不依赖下载网站。</p><p class="stat-foot">数据保存在本应用中；卸载或清除应用数据会删除账本，请定期导出备份。网页账本与安卓应用数据独立保存。</p>`;
  }
  bind();
}
function heading(eyebrow, title, subtitle, right = '', back = '') {
  return `<div class="page-head"><div>${back}<div class="eyebrow">${eyebrow}</div><h1>${esc(title)}</h1><p>${subtitle}</p></div>${right}</div>`;
}
function tile(category) {
  const items = state.items.filter(x => x.categoryId === category.id && x.createdOn <= selectedDate);
  const sum = summarize(state, [selectedDate], { categoryId: category.id });
  return `<button class="category" data-category="${esc(category.id)}"><span class="tile-chevron">${icon('chevron')}</span><span class="tile-icon" style="background:${category.color}">${icon(category.icon)}</span><strong>${esc(category.name)}</strong><span class="tile-meta">${sum.recorded ? `¥ ${money(sum.actual)} · 已记 ${sum.recorded}/${items.length}` : items.length ? `${items.length} 个小类 · 待记录` : '添加你的第一个小类'}</span></button>`;
}
function home() {
  const sum = summarize(state, [selectedDate]);
  const monthly = summarize(state, datesInMonth(selectedDate.slice(0, 7)));
  const isToday = selectedDate === today;
  const future = selectedDate > today;
  const dayWord = isToday ? '今日' : `${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8))}日`;
  return `${heading('SMALL PLANS, BETTER DAYS', isToday ? '让生活，心里有数。' : `${dayWord}的生活账本`, isToday ? '规划每一笔生活费，也照顾每一天的小确幸。' : `${future ? '未来预算预览，实际金额尚不能填写。' : '历史预算已锁定，漏记金额可补录一次。'}`, button('go-plan', '安排月计划', 'plus'))}<div class="dashboard"><div><section class="hero"><div class="hero-top"><span>${dayWord}折算实际支出</span><span class="hero-pill">${icon('leaf')}${sum.recorded ? `已记 ${sum.recorded} / ${sum.expected} 项` : '等你记下第一笔'}</span></div><div class="hero-amount"><small>¥</small>${sum.recorded ? money(sum.actual) : '— —'}</div><div class="hero-bottom"><div>${dayWord}折算预计<strong>${sum.plannedCells ? `¥ ${money(sum.planned)}` : '尚未设置'}</strong></div><span class="divider"></span><div>已记项目结余<strong>${sum.pairedCells ? `${signed(sum.difference)}` : '— —'}</strong></div><button class="plan-link" data-action="go-report">看看统计 ${icon('arrow')}</button></div></section><div class="mini-stats"><div class="stat-box"><div class="stat-label"><span>本月折算支出</span>${icon('wallet')}</div><div class="stat-value">${monthly.recorded ? money(monthly.actual) : '— —'}<small>元</small></div><div class="stat-foot">${monthLabel(selectedDate.slice(0, 7))} · 月/年金额按生效天数折算</div></div><div class="stat-box"><div class="stat-label"><span>${dayWord}记录进度</span>${icon('check')}</div><div class="stat-value">${sum.recorded}<small>/ ${sum.expected} 项</small></div><div class="stat-foot">${sum.expected ? sum.recorded === sum.expected ? '今天的每一笔，都已妥善记录' : '按小类周期计数，未记录不当作 0 元' : '从添加一个消费小类开始'}</div></div></div><div class="section-head"><h2>生活的每一面</h2><small>点击分类，按天 / 月 / 年记录</small></div><div class="grid">${state.categories.filter(x => x.createdOn <= selectedDate).map(tile).join('')}<button class="category add" data-action="add-category">${icon('plus')}<strong>添加大类</strong></button></div></div><aside class="aside"><section class="panel">${calendar()}<div class="today-progress"><div class="progress-ring" style="--progress:${sum.expected ? sum.recorded / sum.expected * 360 : 0}deg">${icon('leaf')}</div><div><strong>${isToday ? '今天' : dayWord}也在认真生活</strong><p>${sum.recorded ? `已完成 ${sum.recorded} 项记录，给自己一点肯定。` : '点选日期，回看每一天的生活。'}</p></div></div></section><section class="note-panel"><h3>${icon('info')}小账本，大规则</h3><p>每项可按天、月、年记录。相应周期结束后锁定；历史空缺金额可补录一次。</p><button class="text-button" data-action="go-settings">了解记账规则 ${icon('arrow')}</button></section></aside></div>`;
}
function calendar(forItem = false) {
  const days = datesInMonth(calendarMonth);
  const offset = (new Date(`${days[0]}T12:00:00`).getDay() + 6) % 7;
  return `<div class="month-picker"><button class="icon-btn" data-calendar-shift="-1" aria-label="上个月">${icon('left')}</button><strong>${monthLabel(calendarMonth)}</strong><button class="icon-btn" data-calendar-shift="1" aria-label="下个月">${icon('chevron')}</button></div><div class="calendar-week">${['一', '二', '三', '四', '五', '六', '日'].map(d => `<span>${d}</span>`).join('')}</div><div class="calendar-days">${'<span></span>'.repeat(offset)}${days.map(day => {
    const recorded = forItem ? getRecord(state, currentItem, day) !== null : summarize(state, [day]).recorded > 0;
    return `<button data-date="${day}" class="${day === selectedDate ? 'selected ' : ''}${day === today ? 'today ' : ''}${recorded ? 'has-record ' : ''}${day > today ? 'future' : ''}" aria-label="${day}${recorded ? '，已记录' : ''}" aria-pressed="${day === selectedDate}">${Number(day.slice(8))}</button>`;
  }).join('')}</div><div class="calendar-legend"><span><i class="outline-dot"></i>今天</span><span><i class="dot"></i>有记录</span><button class="text-button" data-action="back-today" style="margin-left:auto">回到今天</button></div>`;
}
function categoryPage() {
  const c = state.categories.find(x => x.id === currentCategory);
  const items = state.items.filter(x => x.categoryId === c.id && x.createdOn <= selectedDate);
  return `${heading('THE LITTLE THINGS', c.name, `${esc(dateLabel(selectedDate))} · 选择一个小类，记录实际花费。`, '', `<button class="back" data-nav="home">${icon('left')}全部分类</button>`)}<div class="wide"><div class="grid">${items.map(item => {
    const plan = getPlan(state, item.id, selectedDate), record = getRecord(state, item.id, selectedDate);
    return `<button class="category" data-item="${esc(item.id)}"><span class="tile-chevron">${icon('chevron')}</span><span class="tile-icon" style="background:${c.color}">${icon(c.icon)}</span><strong>${esc(item.name)}</strong><span class="tile-meta">预计/${UNIT_LABELS[getUnit(state, item.id, selectedDate)]} ${plan === null ? '未设置' : `¥ ${money(plan)}`}<br>实际/${UNIT_LABELS[getUnit(state, item.id, selectedDate)]} ${record === null ? '未记录' : `¥ ${money(record.cents)}`}</span></button>`;
  }).join('')}<button class="category add" data-action="add-item">${icon('plus')}<strong>添加小类</strong></button></div>${!items.length ? `<div class="empty">${icon(c.icon)}这里还没有小类。<br>比如为「${esc(c.name)}」添加一个经常用到的消费项目。</div>` : ''}<div class="alert" style="margin-top:22px">${icon('info')}分类建立后保留，不提供删除；历史记录始终留在原来的小类下。</div></div>`;
}
function detail() {
  const item = state.items.find(x => x.id === currentItem);
  const category = state.categories.find(x => x.id === item.categoryId);
  const period = getPeriod(state, item.id, selectedDate);
  const plan = getPlan(state, item.id, selectedDate), record = getRecord(state, item.id, selectedDate);
  const exists = itemExists(state, item.id, selectedDate);
  const past = period.end < today, future = period.activeStart > today;
  const locked = past && record !== null, canEdit = exists && !future && !locked;
  const backfill = past && record === null && exists;
  const difference = plan !== null && record !== null ? plan - record.cents : null;
  const label = period.unit === 'day' ? selectedDate : period.unit === 'month' ? monthLabel(selectedDate.slice(0, 7)) : `${selectedDate.slice(0, 4)} 年`;
  const lockAt = period.unit === 'day' ? '零点后锁定' : period.unit === 'month' ? '下月起锁定' : '次年起锁定';
  const status = !exists ? '该日期尚未建立此小类' : future ? '未来周期 · 仅展示预算' : locked ? (record.backfilled ? '已补录一次 · 已锁定' : '历史周期 · 已锁定') : backfill ? '历史空缺 · 仅可补录一次' : `本期可调整 · ${lockAt}`;
  const help = backfill ? '请核对整个周期的金额，补录后立即锁定。' : `按${UNIT_LABELS[period.unit]}填写一笔实际金额。${period.unit === 'day' ? '' : '同一周期内选不同日期，看到的是同一条记录。'}`;
  return `${heading('ONE PERIOD, ONE RECORD', item.name, `${esc(category.name)} / ${label} · 按${UNIT_LABELS[period.unit]}记录`, '', `<button class="back" data-action="back-category">${icon('left')}${esc(category.name)}</button>`)}
  <div class="detail-layout"><section class="panel detail-money">
    <div class="detail-heading"><h2>${label}的这一笔</h2><span class="tag">${esc(status)}</span></div>
    <div class="money-row"><span class="label">本期预计金额</span><span class="big">${plan === null ? '<span class="muted" style="font-size:18px">未设置</span>' : `¥ ${money(plan)}`}</span></div>
    <form id="actual-form"><div class="money-row"><label class="label" for="actual-input">本期实际金额</label>${canEdit ? `<div class="money-entry"><span class="muted">¥</span><input id="actual-input" name="actual" inputmode="decimal" placeholder="未记录" value="${record ? amountInput(record.cents) : ''}" autocomplete="off" aria-describedby="actual-help" required></div>` : `<span class="big">${record ? `¥ ${money(record.cents)}` : '<span class="muted" style="font-size:18px">未记录</span>'}</span>`}</div>
    <div class="money-row difference"><span class="label">本期预计 − 实际</span><span class="big ${difference === null ? 'muted' : color(difference)}" id="live-difference">${difference === null ? '— —' : signed(difference)}</span></div>
    <div class="detail-status"><span id="actual-help">${help}${record?.backfilled ? '<br>补录于 ' + esc(new Date(record.firstSavedAt).toLocaleString('zh-CN')) : ''}</span>${canEdit ? `<button class="btn primary" type="submit">${icon('check')}${backfill ? '补录一次' : '保存本期金额'}</button>` : icon('lock')}</div></form>
  </section><section class="panel detail-calendar">${calendar(true)}</section>
  ${period.unit !== 'day' ? `<div class="alert" style="margin-top:20px">${icon('info')}按自然${UNIT_LABELS[period.unit]}填写。本期 ${period.activeStart} 至 ${period.end}；预算和实际只各记一笔，日/月统计按生效天数折算。</div>` : ''}
  ${plan === null && !past ? `<div class="alert" style="margin-top:16px">${icon('info')}本期尚未设置预算。<button class="text-button" data-action="go-plan">去设置预算</button></div>` : ''}</div>`;
}

function planPage() {
  const locked = planMonth < today.slice(0, 7);
  const effective = locked ? `${planMonth}-01` : planMonth === today.slice(0, 7) ? today : `${planMonth}-01`;
  const sum = summarize(state, datesInMonth(planMonth));
  return `${heading('A PLAN THAT FITS YOUR LIFE', '按你的节奏，安排预算。', '餐饮按天，会员按月，年费按年。每个小类独立选择。')}
  <div class="wide"><div class="plan-bar"><div class="month-picker"><button class="icon-btn" data-plan-shift="-1" aria-label="上个月计划">${icon('left')}</button><strong>${monthLabel(planMonth)}</strong><button class="icon-btn" data-plan-shift="1" aria-label="下个月计划">${icon('chevron')}</button></div><span class="tag">${locked ? '历史月份 · 只读' : '每项自选周期'}</span></div>
  <div class="alert">${icon(locked ? 'lock' : 'info')}<span>${locked ? '已结束的周期只读，以下保留历史金额和计费周期。' : '金额和实际记录都跟随所选周期。按月每月填一笔，按年每年填一笔；相应周期结束后锁定。年预算整年共用，月预算各月独立；空白为未设置，0 元为明确无需支出。'}</span></div>
  <div class="plan-summary"><div><span>本月预计（含周期折算）</span><strong id="plan-total">¥ ${money(sum.planned)}</strong></div><div><span>本月天数</span><strong>${datesInMonth(planMonth).length}<small style="font-size:12px"> 天</small></strong></div></div>
  <form id="plan-form">${state.categories.map(c => {
    const items = state.items.filter(x => x.categoryId === c.id && x.createdOn <= datesInMonth(planMonth).at(-1));
    if (locked && !items.length) return '';
    return `<section class="plan-group"><h3>${icon(c.icon)}${esc(c.name)}</h3>${items.length ? items.map(item => {
      const p = getPlan(state, item.id, effective), unit = getUnit(state, item.id, effective);
      const cycleLocked = getRecord(state, item.id, effective) !== null;
      const history = [...new Set(datesInMonth(planMonth).filter(d => itemExists(state, item.id, d)).map(d => { const value = getPlan(state, item.id, d); return value === null ? null : `${money(value)} 元/${UNIT_LABELS[getUnit(state, item.id, d)]}`; }).filter(Boolean))].join(' · ') || '未设置';
      return `<div class="plan-row cycle-row"><label for="plan-${esc(item.id)}">${esc(item.name)}<small data-plan-hint="${esc(item.id)}">${locked ? '历史预算与周期' : `${unit === 'day' ? '每天' : unit === 'month' ? '每月' : '每年'}填写一笔实际${cycleLocked ? ' · 本期已有记录，周期下期可改' : ''}`}</small></label><div class="input-wrap">${locked ? `<span class="plan-history">${esc(history)}</span>` : `<span>¥</span><input id="plan-${esc(item.id)}" name="${esc(item.id)}" inputmode="decimal" data-plan-item="${esc(item.id)}" value="${amountInput(p)}" placeholder="未设置" autocomplete="off" aria-label="${esc(item.name)}预计金额"><select data-plan-unit="${esc(item.id)}" aria-label="${esc(item.name)}计费周期" ${cycleLocked ? 'disabled' : ''}>${UNITS.map(value => `<option value="${value}" ${value === unit ? 'selected' : ''}>按${UNIT_LABELS[value]}</option>`).join('')}</select>`}</div></div>`;
    }).join('') : ''}${!locked ? `<div class="empty-group">${!items.length ? '<span>还没有消费小类</span>' : ''}<button class="text-button" type="button" data-plan-add="${esc(c.id)}">+ 添加小类</button></div>` : ''}</section>`;
  }).join('')}${!locked ? `<div class="sticky-save"><small>新周期从 ${esc(effective)} 生效，旧记录保留。</small><button class="btn primary" type="submit">${icon('check')}保存预算计划</button></div>` : ''}</form>
  <p class="stat-foot">日/月统计把月、年金额按该周期生效天数分摊，分为单位分配，合计保持原金额。详情中直接比较整期预算与整期实际；同一年内修改年预算会更新该年的预算。</p></div>`;
}

function report() {
  const monthDays = datesInMonth(reportMonth);
  const days = reportMode === 'year' ? datesInYear(reportMonth.slice(0, 4)) : reportMode === 'month' ? monthDays : [selectedDate];
  const sum = summarize(state, days);
  const due = summarize(state, days.filter(d => d <= today));
  const categorySums = state.categories.map(c => ({ ...c, sum: summarize(state, days, { categoryId: c.id }) }));
  const daily = monthDays.map(d => summarize(state, [d]));
  const maxDaily = Math.max(1, ...daily.map(d => d.actual));
  return `${heading('YOUR MONEY, AT A GLANCE', '每一笔，都看得见。', '看看钱花在哪里，也看看自己怎样生活。', `<div class="switch"><button data-report-mode="day" class="${reportMode === 'day' ? 'active' : ''}">日展示</button><button data-report-mode="month" class="${reportMode === 'month' ? 'active' : ''}">月展示</button><button data-report-mode="year" class="${reportMode === 'year' ? 'active' : ''}">年展示</button></div>`)}<div class="wide"><div class="plan-bar">${reportMode !== 'day' ? `<div class="month-picker"><button class="icon-btn" data-report-shift="-1" aria-label="上个月统计">${icon('left')}</button><strong>${reportMode === 'year' ? reportMonth.slice(0, 4) + ' 年' : monthLabel(reportMonth)}</strong><button class="icon-btn" data-report-shift="1" aria-label="下个月统计">${icon('chevron')}</button></div>` : `<input class="inline-date" type="date" id="report-date" value="${selectedDate}" aria-label="统计日期">`}<button class="btn small ghost" data-action="export-csv">${icon('download')}导出明细</button></div><div class="stats-top"><div class="stat-box"><div class="stat-label">折算预计 ${icon('book')}</div><div class="stat-value">${sum.plannedCells ? money(sum.planned) : '— —'}<small>元</small></div><div class="stat-foot">${reportMode === 'year' ? '全年各周期预算合计' : '月/年项目按生效天数折算'}</div></div><div class="stat-box"><div class="stat-label">折算实际 ${icon('wallet')}</div><div class="stat-value">${sum.recorded ? money(sum.actual) : '— —'}<small>元</small></div><div class="stat-foot">${sum.recorded} 个周期已有实际记录</div></div><div class="stat-box"><div class="stat-label">已记项目结余 ${icon('leaf')}</div><div class="stat-value ${sum.pairedCells ? color(sum.difference) : ''}">${sum.pairedCells ? signed(sum.difference) : '— —'}</div><div class="stat-foot">仅比较已填写的周期，月/年项目按天折算</div></div></div><div class="alert">${icon('info')}<span>${due.expected - due.recorded > 0 ? `截至${reportMode === 'day' ? '所选日期' : '今天或期末'}，还有 ${due.expected - due.recorded} 个周期未记录实际金额。未记录不代表 0 元，结余仅供参考。` : due.expected ? '所选期间应记项目均已填写。' : '所选期间没有应记项目。'}${sum.plannedCells < sum.expected ? ' 部分项目尚未设置预算。' : ''}</span></div><section class="panel report-section"><h2>花在生活的哪里</h2>${categorySums.map(c => `<div class="report-row"><div class="cat-label">${icon(c.icon)}<span>${esc(c.name)}</span></div><div><div class="bar-track"><div class="bar-fill" style="width:${sum.actual ? c.sum.actual / sum.actual * 100 : 0}%"></div></div><small>${c.sum.recorded ? `${c.sum.recorded} 项已记 · 占 ${sum.actual ? (c.sum.actual / sum.actual * 100).toFixed(1) : '0'}%` : '暂无记录'}</small></div><div class="report-amount">${c.sum.recorded ? `¥ ${money(c.sum.actual)}` : '— —'}</div></div>`).join('')}</section>${reportMode === 'month' ? `<section class="panel report-section"><h2>这个月的支出节奏</h2><div class="report-days" role="img" aria-label="${esc(monthLabel(reportMonth))}每日实际支出柱状图">${daily.map((d, i) => `<div class="report-day" title="${monthDays[i]}：${d.recorded ? money(d.actual) + ' 元' : '未记录'}"><div class="bar" style="height:${d.actual / maxDaily * 110}px;opacity:${d.recorded ? 1 : .2}"></div><span>${i === 0 || (i + 1) % 5 === 0 || i === daily.length - 1 ? i + 1 : ''}</span></div>`).join('')}</div><p class="stat-foot">柱状图仅显示已记录支出；完整逐日金额可通过「导出明细」查看。</p></section>` : ''}</div>`;
}
function settings() {
  return `${heading('A LITTLE SPACE OF YOUR OWN', '你的生活小账本', '规则简单一点，记录认真一点。')}<div class="settings-grid wide"><section class="panel"><h2>${icon('phone')}放进手机主屏幕</h2><p>安装后像普通应用一样打开，首次联网加载完成后，也可以离线记账。</p><button class="btn primary" data-action="install">${icon('plus')}安装 / 查看安装方法</button><p class="stat-foot">手机请打开正式 HTTPS 地址。部分内置浏览器需转到系统浏览器安装。</p></section><section class="panel"><h2>${icon('download')}给记录留一份备份</h2><p>数据保存在当前设备、当前浏览器中，暂不跨设备同步。清理浏览器数据会清除账本，建议定期导出保存。</p><button class="btn" data-action="export-json">${icon('download')}下载完整备份 JSON</button><p class="stat-foot">备份包含分类、预算版本及金额记录。本版暂未提供备份导入。</p></section><section class="panel full"><h2>${icon('lock')}我们约好的记账规则</h2><ol><li>八个常用大类默认建立，餐饮自带早餐、午餐、晚餐。大类和小类都可添加，建立后不提供删除。</li><li>每项独立选择按天、月或年。日预算按月制定，月预算各月独立，年预算整年共用。周期选择会保留旧日期记录；本期已有实际金额时，周期须在下期更改。</li><li>本期金额可调整。按天项目次日锁定，按月项目下月锁定，按年项目次年锁定；同一月/年只保留一条实际记录。</li><li>历史周期未填的实际金额，可以补录一次。提交前需要核对，保存后立即锁定，0 元也算一次有效记录。</li><li>差值 = 预计 − 实际。节余为带加号的绿色数字，超支为红色负数，0 元使用默认颜色。</li><li>未记录与 0 元分开显示。日/月/年统计按生效天数分摊月、年金额；整期合计等于填写金额，差值只比较预算与实际均有值的周期。</li></ol><p class="stat-foot">这是本地个人账本。锁定限制由应用按设备日期执行，不能防止手动修改浏览器存储或设备时间。时间管理功能留待后续版本。</p></section><section class="panel full"><h2>${icon('leaf')}一日有数 <span class="tag">1.2.1</span></h2><p>从每一天的小计划开始，慢慢找到适合自己的生活节奏。</p><span class="saving-status">当前有 ${state.categories.length} 个大类、${state.items.length} 个小类、${Object.keys(state.records).length + Object.keys(state.periodRecords).length} 条实际金额记录。</span></section></div>`;
}
function bind() {
  app.querySelectorAll('[data-nav]').forEach(el => el.onclick = () => navigate(el.dataset.nav));
  app.querySelectorAll('[data-action]').forEach(el => el.onclick = () => action(el.dataset.action));
  app.querySelectorAll('[data-category]').forEach(el => el.onclick = () => navigate('category', el.dataset.category));
  app.querySelectorAll('[data-item]').forEach(el => el.onclick = () => navigate('detail', currentCategory, el.dataset.item));
  app.querySelectorAll('[data-calendar-shift]').forEach(el => el.onclick = () => { if (!leaveDraft()) return; calendarMonth = shiftMonth(calendarMonth, Number(el.dataset.calendarShift)); render(); });
  app.querySelectorAll('[data-date]').forEach(el => el.onclick = () => { if (!leaveDraft()) return; selectedDate = el.dataset.date; render(); });
  app.querySelectorAll('[data-plan-shift]').forEach(el => el.onclick = () => { if (!leaveDraft()) return; planMonth = shiftMonth(planMonth, Number(el.dataset.planShift)); render(); });
  app.querySelectorAll('[data-report-shift]').forEach(el => el.onclick = () => { reportMonth = shiftMonth(reportMonth, Number(el.dataset.reportShift) * (reportMode === 'year' ? 12 : 1)); render(); });
  app.querySelectorAll('[data-report-mode]').forEach(el => el.onclick = () => { reportMode = el.dataset.reportMode; render(); });
  app.querySelectorAll('[data-plan-add]').forEach(el => el.onclick = () => addModal('item', el.dataset.planAdd));
  const actualForm = document.querySelector('#actual-form');
  if (actualForm) {
    actualForm.onsubmit = event => { event.preventDefault(); submitActual(); };
    document.querySelector('#actual-input')?.addEventListener('input', e => {
      draftDirty = true;
      const plan = getPlan(state, currentItem, selectedDate); const el = document.querySelector('#live-difference');
      try { const difference = plan === null ? null : plan - parseMoney(e.target.value); el.textContent = difference === null ? '— —' : signed(difference); el.className = `big ${difference === null ? 'muted' : color(difference)}`; }
      catch { el.textContent = '— —'; el.className = 'big muted'; }
    });
  }
  const planForm = document.querySelector('#plan-form');
  if (planForm) {
    planForm.onsubmit = event => { event.preventDefault(); submitPlan(); };
    planForm.oninput = () => {
      draftDirty = true;
      for (const select of planForm.querySelectorAll('[data-plan-unit]')) {
        const hint = planForm.querySelector(`[data-plan-hint="${select.dataset.planUnit}"]`);
        if (hint) hint.textContent = `${select.value === 'day' ? '每天' : select.value === 'month' ? '每月' : '每年'}填写一笔实际${select.disabled ? ' · 本期已有记录，周期下期可改' : ''}`;
      }
      try {
        const copy = structuredClone(state), entries = planEntries(); setPlans(copy, planMonth, entries, dateKey());
        document.querySelector('#plan-total').textContent = `¥ ${money(summarize(copy, datesInMonth(planMonth)).planned)}`;
      } catch { document.querySelector('#plan-total').textContent = '请检查金额'; }
    };
    planForm.onchange = planForm.oninput;
  }
  document.querySelector('#report-date')?.addEventListener('change', e => { if (e.target.value) { selectedDate = e.target.value; render(); } });
}
function leaveDraft() {
  if (draftDirty && !confirm('当前内容还没保存，确定离开？')) return false;
  draftDirty = false; return true;
}
function action(name) {
  if (name === 'go-plan') { planMonth = selectedDate.slice(0, 7); navigate('plan'); }
  else if (name === 'go-report') { reportMonth = selectedDate.slice(0, 7); navigate('report'); }
  else if (name === 'go-settings') navigate('settings');
  else if (name === 'back-category') navigate('category', currentCategory);
  else if (name === 'add-category') addModal('category');
  else if (name === 'add-item') addModal('item', currentCategory);
  else if (name === 'back-today') { if (!leaveDraft()) return; selectedDate = dateKey(); calendarMonth = selectedDate.slice(0, 7); render(); }
  else if (name === 'export-json') exportJSON();
  else if (name === 'export-csv') exportCSV();
  else if (name === 'install') install();
}
function addModal(type, parentId = null) {
  const isCategory = type === 'category';
  // Adding a category item must not save or discard the in-progress budget form.
  const planDraft = view === 'plan' ? {
    dirty: draftDirty, scrollY: window.scrollY,
    amounts: new Map([...app.querySelectorAll('[data-plan-item]')].map(input => [input.dataset.planItem, input.value])),
    units: new Map([...app.querySelectorAll('[data-plan-unit]')].map(select => [select.dataset.planUnit, select.value]))
  } : null;
  modal.innerHTML = `<form id="add-form"><div class="modal-top"><h2 id="modal-title">添加${isCategory ? '大类' : '小类'}</h2><button type="button" class="icon-btn" data-close aria-label="关闭">${icon('close')}</button></div><p class="modal-body">${isCategory ? '为生活添一个你关心的方面。' : `添加到「${esc(state.categories.find(c => c.id === parentId).name)}」。`}分类建立后会一直保留，请确认名称。</p><label class="field">${isCategory ? '大类' : '小类'}名称<input name="name" placeholder="${isCategory ? '例如：兴趣爱好' : '例如：零食'}" maxlength="16" required autocomplete="off"></label><p class="form-error" id="add-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn primary">确认添加</button></div></form>`;
  modal.querySelectorAll('[data-close]').forEach(el => el.onclick = () => modal.close());
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault(); if (refreshDay()) return;
    const submit = e.target.querySelector('[type="submit"]');
    if (submit.disabled) return;
    const value = new FormData(e.target).get('name');
    const originalDate = selectedDate;
    submit.disabled = true;
    try {
      const ok = await commit(s => isCategory ? addCategory(s, value, dateKey()) : addItem(s, parentId, value, dateKey()));
      if (ok) {
        modal.close(); selectedDate = dateKey(); calendarMonth = selectedDate.slice(0, 7); render();
        if (planDraft) {
          for (const input of app.querySelectorAll('[data-plan-item]')) if (planDraft.amounts.has(input.dataset.planItem)) input.value = planDraft.amounts.get(input.dataset.planItem);
          for (const select of app.querySelectorAll('[data-plan-unit]')) if (!select.disabled && planDraft.units.has(select.dataset.planUnit)) select.value = planDraft.units.get(select.dataset.planUnit);
          draftDirty = planDraft.dirty;
          if (draftDirty) document.querySelector('#plan-form').dispatchEvent(new Event('input', { bubbles: true }));
          app.querySelector(`[data-plan-add="${parentId}"]`)?.focus({ preventScroll: true });
          window.scrollTo({ top: planDraft.scrollY });
        }
        toast(planDraft ? '已添加小类，可继续添加；预算草稿已保留，请记得保存' : originalDate !== selectedDate ? '已添加，新分类从今天开始使用' : '已添加，去为它安排预算吧');
      }
    } finally { submit.disabled = false; }
  };
  modal.showModal();
}
function planEntries() {
  const entries = [];
  for (const input of app.querySelectorAll('[data-plan-item]')) {
    if (input.value.trim() === '') {
      const effective = planMonth === today.slice(0, 7) ? today : `${planMonth}-01`;
      if (getPlan(state, input.dataset.planItem, effective) !== null) throw Error('已设置的预算不能清空；不支出请填 0');
      continue;
    }
    try { entries.push([input.dataset.planItem, parseMoney(input.value), app.querySelector('[data-plan-unit="' + input.dataset.planItem + '"]').value]); }
    catch (e) { input.focus(); throw e; }
  }
  return entries;
}
async function submitPlan() {
  if (refreshDay()) return;
  let entries;
  try { entries = planEntries(); if (!entries.length) throw Error('请至少填写一个小类的预算金额'); }
  catch (e) { toast(e.message); return; }
  if (await commit(s => setPlans(s, planMonth, entries, dateKey()))) { draftDirty = false; render(); toast('预算已保存，实际金额将按所选周期填写'); }
}
async function submitActual() {
  if (refreshDay()) return;
  let cents;
  try { cents = parseMoney(document.querySelector('#actual-input').value); } catch (e) { toast(e.message); return; }
  const id = currentItem, date = selectedDate;
  if (getPeriod(state, id, date).end < today) {
    modal.innerHTML = `<div class="modal-top"><h2 id="modal-title">核对这次补录</h2><button class="icon-btn" data-close aria-label="关闭">${icon('close')}</button></div><p class="modal-body">${esc(getPeriod(state, id, date).label)} · ${esc(state.items.find(x => x.id === id).name)}<br><strong style="font-size:26px;color:var(--green)">¥ ${money(cents)}</strong><br>这是该项目本周期唯一一次补录机会。保存后立即锁定，不能修改。</p><div class="modal-actions"><button class="btn" data-close>返回核对</button><button class="btn primary" id="confirm-backfill">确认并锁定</button></div>`;
    modal.querySelectorAll('[data-close]').forEach(el => el.onclick = () => modal.close());
    modal.querySelector('#confirm-backfill').onclick = async () => {
      const ok = await commit(s => saveActual(s, id, date, cents, dateKey()));
      if (ok) { draftDirty = false; modal.close(); render(); toast('补录已保存，该条历史记录已锁定'); }
    };
    modal.showModal();
  } else if (await commit(s => saveActual(s, id, date, cents, dateKey()))) { draftDirty = false; render(); toast('已保存。认真生活的这一天，也记下了。'); }
}
function download(text, name, type) {
  if (isAndroidApp) {
    window.AndroidApp.saveText(name, type.split(';')[0], text);
    toast('请选择文件保存位置');
    return 'native';
  }
  const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'browser';
}
function exportJSON() {
  try { const latest = readState(localStorage.getItem(KEY)); const mode = download(JSON.stringify(latest, null, 2), `一日有数-完整备份-${dateKey()}.json`, 'application/json'); if (mode === 'browser') toast('备份已下载，请保存到安全的位置'); }
  catch (e) { toast('导出失败：' + e.message); }
}
function exportCSV() {
  const dates = reportMode === 'year' ? datesInYear(reportMonth.slice(0, 4)) : reportMode === 'month' ? datesInMonth(reportMonth) : [selectedDate];
  const rows = [['周期', '大类', '小类', '计费周期', '整期预计（元）', '整期实际（元）', '所选范围折算预计（元）', '所选范围折算实际（元）', '折算差值（元）', '状态']];
  const groups = new Map();
  for (const day of dates) for (const item of state.items) {
    if (!itemExists(state, item.id, day)) continue;
    const period = getPeriod(state, item.id, day);
    if (!groups.has(period.key)) groups.set(period.key, {item, period, days:[]});
    groups.get(period.key).days.push(day);
  }
  for (const {item, period, days} of groups.values()) {
    const date = days.at(-1), plan = getPlan(state, item.id, date), record = getRecord(state, item.id, date);
    const sum = summarize(state, days, {itemId:item.id});
    rows.push([period.label, state.categories.find(x => x.id === item.categoryId).name, item.name, `按${UNIT_LABELS[period.unit]}`, plan === null ? '未设置' : (plan / 100).toFixed(2), record === null ? '未记录' : (record.cents / 100).toFixed(2), plan === null ? '' : (sum.planned / 100).toFixed(2), record === null ? '' : (sum.actual / 100).toFixed(2), sum.pairedCells ? (sum.difference / 100).toFixed(2) : '', record?.backfilled ? '已补录锁定' : record ? period.end < today ? '历史锁定' : '本期可调整' : '未记录']);
  }
  const cell = value => { const text = String(value); return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"'; };
  download('\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n'), `一日有数-明细-${reportMode === 'year' ? reportMonth.slice(0, 4) : reportMode === 'month' ? reportMonth : selectedDate}.csv`, 'text/csv;charset=utf-8');
}

async function install() {
  if (isAndroidApp) { toast('当前已安装安卓版，可直接离线使用'); return; }
  if (installPrompt) { const prompt = installPrompt; installPrompt = null; await prompt.prompt(); const choice = await prompt.userChoice; toast(choice.outcome === 'accepted' ? '安装已提交，可以从主屏幕打开' : '随时可以在这里再次查看安装方法'); return; }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  modal.innerHTML = `<div class="modal-top"><h2 id="modal-title">${standalone ? '已经在应用中啦' : '把一日有数放进手机'}</h2><button class="icon-btn" data-close aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${standalone ? '当前已在独立应用模式中运行。' : '<p><strong>iPhone / iPad</strong><br>用 Safari 打开此页面 → 轻点分享按钮 → 添加到主屏幕。</p><p><strong>安卓手机</strong><br>用支持安装网页应用的浏览器打开 → 菜单 → 安装应用 / 添加到主屏幕。</p><p>首次联网加载后可离线使用。安装到主屏幕不会自动同步不同浏览器的数据，请继续使用原来的浏览器账本。</p>'}</div><div class="modal-actions"><button class="btn primary" data-close>知道了</button></div>`;
  modal.querySelectorAll('[data-close]').forEach(el => el.onclick = () => modal.close()); modal.showModal();
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('已安装到主屏幕'); });
window.YiriNativeExportResult = (success, message) => { if (isAndroidApp) toast(message || (success ? '文件已保存' : '已取消保存')); };
window.YiriNativeBack = () => {
  if (!isAndroidApp) return;
  if (modal.open) { modal.close(); return; }
  if (storageBroken) { window.AndroidApp.exitApp(); return; }
  if (!leaveDraft()) return;
  if (view === 'detail') navigate('category', currentCategory);
  else if (view !== 'home') navigate('home');
  else window.AndroidApp.exitApp();
};
window.addEventListener('storage', event => {
  if (event.key !== KEY || !event.newValue) return;
  try { state = readState(event.newValue); if (!draftDirty && !modal.open) render(); else toast('另一窗口已更新账本，保存时会重新核对'); } catch { toast('另一窗口的数据异常，请先导出备份'); }
});
window.addEventListener('beforeunload', e => { if (draftDirty) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDay(); });
window.addEventListener('focus', () => refreshDay());
if (!storageBroken) { render(); setInterval(refreshDay, 15000); }
if ('serviceWorker' in navigator && !storageBroken && !isAndroidApp) navigator.serviceWorker.register('./sw.js').catch(() => toast('离线服务暂未启用，联网使用和本机保存仍可用'));
