// Daily Assistant – Local PWA
// Data model: {id, type: 'class'|'meal'|'wake', title, whenISO, repeat: 'none'|'daily'|'weekdays'|'weekly', advanceMinutes}
// Storage
const LS_KEY = 'daily-assistant-items-v1';
const $ = (s, p=document)=> p.querySelector(s);
const $$ = (s, p=document)=> [...p.querySelectorAll(s)];
let deferredPrompt = null;
let wakeLock = null;
const timers = new Map();

function loadItems(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch(e){ return []; }
}
function saveItems(items){
  localStorage.setItem(LS_KEY, JSON.stringify(items));
  render();
  scheduleAll();
}
function uuid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }

// Time helpers
function combineDateTimeToISO(dateStr, timeStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  const [hh,mm] = timeStr.split(':').map(Number);
  const dt = new Date(y, m-1, d, hh, mm, 0, 0);
  return dt.toISOString();
}
function isWeekday(date){
  const n = date.getDay(); // 0=Sun
  return n>=1 && n<=5;
}
function nextOccurrence(item, from=new Date()){
  // compute the next datetime (minus advance) at or after "from"
  let target = new Date(item.whenISO);
  const advMs = (item.advanceMinutes||0)*60*1000;
  function setNextDay(days=1){ target = new Date(target.getTime() + days*24*60*60*1000); }

  while (true){
    if (item.repeat==='none'){
      if (target.getTime() - advMs >= from.getTime()) return new Date(target.getTime() - advMs);
      return null;
    }
    if (item.repeat==='daily'){
      if (target.getTime() - advMs >= from.getTime()) return new Date(target.getTime() - advMs);
      setNextDay(1);
    } else if (item.repeat==='weekdays'){
      if (isWeekday(target) && target.getTime() - advMs >= from.getTime()) return new Date(target.getTime() - advMs);
      setNextDay(1);
      // skip weekends
      while(!isWeekday(target)) setNextDay(1);
    } else if (item.repeat==='weekly'){
      if (target.getTime() - advMs >= from.getTime()) return new Date(target.getTime() - advMs);
      setNextDay(7);
    } else {
      // unknown repeat -> treat as none
      if (target.getTime() - advMs >= from.getTime()) return new Date(target.getTime() - advMs);
      return null;
    }
  }
}

// Notifications & alarm
async function ensurePermission(){
  if (!('Notification' in window)) {
    alert('Notifications not supported in this browser.');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  const res = await Notification.requestPermission();
  return res === 'granted';
}

function ring(item){
  // Visual + sound + vibration + notification
  const titleMap = { class:'Class', meal:'Meal', wake:'Wake-up' };
  const title = `${titleMap[item.type]||'Reminder'}: ${item.title}`;
  const body = item.type==='class' ? 'Class is starting soon.' :
               item.type==='meal' ? 'Time to eat something ✨' :
               'Wake up!';
  if (navigator.vibrate) navigator.vibrate([200,100,200,100,400]);
  // Beep using Web Audio (no file needed)
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type='square'; o.frequency.value=880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime+0.05);
    o.start();
    setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.1); o.stop(); ctx.close(); }, 1200);
  } catch(e){}
  if ('Notification' in window && Notification.permission==='granted'){
    navigator.serviceWorker?.getRegistration().then(reg=>{
      if (reg) reg.showNotification(title, { body, icon:'assets/icons/icon-192.png', badge:'assets/icons/icon-192.png' });
      else new Notification(title, { body, icon:'assets/icons/icon-192.png' });
    });
  } else {
    alert(`${title}\n${body}`);
  }
}

function clearTimers(){
  for (const [id, t] of timers.entries()){
    clearTimeout(t);
  }
  timers.clear();
}

