(function(){
'use strict';

/* =========================================================
   Stałe i stan
   ========================================================= */
const $ = s => document.querySelector(s);
const SW = 76;          // szerokość jednego miejsca
const SEAT_H = 46;      // wysokość miejsca
const BODY_H = 64;      // wysokość blatu stołu
const ROOM_W = 3200, ROOM_H = 2200, GRID = 10;
const KEY = 'plan-wesela-v1', ZKEY = 'plan-wesela-zoom';

const stage = $('#stage'), sizer = $('#sizer'), room = $('#room'), ctx = $('#ctx');

function store(k, v){ try{ localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }catch(e){} }
function fetchStored(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

let state = load() || sampleState();
const ui = { selTable: null, selGuest: null, search: '', zoom: parseFloat(fetchStored(ZKEY)) || 0.85, busy: false };
let undoStack = [], redoStack = [];
let occ = new Map();

function load(){
  try{
    const raw = fetchStored(KEY);
    if(!raw) return null;
    return validState(JSON.parse(raw));
  }catch(e){ return null; }
}
function toArr(v){
  if(Array.isArray(v)) return v.filter(Boolean);
  if(v && typeof v === 'object') return Object.values(v);
  return [];
}
// Normalizuje stan (także z bazy, która pomija puste tablice i pola null)
function validState(s){
  if(!s || typeof s !== 'object') return null;
  if(!('tables' in s) && !('guests' in s) && typeof s.nextId !== 'number') return null;
  s.tables = toArr(s.tables);
  s.guests = toArr(s.guests);
  s.tables.forEach(t => { t.n = t.n || 1; t.sides = t.sides || 2; });
  s.guests.forEach(g => {
    g.partnerId = g.partnerId ?? null;
    g.tableId = g.tableId ?? null;
    g.seat = g.seat ?? null;
  });
  let max = 0;
  s.tables.forEach(t => max = Math.max(max, t.id || 0));
  s.guests.forEach(g => max = Math.max(max, g.id || 0));
  if(!s.nextId || s.nextId <= max) s.nextId = max + 1;
  s.updatedAt = s.updatedAt || 0;
  return s;
}
function save(){
  state.updatedAt = Math.max(Date.now(), (state.updatedAt || 0) + 1);
  store(KEY, state);
  Sync.push();
}

function sampleState(){
  const s = { tables: [], guests: [], nextId: 1 };
  const addT = (name, x, y, n, sides) => s.tables.push({ id: s.nextId++, name, x, y, n, sides });
  addT('Stół Młodej Pary', 80, 80, 4, 1);
  addT('Stół 1', 80, 280, 5, 2);
  addT('Stół 2', 560, 280, 5, 2);
  const mk = name => ({ id: s.nextId++, name, partnerId: null, tableId: null, seat: null });
  const single = a => s.guests.push(mk(a));
  const pair = (a, b) => { const x = mk(a), y = mk(b); x.partnerId = y.id; y.partnerId = x.id; s.guests.push(x, y); };
  pair('Anna Nowak', 'Piotr Nowak');
  pair('Kasia Wiśniewska', 'Marek Wiśniewski');
  pair('Ewa Lis', 'Jan Lis');
  single('Tomek Kowalczyk');
  single('Ola Zielińska');
  single('Babcia Hela');
  return s;
}

/* =========================================================
   Pomocnicze
   ========================================================= */
function h(tag, props, ...kids){
  const el = document.createElement(tag);
  for(const k of kids.flat(Infinity)){
    if(k == null || k === false) continue;
    el.append(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
  for(const [k, v] of Object.entries(props || {})){
    if(k === 'class') el.className = v;
    else if(k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if(k === 'value') el.value = v;
    else el.setAttribute(k, v);
  }
  return el;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snapG = v => Math.round(v / GRID) * GRID;
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const byName = (a, b) => a.name.localeCompare(b.name, 'pl');
const tableById = id => state.tables.find(t => t.id === id) || null;
const guestById = id => state.guests.find(g => g.id === id) || null;

let toastTimer = null;
function toast(msg){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function download(name, blob){
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* =========================================================
   Miejsca i stoły
   ========================================================= */
// klucz miejsca: "t3" = góra, miejsce nr 4; "b0" = dół, miejsce nr 1
function seatsOf(t){
  const arr = [];
  for(let i = 0; i < t.n; i++) arr.push('t' + i);
  if(t.sides === 2) for(let i = 0; i < t.n; i++) arr.push('b' + i);
  return arr;
}
function seatLabel(t, key){
  const pos = +key.slice(1) + 1;
  if(t.sides === 1) return 'miejsce ' + pos;
  return (key[0] === 't' ? 'góra ' : 'dół ') + pos;
}
function tableHeight(t){ return SEAT_H * (t.sides === 2 ? 2 : 1) + BODY_H + 4; }
function seatCount(t){ return t.n * (t.sides === 2 ? 2 : 1); }
function usedCount(t){ return state.guests.filter(g => g.tableId === t.id).length; }

// usuwa gości z miejsc, które przestały istnieć (po zmianie długości stołu)
function pruneSeats(t){
  const ok = new Set(seatsOf(t));
  let c = 0;
  state.guests.forEach(g => {
    if(g.tableId === t.id && !ok.has(g.seat)){ g.tableId = null; g.seat = null; c++; }
  });
  return c;
}

function partnerSeatCandidates(t, seat){
  const side = seat[0], pos = +seat.slice(1), other = side === 't' ? 'b' : 't';
  const all = seatsOf(t);
  const pref = [side + (pos + 1), side + (pos - 1)];
  if(t.sides === 2) pref.push(other + pos, other + (pos + 1), other + (pos - 1));
  const valid = pref.filter(s => all.includes(s));
  const dist = s => Math.abs(+s.slice(1) - pos) + (s[0] === side ? 0 : 0.5);
  const rest = all.filter(s => !valid.includes(s) && s !== seat).sort((a, b) => dist(a) - dist(b));
  return valid.concat(rest);
}

function seatOwner(tid, seat, exclude){
  return state.guests.find(x => x.tableId === tid && x.seat === seat && !(exclude && exclude.has(x.id))) || null;
}

/* Przenosi gościa (razem z partnerem, jeśli jest w parze).
   tableId === null => zdjęcie ze stołu. */
function moveUnit(g, tableId, seat){
  const p = g.partnerId ? guestById(g.partnerId) : null;
  const unit = p ? [g, p] : [g];
  if(tableId == null){
    unit.forEach(x => { x.tableId = null; x.seat = null; });
    return { ok: true };
  }
  const t = tableById(tableId);
  if(!t || !seatsOf(t).includes(seat)) return { ok: false, msg: 'Nieprawidłowe miejsce.' };
  const ids = new Set(unit.map(x => x.id));
  const blocker = seatOwner(tableId, seat, ids);

  if(!p){
    if(blocker){ blocker.tableId = g.tableId; blocker.seat = g.seat; } // zamiana miejscami
    g.tableId = tableId; g.seat = seat;
    return { ok: true };
  }
  if(blocker) return { ok: false, msg: 'To miejsce jest zajęte. Parę można przenieść tylko na wolne miejsca.' };
  const ps = partnerSeatCandidates(t, seat).find(s => !seatOwner(tableId, s, ids));
  if(!ps) return { ok: false, msg: 'Przy tym stole nie ma wolnego miejsca dla partnera.' };
  g.tableId = tableId; g.seat = seat;
  p.tableId = tableId; p.seat = ps;
  return { ok: true };
}

/* =========================================================
   Pary
   ========================================================= */
function unpair(g){
  if(g.partnerId){
    const p = guestById(g.partnerId);
    if(p) p.partnerId = null;
    g.partnerId = null;
  }
}
function pairUp(a, b){
  unpair(a); unpair(b);
  a.partnerId = b.id; b.partnerId = a.id;
  // jeśli jedno siedzi, a drugie nie – posadź obok
  const near = (guest, anchor) => {
    const t = tableById(anchor.tableId);
    if(!t) return;
    const free = partnerSeatCandidates(t, anchor.seat).find(s => !seatOwner(t.id, s));
    if(free){ guest.tableId = t.id; guest.seat = free; }
  };
  if(a.tableId != null && b.tableId == null) near(b, a);
  else if(b.tableId != null && a.tableId == null) near(a, b);
}
function pairColors(g){
  const k = Math.min(g.id, g.partnerId);
  const hue = Math.round((k * 137.508) % 360);
  return { bg: `hsl(${hue} 70% 91%)`, bd: `hsl(${hue} 50% 58%)` };
}

/* =========================================================
   Akcje (z cofaniem)
   ========================================================= */
function act(fn){
  const snap = JSON.stringify(state);
  const r = fn();
  if(r && r.ok === false){ toast(r.msg); return false; }
  if(JSON.stringify(state) !== snap){
    undoStack.push(snap);
    if(undoStack.length > 80) undoStack.shift();
    redoStack = [];
    save();
  }
  render();
  return true;
}
function fixSelection(){
  if(!tableById(ui.selTable)) ui.selTable = null;
  if(!guestById(ui.selGuest)) ui.selGuest = null;
}
function undo(){
  const s = undoStack.pop();
  if(!s) return;
  redoStack.push(JSON.stringify(state));
  state = JSON.parse(s); fixSelection(); save(); render();
}
function redo(){
  const s = redoStack.pop();
  if(!s) return;
  undoStack.push(JSON.stringify(state));
  state = JSON.parse(s); fixSelection(); save(); render();
}

function addTable(){
  act(() => {
    const z = ui.zoom, k = state.tables.length % 6;
    const t = {
      id: state.nextId++, name: 'Stół ' + (state.tables.length + 1),
      x: snapG(stage.scrollLeft / z + 60 + k * 30), y: snapG(stage.scrollTop / z + 60 + k * 30),
      n: 5, sides: 2
    };
    state.tables.push(t);
    ui.selTable = t.id; ui.selGuest = null;
  });
}
function duplicateTable(t){
  act(() => {
    const c = { id: state.nextId++, name: t.name + ' (kopia)', x: t.x + 30, y: t.y + 30, n: t.n, sides: t.sides };
    state.tables.push(c);
    ui.selTable = c.id;
  });
}
function deleteTable(t){
  act(() => {
    state.guests.forEach(g => { if(g.tableId === t.id){ g.tableId = null; g.seat = null; } });
    state.tables = state.tables.filter(x => x.id !== t.id);
    ui.selTable = null;
  });
}
function deleteGuest(g){
  act(() => {
    unpair(g);
    state.guests = state.guests.filter(x => x.id !== g.id);
    ui.selGuest = null;
  });
}

function addGuestsFromText(text){
  let count = 0;
  const made = [];
  const mk = name => { const g = { id: state.nextId++, name, partnerId: null, tableId: null, seat: null }; made.push(g); count++; return g; };
  act(() => {
    text.split(/\r?\n/).forEach(line => {
      const parts = line.split('+').map(s => s.trim()).filter(Boolean);
      if(!parts.length) return;
      if(parts.length >= 2){
        const a = mk(parts[0]), b = mk(parts[1]);
        a.partnerId = b.id; b.partnerId = a.id;
        parts.slice(2).forEach(mk);
      } else mk(parts[0]);
    });
    made.forEach(g => state.guests.push(g));
  });
  if(count) toast('Dodano gości: ' + count);
}

/* =========================================================
   Rysowanie
   ========================================================= */
function render(){
  renderStats();
  renderSidebar();
  renderRoom();
  renderCtx();
  $('#btnUndo').disabled = !undoStack.length;
  $('#btnRedo').disabled = !redoStack.length;
}

function isHit(g){
  const q = norm(ui.search.trim());
  return !!q && norm(g.name).includes(q);
}

function guestEl(g, inSeat){
  const p = g.partnerId ? guestById(g.partnerId) : null;
  const el = h('div', {
    class: 'guest' + (inSeat ? ' in-seat' : '') + (ui.selGuest === g.id ? ' selected' : '') + (p ? ' paired' : '') + (isHit(g) ? ' hit' : ''),
    'data-gid': g.id,
    title: g.name + (p ? '  ♥  ' + p.name : '')
  },
    h('span', { class: 'gname' }, g.name),
    (!inSeat && p) ? h('span', { class: 'gpartner' }, '♥ ' + p.name) : null
  );
  if(p){ const c = pairColors(g); el.style.background = c.bg; el.style.borderColor = c.bd; }
  return el;
}

function renderStats(){
  const seated = state.guests.filter(g => g.tableId != null).length;
  const total = state.guests.length;
  const seats = state.tables.reduce((s, t) => s + seatCount(t), 0);
  const pairs = state.guests.filter(g => g.partnerId).length / 2;
  $('#stats').replaceChildren(
    h('div', {}, 'Posadzeni: ', h('b', {}, seated + ' / ' + total), ' · Pary: ', h('b', {}, pairs)),
    h('div', {}, 'Stoły: ', h('b', {}, state.tables.length), ' · Miejsca: ', h('b', {}, seats), ' · Wolne: ', h('b', {}, seats - seated))
  );
}

function renderSidebar(){
  const list = $('#unseated');
  list.replaceChildren();
  const q = norm(ui.search.trim());
  const un = state.guests.filter(g => g.tableId == null);
  const shown = un.filter(g => !q || norm(g.name).includes(q)).sort(byName);
  if(!un.length){
    list.append(h('div', { class: 'empty-note' }, state.guests.length ? 'Wszyscy goście są posadzeni 🎉' : 'Dodaj pierwszych gości w polu powyżej.'));
  }
  shown.forEach(g => list.append(guestEl(g, false)));
  if(q){
    const seated = state.guests.filter(g => g.tableId != null && norm(g.name).includes(q)).sort(byName);
    if(seated.length){
      list.append(h('div', { class: 'sect' }, 'Już posadzeni'));
      seated.forEach(g => {
        const t = tableById(g.tableId);
        list.append(h('div', { class: 'found', onclick: () => focusGuest(g.id) },
          h('span', { class: 'gname' }, g.name),
          h('span', { class: 'gpartner' }, t ? t.name + ', ' + seatLabel(t, g.seat) : '')));
      });
    }
  }
}

function focusGuest(id){
  ui.selGuest = id; ui.selTable = null;
  render();
  const el = room.querySelector('.guest[data-gid="' + id + '"]');
  if(el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

function tableEl(t){
  const seatRow = side => {
    const row = h('div', { class: 'seat-row' });
    for(let i = 0; i < t.n; i++){
      const key = side + i;
      const g = occ.get(t.id + ':' + key);
      const seat = h('div', { class: 'seat' + (g ? '' : ' empty'), 'data-tid': t.id, 'data-seat': key, 'data-n': i + 1 });
      if(g) seat.append(guestEl(g, true));
      row.append(seat);
    }
    return row;
  };
  const el = h('div', { class: 'table' + (ui.selTable === t.id ? ' selected' : ''), 'data-tid': t.id });
  el.style.left = t.x + 'px';
  el.style.top = t.y + 'px';
  el.style.width = (t.n * SW) + 'px';
  el.append(seatRow('t'));
  el.append(h('div', { class: 'table-body' },
    h('div', { class: 'tname', title: t.name }, t.name),
    h('div', { class: 'tcount' }, usedCount(t) + ' / ' + seatCount(t)),
    h('div', { class: 'resize', title: 'Przeciągnij, aby zmienić długość stołu' })
  ));
  if(t.sides === 2) el.append(seatRow('b'));
  return el;
}

function renderRoom(){
  occ = new Map();
  state.guests.forEach(g => { if(g.tableId != null) occ.set(g.tableId + ':' + g.seat, g); });
  room.replaceChildren(...state.tables.map(tableEl));
}

function renderCtx(){
  ctx.replaceChildren();
  const t = tableById(ui.selTable), g = guestById(ui.selGuest);
  const btn = (label, fn, cls) => h('button', { class: 'btn' + (cls ? ' ' + cls : ''), onclick: fn }, label);

  if(t){
    const setN = n => { n = clamp(n, 1, 20); if(n === t.n) return; act(() => { t.n = n; const c = pruneSeats(t); if(c) toast('Goście z usuniętych miejsc wrócili na listę: ' + c); }); };
    ctx.append(
      h('strong', {}, 'Stół'),
      h('input', { type: 'text', class: 'ctx-input', value: t.name, onchange: e => act(() => { t.name = e.target.value.trim() || t.name; }) }),
      h('span', { class: 'label' }, 'Miejsc po stronie:'),
      h('div', { class: 'stepper' }, btn('−', () => setN(t.n - 1)), h('span', {}, t.n), btn('+', () => setN(t.n + 1))),
      h('select', { class: 'ctx-input', value: String(t.sides), onchange: e => act(() => { t.sides = +e.target.value; const c = pruneSeats(t); if(c) toast('Goście z usuniętych miejsc wrócili na listę: ' + c); }) },
        h('option', { value: '2' }, 'Siedzą po obu stronach'),
        h('option', { value: '1' }, 'Siedzą po jednej stronie')),
      h('span', { class: 'label' }, usedCount(t) + ' / ' + seatCount(t) + ' zajętych'),
      h('span', { style: 'flex:1' }),
      btn('Duplikuj', () => duplicateTable(t)),
      btn('Usuń stół', () => deleteTable(t), 'danger')
    );
  } else if(g){
    const p = g.partnerId ? guestById(g.partnerId) : null;
    const gt = g.tableId != null ? tableById(g.tableId) : null;
    const others = state.guests.filter(x => x.id !== g.id && !x.partnerId).sort(byName);
    ctx.append(
      h('strong', {}, 'Gość'),
      h('input', { type: 'text', class: 'ctx-input', value: g.name, onchange: e => act(() => { g.name = e.target.value.trim() || g.name; }) }),
      gt ? h('span', { class: 'label' }, gt.name + ', ' + seatLabel(gt, g.seat)) : h('span', { class: 'label' }, 'nieposadzony'),
      p ? h('span', { class: 'tag' }, '♥ Para: ' + p.name) : null,
      p ? btn('Rozłącz parę', () => act(() => unpair(g))) :
        h('select', { class: 'ctx-input', onchange: e => { const o = guestById(+e.target.value); if(o) act(() => pairUp(g, o)); } },
          h('option', { value: '' }, 'Połącz w parę z…'),
          others.map(o => h('option', { value: o.id }, o.name))),
      gt ? btn('Zdejmij ze stołu', () => act(() => moveUnit(g, null, null))) : null,
      h('span', { style: 'flex:1' }),
      btn('Usuń gościa', () => deleteGuest(g), 'danger')
    );
  } else {
    ctx.append(h('span', { class: 'hint' }, 'Kliknij stół lub gościa, aby go edytować. Gości przeciągaj na miejsca przy stołach, stoły za blat, a długość stołu zmienisz uchwytem po prawej stronie blatu. Ctrl+Z cofa zmiany.'));
  }
}

/* =========================================================
   Przeciąganie: goście
   ========================================================= */
let hoverEl = null;
function setHover(t){
  const el = t ? t.el : null;
  if(el === hoverEl) return;
  if(hoverEl) hoverEl.classList.remove('over');
  hoverEl = el;
  if(el) el.classList.add('over');
}
function dropTarget(ev){
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  if(!el) return null;
  const seat = el.closest('.seat');
  if(seat) return { type: 'seat', tid: +seat.dataset.tid, seat: seat.dataset.seat, el: seat };
  const sb = el.closest('#sidebar');
  if(sb) return { type: 'list', el: sb };
  return null;
}
function autoscroll(ev){
  const r = stage.getBoundingClientRect(), m = 40, v = 16;
  if(ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
  if(ev.clientY < r.top + m) stage.scrollTop -= v; else if(ev.clientY > r.bottom - m) stage.scrollTop += v;
  if(ev.clientX < r.left + m) stage.scrollLeft -= v; else if(ev.clientX > r.right - m) stage.scrollLeft += v;
}

function startGuestPress(e, gid){
  e.preventDefault();
  const g0 = guestById(gid);
  if(!g0) return;
  const sx = e.clientX, sy = e.clientY;
  let dragging = false, ghost = null;
  ui.busy = true;

  function move(ev){
    if(!dragging){
      if(Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      dragging = true;
      const p = g0.partnerId ? guestById(g0.partnerId) : null;
      ghost = h('div', { class: 'ghost' }, g0.name + (p ? '  ♥  ' + p.name : ''));
      document.body.append(ghost);
      document.body.classList.add('is-dragging');
      const src = document.querySelector('.guest[data-gid="' + gid + '"]');
      if(src) src.classList.add('dragging');
    }
    ghost.style.transform = 'translate(' + (ev.clientX + 12) + 'px,' + (ev.clientY + 12) + 'px)';
    autoscroll(ev);
    setHover(dropTarget(ev));
  }
  function finish(ev, apply){
    ui.busy = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    const target = (dragging && apply) ? dropTarget(ev) : null;
    if(ghost) ghost.remove();
    document.body.classList.remove('is-dragging');
    setHover(null);
    document.querySelectorAll('.guest.dragging').forEach(x => x.classList.remove('dragging'));
    if(!dragging){
      if(apply){ ui.selGuest = gid; ui.selTable = null; render(); }
      return;
    }
    if(!target) return;
    const g = guestById(gid);
    if(!g) return;
    act(() => {
      const r = target.type === 'seat' ? moveUnit(g, target.tid, target.seat) : moveUnit(g, null, null);
      if(r.ok){ ui.selGuest = g.id; ui.selTable = null; }
      return r;
    });
  }
  function up(ev){ finish(ev, true); }
  function cancel(ev){ finish(ev, false); }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

/* =========================================================
   Przeciąganie: stoły i zmiana długości
   ========================================================= */
function startTableDrag(e, tid){
  e.preventDefault();
  if(ui.selTable !== tid || ui.selGuest != null){ ui.selTable = tid; ui.selGuest = null; render(); }
  const t = tableById(tid);
  const el = room.querySelector('.table[data-tid="' + tid + '"]');
  if(!t || !el) return;
  const sx = e.clientX, sy = e.clientY, ox = t.x, oy = t.y, snap = JSON.stringify(state);
  let moved = false;
  ui.busy = true;
  function move(ev){
    const dx = (ev.clientX - sx) / ui.zoom, dy = (ev.clientY - sy) / ui.zoom;
    if(!moved && Math.hypot(dx, dy) * ui.zoom < 4) return;
    moved = true;
    t.x = clamp(snapG(ox + dx), 0, ROOM_W - t.n * SW);
    t.y = clamp(snapG(oy + dy), 0, ROOM_H - tableHeight(t));
    el.style.left = t.x + 'px';
    el.style.top = t.y + 'px';
    autoscroll(ev);
  }
  function up(){
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    ui.busy = false;
    if(moved){
      undoStack.push(snap); redoStack = [];
      if(undoStack.length > 80) undoStack.shift();
      save(); render();
    }
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function startResize(e, tid){
  e.preventDefault();
  if(ui.selTable !== tid || ui.selGuest != null){ ui.selTable = tid; ui.selGuest = null; }
  const t0 = tableById(tid);
  if(!t0) return;
  const sx = e.clientX, n0 = t0.n, snap = JSON.stringify(state);
  let lastN = n0, removed = 0;
  ui.busy = true;
  render();
  function move(ev){
    const n = clamp(n0 + Math.round((ev.clientX - sx) / ui.zoom / SW), 1, 20);
    if(n === lastN) return;
    lastN = n;
    state = JSON.parse(snap);          // zawsze liczymy od stanu początkowego
    const t = tableById(tid);
    t.n = n;
    removed = pruneSeats(t);
    render();
  }
  function up(){
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    ui.busy = false;
    if(JSON.stringify(state) !== snap){
      undoStack.push(snap); redoStack = [];
      if(undoStack.length > 80) undoStack.shift();
      save();
      if(removed) toast('Goście z usuniętych miejsc wrócili na listę: ' + removed);
    }
    render();
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

document.addEventListener('pointerdown', e => {
  if(e.button !== 0) return;
  const t = e.target;
  if(t.closest('input,select,textarea,button,dialog,.found')) return;
  // zatwierdź ewentualnie edytowane pole (np. nazwa stołu), zanim cokolwiek się odrysuje
  const a = document.activeElement;
  if(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) a.blur();

  const guest = t.closest('.guest');
  if(guest){ startGuestPress(e, +guest.dataset.gid); return; }
  const handle = t.closest('.resize');
  if(handle){ startResize(e, +handle.closest('.table').dataset.tid); return; }
  const body = t.closest('.table-body');
  if(body){ startTableDrag(e, +body.closest('.table').dataset.tid); return; }
  if(t.closest('#stage') && !t.closest('.table')){
    if(ui.selTable != null || ui.selGuest != null){ ui.selTable = null; ui.selGuest = null; render(); }
  }
});

/* =========================================================
   Powiększenie
   ========================================================= */
function applyZoom(){
  const z = ui.zoom;
  sizer.style.width = (ROOM_W * z) + 'px';
  sizer.style.height = (ROOM_H * z) + 'px';
  room.style.transform = 'scale(' + z + ')';
  $('#zoomLabel').textContent = Math.round(z * 100) + '%';
  store(ZKEY, String(z));
}
function setZoom(z, cx, cy){
  z = clamp(z, 0.3, 1.5);
  const old = ui.zoom, r = stage.getBoundingClientRect();
  const px = (cx == null ? r.left + r.width / 2 : cx) - r.left;
  const py = (cy == null ? r.top + r.height / 2 : cy) - r.top;
  const wx = (stage.scrollLeft + px) / old, wy = (stage.scrollTop + py) / old;
  ui.zoom = z; applyZoom();
  stage.scrollLeft = wx * z - px; stage.scrollTop = wy * z - py;
}
function contentBBox(){
  if(!state.tables.length) return null;
  let x1 = 1e9, y1 = 1e9, x2 = 0, y2 = 0;
  state.tables.forEach(t => {
    x1 = Math.min(x1, t.x); y1 = Math.min(y1, t.y);
    x2 = Math.max(x2, t.x + t.n * SW); y2 = Math.max(y2, t.y + tableHeight(t));
  });
  return { x1, y1, x2, y2 };
}
function fit(){
  const b = contentBBox();
  if(!b) return;
  const w = b.x2 - b.x1 + 80, hh = b.y2 - b.y1 + 80;
  ui.zoom = clamp(Math.min(stage.clientWidth / w, stage.clientHeight / hh), 0.3, 1.2);
  applyZoom();
  stage.scrollLeft = (b.x1 - 40) * ui.zoom;
  stage.scrollTop = (b.y1 - 40) * ui.zoom;
}
stage.addEventListener('wheel', e => {
  if(e.ctrlKey || e.metaKey){
    e.preventDefault();
    setZoom(ui.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY);
  }
}, { passive: false });

/* =========================================================
   Druk, eksport, import
   ========================================================= */
window.addEventListener('beforeprint', () => {
  const b = contentBBox();
  if(!b) return;
  const w = b.x2 - b.x1 + 40, hh = b.y2 - b.y1 + 40;
  const s = Math.min(1000 / w, 680 / hh, 1.2);
  sizer.style.width = (w * s) + 'px';
  sizer.style.height = (hh * s) + 'px';
  room.style.transform = 'scale(' + s + ') translate(' + (-(b.x1 - 20)) + 'px,' + (-(b.y1 - 20)) + 'px)';
});
window.addEventListener('afterprint', applyZoom);

function exportJson(){
  download('plan-wesela.json', new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
}
function exportCsv(){
  const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
  const order = g => {
    const t = g.tableId != null ? tableById(g.tableId) : null;
    const seatNo = g.seat ? (g.seat[0] === 't' ? 0 : 100) + (+g.seat.slice(1)) : 0;
    return [t ? state.tables.indexOf(t) : 9999, seatNo];
  };
  const rows = [['Gość', 'Stół', 'Miejsce', 'Para z']];
  [...state.guests].sort((a, b) => {
    const x = order(a), y = order(b);
    return (x[0] - y[0]) || (x[1] - y[1]) || byName(a, b);
  }).forEach(g => {
    const t = g.tableId != null ? tableById(g.tableId) : null;
    const p = g.partnerId ? guestById(g.partnerId) : null;
    rows.push([g.name, t ? t.name : '', t ? seatLabel(t, g.seat) : '', p ? p.name : '']);
  });
  const csv = '\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  download('goscie-wesele.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

/* =========================================================
   Podpięcie przycisków i skróty
   ========================================================= */
$('#btnAddTable').onclick = addTable;
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnZoomIn').onclick = () => setZoom(ui.zoom * 1.15);
$('#btnZoomOut').onclick = () => setZoom(ui.zoom / 1.15);
$('#btnFit').onclick = fit;
$('#btnCsv').onclick = exportCsv;
$('#btnPrint').onclick = () => window.print();
$('#btnExport').onclick = exportJson;
$('#btnImport').onclick = () => $('#fileInput').click();
$('#btnNew').onclick = () => {
  if(!confirm('Wyczyścić cały plan (stoły i gości)? Można to jeszcze cofnąć przyciskiem „Cofnij”.')) return;
  act(() => { state = { tables: [], guests: [], nextId: 1 }; ui.selTable = null; ui.selGuest = null; });
};
$('#fileInput').onchange = e => {
  const f = e.target.files[0];
  e.target.value = '';
  if(!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try{
      const data = validState(JSON.parse(rd.result));
      if(!data) throw new Error('bad');
      act(() => { state = data; ui.selTable = null; ui.selGuest = null; });
      setTimeout(fit, 0);
      toast('Wczytano plan z pliku.');
    }catch(err){ toast('Nie udało się wczytać pliku – to nie wygląda na plan z tej aplikacji.'); }
  };
  rd.readAsText(f);
};

$('#bulkDlg').addEventListener('close', () => { $('#bulkText').value = ''; });
$('#btnBulk').onclick = () => $('#bulkDlg').showModal();
$('#bulkOk').onclick = () => { addGuestsFromText($('#bulkText').value); };

$('#addGuest').addEventListener('keydown', e => {
  if(e.key === 'Enter' && e.target.value.trim()){
    addGuestsFromText(e.target.value);
    e.target.value = '';
  }
});
$('#search').addEventListener('input', e => {
  ui.search = e.target.value;
  renderSidebar();
  renderRoom();
});

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if(mod && !typing && e.key.toLowerCase() === 'z' && !e.shiftKey){ e.preventDefault(); undo(); }
  else if(mod && !typing && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))){ e.preventDefault(); redo(); }
  else if(e.key === 'Escape' && !typing){ ui.selTable = null; ui.selGuest = null; render(); }
});

/* =========================================================
   Synchronizacja między urządzeniami (patrz sync.js)
   ========================================================= */
const SYNC_LABELS = {
  unconfigured: '☁ Tylko to urządzenie',
  local: '☁ Włącz synchronizację',
  syncing: '☁ Synchronizuję…',
  ok: '☁ Zsynchronizowano',
  error: '⚠ Brak połączenia'
};
function setSyncStatus(s){
  const b = $('#btnSync');
  b.textContent = SYNC_LABELS[s] || SYNC_LABELS.local;
  b.dataset.status = s;
  b.title = s === 'error' ? 'Nie można połączyć z bazą – zmiany czekają w tej przeglądarce i wyślą się po odzyskaniu połączenia.' : 'Synchronizacja planu między urządzeniami';
}
function isBusy(){
  const a = document.activeElement;
  const editing = a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && ctx.contains(a);
  return ui.busy || editing || $('#bulkDlg').open || $('#syncDlg').open;
}
function applyRemote(data){
  if(isBusy()) return false;
  const s = validState(data);
  if(!s) return false;
  state = s;
  undoStack = []; redoStack = [];
  fixSelection();
  store(KEY, state);
  render();
  toast('Wczytano zmiany z innego urządzenia.');
  return true;
}

function refreshSyncDlg(){
  const conf = Sync.configured(), on = Sync.enabled();
  $('#syncBox').style.display = conf ? '' : 'none';
  $('#syncInfo').textContent = !conf
    ? 'Synchronizacja nie jest jeszcze skonfigurowana. Wpisz adres bazy Firebase w pliku config.js (instrukcja w README.md). Do tego czasu plan zapisuje się tylko w tej przeglądarce – możesz go przenosić przyciskami „Zapisz do pliku” i „Wczytaj z pliku”.'
    : on
      ? 'Połączono. Wpisz ten sam kod na pozostałych urządzeniach – zmiany będą widoczne wszędzie (odświeżanie co kilka sekund).'
      : 'Wpisz ten sam kod planu na każdym urządzeniu albo wygeneruj nowy na pierwszym.';
  $('#syncCode').value = Sync.getCode();
  $('#syncDisconnect').style.display = on ? '' : 'none';
}
$('#btnSync').onclick = () => { refreshSyncDlg(); $('#syncDlg').showModal(); };
$('#syncGen').onclick = () => {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  $('#syncCode').value = Array.from(a, b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
};
$('#syncDisconnect').onclick = () => {
  Sync.disconnect();
  $('#syncDlg').close();
  toast('Rozłączono. Plan zostaje zapisany w tej przeglądarce.');
};
$('#syncConnect').onclick = async () => {
  const code = $('#syncCode').value.trim();
  try{
    const remote = await Sync.connect(code);
    $('#syncDlg').close();
    if(remote && typeof remote === 'object'){
      const load = confirm('Pod tym kodem na serwerze jest już zapisany plan.\n\nOK – wczytaj go na to urządzenie (plan z tego urządzenia zostanie zastąpiony)\nAnuluj – nadpisz serwer planem z tego urządzenia');
      if(load) applyRemote(remote); else save();
    } else {
      save();
    }
    toast('Połączono – plan będzie synchronizowany.');
  }catch(err){
    toast(err.message || 'Nie udało się połączyć.');
  }
};
Sync.init({ getState: () => state, onRemote: applyRemote, onStatus: setSyncStatus });

/* =========================================================
   Start
   ========================================================= */
applyZoom();
render();
})();