function scheduleAll(){
  clearTimers();
  const items = loadItems();
  const now = new Date();
  for (const item of items){
    const when = nextOccurrence(item, now);
    if (!when) continue;
    const ms = when.getTime() - now.getTime();
    const maxDelay = 2147483647; // ~24.8 days
    const delay = Math.max(0, Math.min(ms, maxDelay));
    const existing = timers.get(item.id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(()=>{
      ring(item);
      // reschedule if repeating
      if (item.repeat!=='none') scheduleAll();
    }, delay);
    timers.set(item.id, t);
  }
  render();
}

// UI
function render(){
  const items = loadItems().sort((a,b)=> new Date(a.whenISO) - new Date(b.whenISO));
  const list = $('#upcomingList');
  list.innerHTML='';
  const titleFor = t => t==='class'?'class': t==='meal'?'meal':'wake';
  for (const it of items){
    const dt = new Date(it.whenISO);
    const li = document.createElement('li');
    li.className='item';
    const badge = `<span class="badge ${titleFor(it.type)}">${it.type}</span>`;
    const meta = `<div class="meta">${dt.toLocaleString([], { dateStyle:'medium', timeStyle:'short' })} • repeat: ${it.repeat} • -${it.advanceMinutes||0}m</div>`;
    li.innerHTML = `${badge}<div style="flex:1"><div>${it.title}</div>${meta}</div>
      <button class="btn secondary" data-edit="${it.id}">Edit</button>
      <button class="btn danger" data-del="${it.id}">Delete</button>`;
    list.appendChild(li);
  }
  // wire buttons
  list.addEventListener('click', e=>{
    const del = e.target.closest('[data-del]');
    const edit = e.target.closest('[data-edit]');
    if (del){
      const id = del.getAttribute('data-del');
      const items = loadItems().filter(i=>i.id!==id);
      saveItems(items);
    } else if (edit){
      const id = edit.getAttribute('data-edit');
      const items = loadItems();
      const it = items.find(i=>i.id===id);
      if (!it) return;
      // simple prompt-based edit
      const title = prompt('Title', it.title); if (title===null) return;
      const when = new Date(it.whenISO);
      const date = prompt('Date (YYYY-MM-DD)', when.toISOString().slice(0,10)); if (date===null) return;
      const time = prompt('Time (HH:MM)', when.toTimeString().slice(0,5)); if (time===null) return;
      const repeat = prompt('Repeat (none|daily|weekdays|weekly)', it.repeat); if (repeat===null) return;
      const advance = prompt('Notify before (minutes)', it.advanceMinutes||0); if (advance===null) return;
      it.title = title;
      it.whenISO = combineDateTimeToISO(date, time);
      it.repeat = ['none','daily','weekdays','weekly'].includes(repeat)? repeat : 'none';
      it.advanceMinutes = Math.max(0, parseInt(advance||'0',10));
      saveItems(items);
    }
  }, { once:true });
}

function addItemFromTemplate(str){
  // format: "type:Title:HH:MM"
  const [type,title,t] = str.split(':');
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);
  const timeStr = t;
  const whenISO = combineDateTimeToISO(dateStr, timeStr);
  const item = { id:uuid(), type, title, whenISO, repeat:'daily', advanceMinutes:5 };
  const items = loadItems(); items.push(item); saveItems(items);
}

window.addEventListener('load', async ()=>{
  // Service worker
  if ('serviceWorker' in navigator){
    try { await navigator.serviceWorker.register('sw.js'); } catch(e){ console.warn('SW failed', e); }
  }
  render();
  scheduleAll();
});

// form wiring
$('#itemForm').addEventListener('submit', e=>{
  e.preventDefault();
  const type = $('#type').value;
  const title = $('#title').value.trim();
  const date = $('#date').value;
  const time = $('#time').value;
  const repeat = $('#repeat').value;
  const advance = Math.max(0, parseInt($('#advance').value||'0',10));
  if (!title || !date || !time) return alert('Fill all fields.');
  const whenISO = combineDateTimeToISO(date, time);
  const item = { id:uuid(), type, title, whenISO, repeat, advanceMinutes:advance };
  const items = loadItems(); items.push(item); saveItems(items);
  e.target.reset();
});

$('#clearBtn').addEventListener('click', ()=>{
  if (confirm('Delete all items?')){
    localStorage.removeItem(LS_KEY);
    scheduleAll();
    render();
  }
});
$('#exportBtn').addEventListener('click', ()=>{
  const data = localStorage.getItem(LS_KEY) || '[]';
  const blob = new Blob([data], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'daily-assistant-data.json'; a.click();
  URL.revokeObjectURL(url);
});

// notification permission
$('#askPermBtn').addEventListener('click', async ()=>{
  const ok = await ensurePermission();
  alert(ok? 'Notifications enabled ✅' : 'Permission denied ❌');
});

// Wake Lock
$('#wakeLockBtn').addEventListener('click', async ()=>{
  try{
    if (!('wakeLock' in navigator)){ alert('Wake Lock not supported on this device.'); return; }
    if (wakeLock){ await wakeLock.release(); wakeLock=null; $('#wakeLockBtn').textContent='Keep Screen Awake'; return; }
    wakeLock = await navigator.wakeLock.request('screen');
    $('#wakeLockBtn').textContent='Release Wake Lock';
    wakeLock.addEventListener('release', ()=> $('#wakeLockBtn').textContent='Keep Screen Awake');
  }catch(e){ alert('Could not acquire wake lock.'); }
});

// Templates
$$('[data-template]').forEach(btn=>{
  btn.addEventListener('click', ()=> addItemFromTemplate(btn.getAttribute('data-template')));
});

// Install prompt (PWA)
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('#installBtn');
  btn.hidden = false;
  btn.addEventListener('click', async ()=>{
    btn.hidden = true;
    if (deferredPrompt){ deferredPrompt.prompt(); deferredPrompt = null; }
  }, { once:true });
});
