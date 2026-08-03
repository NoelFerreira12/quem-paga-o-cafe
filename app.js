import { createStore } from './store.js?v=13';
import { requireUnlock } from './auth.js?v=13';
import { t, getLang, setLang, otherLang, months, weekdays, applyStatic } from './i18n.js?v=13';

const AVATAR_COLORS = ['#4a3323', '#2f5d50', '#8a4b2b', '#3b5b7a', '#6b3f63', '#7a5c1e', '#455a3f', '#734a4a'];
const HISTORY_LIMIT = 25;
const ANIM_KEY = 'cafeAnim_v1';
const SOUND_KEY = 'cafeSound_v1';
const THEME_KEY = 'cafeTheme_v1';
const SPIN_EASE = [0.13, 0.72, 0.10, 1];
const SPIN_MS = 5600;
const SPIN_MS_REDUCED = 320;
const THEME_COLORS = { light: '#4a3323', dark: '#14100b' };

const ICON = {
  cup: 'i-cup',
  coin: 'i-coin',
  hash: 'i-hash',
  chart: 'i-chart',
  down: 'i-down',
  trophy: 'i-trophy'
};

let store = null;
let state = { luck: 20, people: [], selectedIds: [], history: [] };
let editDraft = null;
let undoSnapshot = null;
let lastHistoryId = null;
let selfDecisionId = null;
let initialized = false;
let drawBusy = false;
let stageToken = 0;
let stageOpen = false;
let lastFocus = null;
let audioCtx = null;
let audioBus = null;
let noiseBuffer = null;
let riser = null;
let tickTimers = [];
let modalResolve = null;
let statusMode = 'local';
let knownHistoryIds = new Set();

const $ = id => document.getElementById(id);

function rand(){
  const c = globalThis.crypto;
  if(c && c.getRandomValues){
    const buf = new Uint32Array(2);
    c.getRandomValues(buf);
    return ((buf[0] >>> 5) * 67108864 + (buf[1] >>> 6)) / 9007199254740992;
  }
  return Math.random();
}

function uid(prefix){
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function balanceOf(p){
  return p.pago - p.idas;
}

function chanceWeights(parts, luck){
  const L = Math.min(1, Math.max(0, (Number(luck) || 0) / 100));
  const n = parts.length || 1;
  const balances = parts.map(balanceOf);
  const maxB = balances.length ? Math.max(...balances) : 0;
  const bases = balances.map(b => (maxB - b) + 1);
  const sum = bases.reduce((a, b) => a + b, 0) || 1;
  return parts.map((p, i) => (1 - L) * (bases[i] / sum) + L * (1 / n));
}

function pickIndex(weights){
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let r = rand() * total;
  for(let i = 0; i < weights.length; i++){
    r -= weights[i];
    if(r <= 0) return i;
  }
  return weights.length - 1;
}

function weightedPick(parts, luck){
  return parts[pickIndex(chanceWeights(parts, luck))];
}

function percentSplit(weights){
  const raw = weights.map(w => w * 100);
  const out = raw.map(v => Math.floor(v));
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  for(let k = 0; k < order.length && left > 0; k++, left--) out[order[k].i] += 1;
  return out;
}

function lastPayerName(history){
  return Array.isArray(history) && history.length ? history[0].payer : null;
}

function eligiblePool(parts, history){
  const last = lastPayerName(history);
  if(!last || parts.length < 2) return parts;
  const pool = parts.filter(p => p.name !== last);
  return pool.length ? pool : parts;
}

function chancesByName(parts){
  const pct = percentSplit(chanceWeights(parts, state.luck));
  const map = {};
  parts.forEach((p, i) => { map[p.name] = pct[i]; });
  return map;
}

function wait(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toast(message, tone){
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = 'toast';
  if(tone) el.dataset.tone = tone;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, 3200);
}

function closeModal(answer){
  const resolve = modalResolve;
  modalResolve = null;
  $('modal').classList.add('hidden');
  if(resolve) resolve(Boolean(answer));
}

function askConfirm(message, okLabel){
  closeModal(false);
  $('modalText').textContent = message;
  $('modalOk').textContent = okLabel || t('modal.confirm');
  $('modal').classList.remove('hidden');
  $('modalOk').focus();
  return new Promise(resolve => { modalResolve = resolve; });
}

function getTheme(){
  try{
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  }catch(e){
    return 'auto';
  }
}

function systemDark(){
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(){
  const theme = getTheme();
  const root = document.documentElement;
  if(theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'auto' && systemDark());
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', dark ? THEME_COLORS.dark : THEME_COLORS.light);
  $('themeBtn').setAttribute('aria-label', dark ? t('top.themeLight') : t('top.themeDark'));
}

function toggleTheme(){
  const theme = getTheme();
  const dark = theme === 'auto' ? systemDark() : theme === 'dark';
  try{ localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark'); }catch(e){ /* modo privado */ }
  applyTheme();
}

function signed(n){
  return n > 0 ? '+' + n : String(n);
}

function saldoLabel(p){
  const b = balanceOf(p);
  if(b < 0) return t('balance.owes', { n: -b });
  if(b > 0) return t('balance.ahead', { n: b });
  return t('balance.even');
}

function toneOf(p){
  const b = balanceOf(p);
  return b < 0 ? 'debt' : b > 0 ? 'ahead' : 'even';
}

function icon(name, size){
  const s = size || 14;
  return `<svg class="ico" width="${s}" height="${s}" aria-hidden="true"><use href="#${name}"/></svg>`;
}

function shortDate(dateStr){
  const parts = String(dateStr).split('/');
  if(parts.length !== 3) return dateStr;
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if(!day || !month || !year) return dateStr;
  const when = new Date(year, month - 1, day);
  const today = new Date();
  const dayMs = 86400000;
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - when) / dayMs);
  if(diff === 0) return t('history.today');
  if(diff === 1) return t('history.yesterday');
  return day + ' ' + (months()[month - 1] || '');
}

function avatarGroupHtml(names){
  if(names.length === 0) return `<span class="group-empty">${escapeHtml(t('history.alone'))}</span>`;
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  const bits = shown.map(n => `<span class="group-item" title="${escapeHtml(n)}">${avatarHtml(n, 'avatar-xs')}</span>`).join('');
  const more = rest > 0 ? `<span class="group-more">${escapeHtml(t('history.others', { n: rest }))}</span>` : '';
  return `<span class="avatar-group" title="${escapeHtml(names.join(', '))}">${bits}${more}</span>`;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function colorForName(name){
  let hash = 0;
  for(let i = 0; i < name.length; i++){ hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff; }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initialsFor(name){
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if(parts.length === 0) return '?';
  if(parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function emptyStateHtml(text){
  return '<li class="empty-state">' + escapeHtml(text) + '</li>';
}

function avatarHtml(name, extraClass){
  return `<div class="avatar ${extraClass || ''}" style="background:${colorForName(name)}">${escapeHtml(initialsFor(name))}</div>`;
}

function renderPeopleList(){
  const ul = $('peopleList');
  ul.innerHTML = '';
  if(state.people.length === 0){
    ul.innerHTML = emptyStateHtml(t('team.empty'));
    return;
  }
  state.people.forEach(p => {
    const li = document.createElement('li');
    li.className = 'person-row';
    li.dataset.id = p.id;
    li.innerHTML = `
      ${avatarHtml(p.name)}
      <div class="person-main">
        <span class="person-name">${escapeHtml(p.name)}</span>
        <span class="person-stats">
          <span class="metric" title="${escapeHtml(t('team.drank', { n: p.idas }))}">${icon(ICON.cup, 13)}${p.idas}</span>
          <span class="metric" title="${escapeHtml(t('team.paid', { n: p.pago }))}">${icon(ICON.coin, 13)}${p.pago}</span>
          <span class="pill" data-tone="${toneOf(p)}">${escapeHtml(saldoLabel(p))}</span>
        </span>
      </div>
      <span class="row-tools">
        <button class="row-btn edit-btn" data-id="${escapeHtml(p.id)}" aria-label="${escapeHtml(t('team.rename', { name: p.name }))}">
          <svg width="15" height="15"><use href="#i-pencil"/></svg>
        </button>
        <button class="row-btn remove-btn" data-id="${escapeHtml(p.id)}" aria-label="${escapeHtml(t('team.remove', { name: p.name }))}">
          <svg width="15" height="15"><use href="#i-trash"/></svg>
        </button>
      </span>
    `;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => startRename(btn.dataset.id));
  });
  ul.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removePerson(btn.dataset.id));
  });
}

function startRename(id){
  const person = state.people.find(p => p.id === id);
  if(!person) return;
  const li = $('peopleList').querySelector(`li[data-id="${id}"]`);
  if(!li) return;
  const nameEl = li.querySelector('.person-name');
  if(!nameEl || li.querySelector('.rename-input')) return;

  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = person.name;
  input.maxLength = 30;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const finish = save => {
    if(settled) return;
    settled = true;
    if(save) commitRename(id, input.value);
    else renderPeopleList();
  };
  input.addEventListener('keydown', event => {
    if(event.key === 'Enter'){ event.preventDefault(); finish(true); }
    else if(event.key === 'Escape'){ event.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function commitRename(id, rawName){
  const newName = rawName.trim();
  const person = state.people.find(p => p.id === id);
  if(!person || !newName || newName === person.name){ renderPeopleList(); return; }
  if(state.people.some(p => p.id !== id && p.name.toLowerCase() === newName.toLowerCase())){
    toast(t('team.dupe'), 'warn');
    renderPeopleList();
    return;
  }
  store.commit(current => {
    const target = current.people.find(p => p.id === id);
    if(!target) return null;
    const old = target.name;
    target.name = newName;
    current.history.forEach(h => {
      if(h.payer === old) h.payer = newName;
      h.participants = h.participants.map(n => (n === old ? newName : n));
    });
    return { next: current };
  });
}

function renderSelectionList(){
  const ul = $('selectionList');
  ul.innerHTML = '';
  if(state.people.length === 0){
    ul.innerHTML = emptyStateHtml(t('today.empty'));
  } else {
    const selected = state.people.filter(p => state.selectedIds.includes(p.id));
    const pool = eligiblePool(selected, state.history);
    const pct = percentSplit(chanceWeights(pool, state.luck));
    const chanceById = {};
    pool.forEach((p, i) => { chanceById[p.id] = pct[i]; });

    state.people.forEach(p => {
      const li = document.createElement('li');
      li.className = 'sel-row';
      const isSel = state.selectedIds.includes(p.id);
      const checked = isSel ? 'checked' : '';
      const chance = !isSel
        ? ''
        : chanceById[p.id] === undefined
          ? `<span class="sel-chance out" title="${escapeHtml(t('today.outWhy'))}">${escapeHtml(t('today.out'))}</span>`
          : `<span class="sel-chance" title="${escapeHtml(t('today.chance'))}" style="--fill:${chanceById[p.id]}%">${chanceById[p.id]}%</span>`;
      li.className = isSel ? 'sel-row is-on' : 'sel-row';
      li.innerHTML = `
        <input type="checkbox" data-id="${escapeHtml(p.id)}" ${checked} id="chk_${escapeHtml(p.id)}">
        ${avatarHtml(p.name, 'avatar-sm')}
        <label class="sel-name" for="chk_${escapeHtml(p.id)}">${escapeHtml(p.name)}</label>
        ${chance}
        <span class="pill" data-tone="${toneOf(p)}">${escapeHtml(saldoLabel(p))}</span>
      `;
      ul.appendChild(li);
    });
    ul.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', () => toggleSelected(chk.dataset.id, chk.checked));
    });
  }
  updateDecideButton();
}

function renderFairness(){
  const ul = $('fairnessList');
  ul.innerHTML = '';
  if(state.people.length === 0){
    ul.innerHTML = emptyStateHtml(t('fair.empty'));
    return;
  }
  const sorted = [...state.people].sort((a, b) => {
    const diff = balanceOf(a) - balanceOf(b);
    if(diff !== 0) return diff;
    return a.pago - b.pago;
  });
  const maxAbs = Math.max(1, ...sorted.map(p => Math.abs(balanceOf(p))));
  const blocked = lastPayerName(state.history);
  const nextUp = sorted.find(p => p.name !== blocked) || sorted[0];
  sorted.forEach((p, idx) => {
    const li = document.createElement('li');
    li.className = 'fair-row';
    const b = balanceOf(p);
    const tone = toneOf(p);
    const half = Math.round((Math.abs(b) / maxAbs) * 50);
    const left = b < 0 ? 50 - half : 50;
    const next = p.name === blocked
      ? `<span class="tag tag-out">${escapeHtml(t('fair.last'))}</span>`
      : (p === nextUp ? `<span class="tag tag-next">${escapeHtml(t('fair.next'))}</span>` : '');
    li.innerHTML = `
      <span class="fair-rank">${idx + 1}</span>
      ${avatarHtml(p.name, 'avatar-sm')}
      <span class="fair-name">${escapeHtml(p.name)}</span>
      ${next}
      <div class="fair-bar" role="img" aria-label="${escapeHtml(saldoLabel(p))}">
        <span class="fair-bar-zero"></span>
        <span class="fair-bar-fill" data-tone="${tone}" style="left:${left}%;width:${Math.max(half, b === 0 ? 0 : 2)}%"></span>
      </div>
      <span class="fair-pct" data-tone="${tone}">${signed(b)}</span>
    `;
    ul.appendChild(li);
  });
}

function renderHistory(){
  const ul = $('historyList');
  ul.innerHTML = '';
  if(state.history.length === 0){
    ul.innerHTML = emptyStateHtml(t('history.empty'));
    return;
  }
  state.history.forEach(h => {
    const li = document.createElement('li');
    if(editDraft && editDraft.id === h.id){
      li.className = 'history-edit';
      li.innerHTML = roundEditorHtml(h);
    } else {
      li.className = 'history-row';
      const others = h.participants.filter(n => n !== h.payer);
      li.innerHTML = `
        ${avatarHtml(h.payer, 'avatar-sm')}
        <span class="history-main">
          <span class="history-payer">${escapeHtml(h.payer)}</span>
          <span class="history-when">${escapeHtml(shortDate(h.date))} · ${escapeHtml(h.time)}</span>
        </span>
        ${avatarGroupHtml(others)}
        <span class="hist-actions">
          <button class="row-btn hist-edit" data-id="${escapeHtml(h.id)}" aria-label="${escapeHtml(t('history.edit'))}">
            <svg width="14" height="14"><use href="#i-pencil"/></svg>
          </button>
          <button class="row-btn hist-undo" data-id="${escapeHtml(h.id)}" aria-label="${escapeHtml(t('history.undo'))}">
            <svg width="14" height="14"><use href="#i-revert"/></svg>
          </button>
        </span>
      `;
    }
    ul.appendChild(li);
  });
  ul.querySelectorAll('.hist-edit').forEach(btn => {
    btn.addEventListener('click', () => startRoundEdit(btn.dataset.id));
  });
  ul.querySelectorAll('.hist-undo').forEach(btn => {
    btn.addEventListener('click', () => reverseRound(btn.dataset.id));
  });
  if(editDraft) wireRoundEditor(ul);
}

function roundEditorHtml(h){
  const rows = state.people.map(p => {
    const checked = editDraft.participants.includes(p.name) ? 'checked' : '';
    return `
      <label class="re-person">
        <input type="checkbox" class="re-check" data-name="${escapeHtml(p.name)}" ${checked}>
        ${avatarHtml(p.name, 'avatar-sm')}
        <span class="re-name">${escapeHtml(p.name)}</span>
      </label>`;
  }).join('');
  const payerOpts = editDraft.participants.length
    ? editDraft.participants.map(n => `<option value="${escapeHtml(n)}" ${n === editDraft.payer ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')
    : '<option value="">—</option>';
  return `
    <div class="re-head">${escapeHtml(t('editor.who'))} <span class="re-when">${escapeHtml(shortDate(h.date))} · ${escapeHtml(h.time)}</span></div>
    <div class="re-people">${rows}</div>
    <div class="re-payer">
      <span class="re-payer-label">${escapeHtml(t('editor.payer'))}</span>
      <select class="re-payer-sel">${payerOpts}</select>
    </div>
    <div class="re-actions">
      <button class="chip-btn re-cancel" type="button">${escapeHtml(t('editor.cancel'))}</button>
      <button class="chip-btn re-save" type="button">${escapeHtml(t('editor.save'))}</button>
    </div>
  `;
}

function wireRoundEditor(ul){
  const box = ul.querySelector('.history-edit');
  if(!box) return;
  box.querySelectorAll('.re-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const name = chk.dataset.name;
      if(chk.checked){
        if(!editDraft.participants.includes(name)) editDraft.participants.push(name);
        if(!editDraft.payer) editDraft.payer = name;
      } else {
        editDraft.participants = editDraft.participants.filter(n => n !== name);
        if(editDraft.payer === name) editDraft.payer = editDraft.participants[0] || '';
      }
      renderHistory();
    });
  });
  const sel = box.querySelector('.re-payer-sel');
  if(sel) sel.addEventListener('change', () => { editDraft.payer = sel.value; });
  box.querySelector('.re-cancel').addEventListener('click', () => { editDraft = null; renderHistory(); });
  box.querySelector('.re-save').addEventListener('click', saveRoundEdit);
}

function startRoundEdit(historyId){
  const h = state.history.find(x => x.id === historyId);
  if(!h) return;
  const names = state.people.map(p => p.name);
  const participants = h.participants.filter(n => names.includes(n));
  editDraft = {
    id: historyId,
    participants,
    payer: names.includes(h.payer) ? h.payer : (participants[0] || '')
  };
  renderHistory();
}

function saveRoundEdit(){
  if(!editDraft) return;
  const { id } = editDraft;
  const newParts = [...editDraft.participants];
  const newPayer = editDraft.payer;
  if(newParts.length === 0){ toast(t('editor.needOne'), 'warn'); return; }
  if(!newParts.includes(newPayer)){ toast(t('editor.needPayer'), 'warn'); return; }
  editDraft = null;

  store.commit(current => {
    const h = current.history.find(x => x.id === id);
    if(!h) return null;
    const byName = name => current.people.find(p => p.name === name);

    for(const name of h.participants){
      const p = byName(name);
      if(!p || p.idas < 1) return null;
    }
    const oldPayer = byName(h.payer);
    if(!oldPayer || oldPayer.pago < h.participants.length || oldPayer.pagamentos < 1) return null;
    for(const name of newParts){ if(!byName(name)) return null; }
    const newPayerP = byName(newPayer);
    if(!newPayerP) return null;

    h.participants.forEach(name => { byName(name).idas -= 1; });
    oldPayer.pago -= h.participants.length;
    oldPayer.pagamentos -= 1;

    newParts.forEach(name => { byName(name).idas += 1; });
    newPayerP.pago += newParts.length;
    newPayerP.pagamentos += 1;

    h.payer = newPayer;
    h.participants = newParts;
    return { next: current, result: 'ok' };
  }).then(result => {
    if(result) toast(t('history.saved'));
    else toast(t('history.editFail'), 'warn');
    renderHistory();
  }).catch(() => {});
}

async function reverseRound(historyId){
  const entry = state.history.find(h => h.id === historyId);
  if(!entry) return;
  const ok = await askConfirm(
    t('history.undoAsk', { payer: entry.payer, n: entry.participants.length }),
    t('history.undoOk')
  );
  if(!ok) return;

  store.commit(current => {
    const idx = current.history.findIndex(h => h.id === historyId);
    if(idx === -1) return null;
    const h = current.history[idx];
    const byName = name => current.people.find(p => p.name === name);

    for(const name of h.participants){
      const p = byName(name);
      if(!p || p.idas < 1) return null;
    }
    const payer = byName(h.payer);
    if(!payer || payer.pago < h.participants.length || payer.pagamentos < 1) return null;

    h.participants.forEach(name => { byName(name).idas -= 1; });
    payer.pago -= h.participants.length;
    payer.pagamentos -= 1;
    current.history.splice(idx, 1);
    return { next: current, result: 'ok' };
  }).then(result => {
    if(result){
      undoSnapshot = null;
      hideResult();
      toast(t('history.undone'));
    } else {
      toast(t('history.undoFail'), 'warn');
    }
  }).catch(() => {});
}

function renderStats(){
  $('statTeamCount').textContent = state.people.length;
  $('statTodayCount').textContent = state.selectedIds.length;
}

function renderSummary(){
  const ul = $('summaryList');
  const people = state.people;
  const rondas = people.reduce((s, p) => s + p.pagamentos, 0);
  const cafes = people.reduce((s, p) => s + p.idas, 0);
  const media = rondas === 0
    ? '—'
    : (cafes / rondas).toFixed(1).replace('.', getLang() === 'pt' ? ',' : '.');

  const comIdas = people.filter(p => p.idas > 0);
  const maisEmDivida = comIdas.length
    ? comIdas.reduce((a, b) => (balanceOf(b) < balanceOf(a) ? b : a))
    : null;
  const quemMaisPagou = people.length
    ? people.reduce((a, b) => (b.pago > a.pago ? b : a))
    : null;

  const tiles = [
    { icon: ICON.hash, label: t('stats.rounds'), value: rondas },
    { icon: ICON.cup, label: t('stats.coffees'), value: cafes },
    { icon: ICON.chart, label: t('stats.avg'), value: media },
    {
      icon: ICON.down,
      tone: 'debt',
      label: t('stats.debt'),
      value: maisEmDivida && balanceOf(maisEmDivida) < 0 ? maisEmDivida.name : '—',
      sub: maisEmDivida && balanceOf(maisEmDivida) < 0 ? saldoLabel(maisEmDivida) : t('stats.nobody')
    },
    {
      icon: ICON.trophy,
      tone: 'ahead',
      label: t('stats.top'),
      value: quemMaisPagou && quemMaisPagou.pago > 0 ? quemMaisPagou.name : '—',
      sub: quemMaisPagou && quemMaisPagou.pago > 0 ? t('stats.ncoffees', { n: quemMaisPagou.pago }) : t('stats.nobody')
    }
  ];

  ul.innerHTML = tiles.map(tile => `
    <li class="summary-tile"${tile.tone ? ` data-tone="${tile.tone}"` : ''}>
      <span class="tile-icon" aria-hidden="true"><svg width="15" height="15"><use href="#${tile.icon}"/></svg></span>
      <strong>${escapeHtml(String(tile.value))}</strong>
      <span class="summary-label">${escapeHtml(tile.label)}</span>
      ${tile.sub ? `<span class="summary-sub">${escapeHtml(tile.sub)}</span>` : ''}
    </li>
  `).join('');
}

function renderPayerChart(){
  const host = $('chartPayers');
  const rows = state.people
    .filter(p => p.pagamentos > 0)
    .sort((a, b) => b.pagamentos - a.pagamentos || a.name.localeCompare(b.name));

  if(rows.length === 0){
    host.innerHTML = `<p class="chart-empty">${escapeHtml(t('chart.empty'))}</p>`;
    return;
  }

  const max = Math.max(...rows.map(p => p.pagamentos));
  host.innerHTML = rows.map(p => {
    const tip = p.pagamentos === 1
      ? t('chart.tipRound', { name: p.name })
      : t('chart.tipRounds', { name: p.name, n: p.pagamentos });
    const pct = Math.max(2, Math.round((p.pagamentos / max) * 100));
    return `
      <div class="bar-row" title="${escapeHtml(tip)}">
        <span class="bar-name">${escapeHtml(p.name)}</span>
        <span class="bar-plot">
          <span class="bar-fill" style="width:${pct}%"></span>
          <span class="bar-val" style="left:${pct}%">${p.pagamentos}</span>
        </span>
      </div>`;
  }).join('');
}

function dayKey(date){
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}

function renderDaysChart(){
  const host = $('chartDays');
  const counts = {};
  state.history.forEach(h => {
    const parts = String(h.date).split('/');
    if(parts.length !== 3) return;
    const when = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    if(Number.isNaN(when.getTime())) return;
    const key = dayKey(when);
    counts[key] = (counts[key] || 0) + 1;
  });

  const today = new Date();
  const days = [];
  for(let i = 7; i >= 0; i--){
    const when = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push({ when, n: counts[dayKey(when)] || 0 });
  }

  const max = Math.max(1, ...days.map(d => d.n));
  const names = weekdays();
  const monthNames = months();

  host.innerHTML = `<div class="cols">${days.map(d => {
    const label = d.when.getDate() + ' ' + (monthNames[d.when.getMonth()] || '');
    const tip = d.n === 0
      ? t('chart.tipDay0', { day: label })
      : d.n === 1 ? t('chart.tipDay1', { day: label }) : t('chart.tipDay', { day: label, n: d.n });
    const height = d.n === 0 ? 0 : Math.max(8, Math.round((d.n / max) * 100));
    return `
      <div class="col-item" title="${escapeHtml(tip)}">
        <span class="col-val">${d.n > 0 ? d.n : ''}</span>
        <span class="col-slot"><span class="col-fill" style="height:${height}%"></span></span>
        <span class="col-day">${escapeHtml(names[d.when.getDay()] || '')}</span>
      </div>`;
  }).join('')}</div>`;
}

function updateDecideButton(){
  $('decideBtn').disabled = drawBusy || !store || state.selectedIds.length === 0 || state.people.length === 0;
}

function paintLuck(value){
  const range = $('luckRange');
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 100;
  const pos = max === min ? 0 : (value - min) / (max - min);
  range.parentElement.style.setProperty('--pos', (pos * 100).toFixed(1) + '%');
  $('luckVal').textContent = value + '%';
}

function renderLuck(){
  const range = $('luckRange');
  if(document.activeElement !== range) range.value = state.luck;
  paintLuck(state.luck);
}

function renderAll(){
  renderPeopleList();
  renderSelectionList();
  renderFairness();
  renderHistory();
  renderStats();
  renderSummary();
  renderPayerChart();
  renderDaysChart();
  renderLuck();
}

function setStatus(mode){
  statusMode = mode;
  const badge = $('syncBadge');
  badge.dataset.mode = mode === 'volatile' ? 'error' : mode;
  $('syncText').textContent = t('sync.' + mode);
}

function renderLang(){
  $('langCode').textContent = t('top.langCode');
  $('langFlag').setAttribute('href', '#' + t('top.langFlag'));
  $('langBtn').setAttribute('aria-label', t('top.lang'));
}

function switchLang(){
  setLang(otherLang());
  applyStatic();
  renderLang();
  renderSoundToggle();
  applyTheme();
  setStatus(statusMode);
  renderAll();
  clickSound();
}

function applyState(next){
  state = next;
  renderAll();

  const newest = state.history[0];
  const newestId = newest ? newest.id || null : null;
  const isFresh = Boolean(newestId) && !knownHistoryIds.has(newestId);

  if(initialized && isFresh && newestId !== selfDecisionId){
    undoSnapshot = null;
    showResultCard(newest.payer);
    if(!stageOpen && !editDraft && !drawBusy) showRemoteReveal(newest);
  }

  knownHistoryIds = new Set(state.history.map(h => h.id));
  lastHistoryId = newestId;
  initialized = true;
}

function addPerson(rawName){
  const name = rawName.trim();
  if(!name) return;
  store.commit(current => {
    if(current.people.some(p => p.name.toLowerCase() === name.toLowerCase())) return null;
    current.people.push({ id: uid('p'), name, idas: 0, pagamentos: 0, pago: 0 });
    return { next: current, result: 'ok' };
  }).then(result => {
    if(result) clickSound();
    else toast(t('team.dupe'), 'warn');
  }).catch(() => {});
}

async function removePerson(id){
  const person = state.people.find(p => p.id === id);
  if(!person) return;
  const ok = await askConfirm(t('team.removeAsk', { name: person.name }), t('team.removeOk'));
  if(!ok) return;
  store.commit(current => {
    current.people = current.people.filter(p => p.id !== id);
    current.selectedIds = current.selectedIds.filter(sid => sid !== id);
    return { next: current };
  });
}

function toggleSelected(id, isChecked){
  store.commit(current => {
    const has = current.selectedIds.includes(id);
    if(isChecked && !has) current.selectedIds.push(id);
    if(!isChecked && has) current.selectedIds = current.selectedIds.filter(sid => sid !== id);
    return { next: current };
  });
}

function selectAll(){
  store.commit(current => {
    current.selectedIds = current.people.map(p => p.id);
    return { next: current };
  });
}

function selectNone(){
  store.commit(current => {
    current.selectedIds = [];
    return { next: current };
  });
}

async function decidePayer(){
  const selectedPeople = state.people.filter(p => state.selectedIds.includes(p.id));
  if(selectedPeople.length === 0) return;

  const decisionId = uid('h');
  selfDecisionId = decisionId;
  undoSnapshot = store.getState();

  const mode = getAnimStyle();
  const localPool = eligiblePool(selectedPeople, state.history);
  const chances = chancesByName(localPool);
  drawBusy = true;
  updateDecideButton();
  primeAudio();
  const token = openStage(mode);

  let opening = Promise.resolve();
  if(mode === 'wheel'){
    buildWheel(localPool);
    setHint(t('stage.wheelReady', { n: localPool.length }));
    clickSound();
  } else {
    prepareReel(localPool);
    setHint(t('stage.sealed', { n: localPool.length }));
    opening = openCrate();
  }

  const winnerName = await store.commit(current => {
    const participants = current.people.filter(p => current.selectedIds.includes(p.id));
    if(participants.length === 0) return null;

    const chosen = weightedPick(eligiblePool(participants, current.history), current.luck);

    participants.forEach(p => { p.idas += 1; });
    chosen.pagamentos += 1;
    chosen.pago += participants.length;

    const now = new Date();
    current.history.unshift({
      id: decisionId,
      date: now.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
      payer: chosen.name,
      participants: participants.map(p => p.name)
    });
    if(current.history.length > HISTORY_LIMIT) current.history = current.history.slice(0, HISTORY_LIMIT);

    return { next: current, result: chosen.name };
  }).catch(err => {
    console.error('Falha ao registar a decisao', err);
    return null;
  });

  if(!winnerName){
    closeStage();
    hideResult();
    undoSnapshot = null;
    toast(t('draw.fail'), 'warn');
    return;
  }

  const winner = selectedPeople.find(p => p.name === winnerName) || { name: winnerName };
  const spinPool = localPool.some(p => p.name === winnerName) ? localPool : localPool.concat([winner]);

  if(mode === 'wheel'){
    setHint(t('stage.spinning'));
    await spinWheel(spinPool, winner);
  } else {
    await opening;
    if(token !== stageToken) return;
    setHint(t('stage.drawing'));
    await spinReel(spinPool, winner);
  }
  if(token !== stageToken) return;

  await wait(reduceMotion() ? 60 : 460);
  if(token !== stageToken) return;

  drawBusy = false;
  updateDecideButton();
  const chance = chances[winnerName];
  const meta = typeof chance === 'number'
    ? t('reveal.meta', { pct: chance, n: selectedPeople.length })
    : t('reveal.metaPlain', { n: selectedPeople.length });
  revealWinner(winnerName, meta);
  showResultCard(winnerName);
}

function reduceMotion(){
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setHint(text){
  $('stageHint').textContent = text;
}

function getAnimStyle(){
  try{ return localStorage.getItem(ANIM_KEY) === 'wheel' ? 'wheel' : 'reel'; }
  catch(e){ return 'reel'; }
}

function setAnimStyle(style){
  try{ localStorage.setItem(ANIM_KEY, style); }catch(e){ /* modo privado */ }
  renderAnimToggle();
}

function renderAnimToggle(){
  const current = getAnimStyle();
  const opts = [...document.querySelectorAll('.anim-opt')];
  opts.forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.style === current));
  });
  const index = Math.max(0, opts.findIndex(btn => btn.dataset.style === current));
  const seg = document.querySelector('.seg');
  if(seg) seg.style.setProperty('--seg-index', index);
}

function soundOn(){
  try{ return localStorage.getItem(SOUND_KEY) !== 'off'; }catch(e){ return true; }
}

function setSoundOn(on){
  try{ localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); }catch(e){ /* modo privado */ }
  renderSoundToggle();
}

function renderSoundToggle(){
  const on = soundOn();
  const btn = $('soundBtn');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? t('stage.soundOn') : t('stage.soundOff'));
  $('soundOnIcon').classList.toggle('hidden', !on);
  $('soundOffIcon').classList.toggle('hidden', on);
}

function audio(){
  if(!soundOn()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return null;
  try{
    if(!audioCtx){
      audioCtx = new Ctx();
      const master = audioCtx.createGain();
      const shelf = audioCtx.createBiquadFilter();
      const comp = audioCtx.createDynamicsCompressor();
      master.gain.value = 0.85;
      shelf.type = 'highshelf';
      shelf.frequency.value = 5200;
      shelf.gain.value = -4;
      comp.threshold.value = -14;
      comp.knee.value = 16;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master.connect(shelf);
      shelf.connect(comp);
      comp.connect(audioCtx.destination);
      audioBus = master;
    }
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }catch(e){
    return null;
  }
}

function primeAudio(){
  audio();
}

function noiseBuf(ctx){
  if(noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for(let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

function tone({ freq, to, type = 'sine', dur = 0.2, peak = 0.1, at = 0, glide = 0.9, cutoff = 0 }){
  const ctx = audio();
  if(!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if(to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur * glide);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let tail = osc;
  if(cutoff){
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    osc.connect(filter);
    tail = filter;
  }
  tail.connect(gain);
  gain.connect(audioBus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseHit({ freq = 1200, to = 0, q = 1, dur = 0.12, peak = 0.1, at = 0, type = 'bandpass' }){
  const ctx = audio();
  if(!ctx) return;
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  src.buffer = noiseBuf(ctx);
  src.loop = true;
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t0);
  if(to) filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioBus);
  src.start(t0, rand() * 0.9);
  src.stop(t0 + dur + 0.05);
}

function buzz(pattern){
  if(!soundOn() || reduceMotion()) return;
  try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(e){ /* sem motor */ }
}

function tickSound(progress){
  const p = typeof progress === 'number' ? progress : 0;
  noiseHit({ freq: 2300 + p * 800 + rand() * 700, q: 7, dur: 0.038, peak: 0.058 + p * 0.034 });
  tone({ freq: 1380 + p * 460 + rand() * 240, to: 780, type: 'square', dur: 0.05, peak: 0.026 + p * 0.018, cutoff: 6000 });
}

function thudSound(){
  tone({ freq: 190, to: 46, type: 'sine', dur: 0.34, peak: 0.24, glide: 0.55 });
  noiseHit({ freq: 900, to: 140, q: 0.8, dur: 0.14, peak: 0.09, type: 'lowpass' });
}

function knockSound(){
  tone({ freq: 330, to: 118, type: 'triangle', dur: 0.17, peak: 0.15, glide: 0.5 });
  noiseHit({ freq: 1900, q: 3, dur: 0.05, peak: 0.05 });
}

function creakSound(){
  tone({ freq: 86, to: 172, type: 'sawtooth', dur: 0.64, peak: 0.075, cutoff: 620 });
}

function whooshSound(){
  noiseHit({ freq: 320, to: 3400, q: 1.1, dur: 0.5, peak: 0.21 });
  noiseHit({ freq: 2600, to: 420, q: 0.7, dur: 0.4, peak: 0.09, at: 0.16 });
}

function impactSound(){
  tone({ freq: 260, to: 38, type: 'sine', dur: 0.55, peak: 0.32, glide: 0.4 });
  tone({ freq: 62, to: 34, type: 'sine', dur: 0.75, peak: 0.2 });
  noiseHit({ freq: 3200, to: 300, q: 0.6, dur: 0.32, peak: 0.18 });
}

function sparkleSound(){
  for(let i = 0; i < 7; i++){
    tone({ freq: 1500 + rand() * 2300, type: 'triangle', dur: 0.18, peak: 0.026, at: i * 0.07 + rand() * 0.05 });
  }
}

function chimeSound(){
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    tone({ freq: f, type: 'triangle', dur: 0.72, peak: 0.09, at: i * 0.085 });
    tone({ freq: f * 2, type: 'sine', dur: 0.38, peak: 0.028, at: i * 0.085 + 0.012 });
  });
  tone({ freq: 130.81, type: 'sine', dur: 1.1, peak: 0.11, at: 0.02 });
  tone({ freq: 196, type: 'sine', dur: 1, peak: 0.07, at: 0.05 });
  sparkleSound();
}

function clickSound(){
  tone({ freq: 660, to: 430, type: 'sine', dur: 0.05, peak: 0.035 });
}

function downSound(){
  tone({ freq: 420, to: 190, type: 'triangle', dur: 0.24, peak: 0.08 });
}

function startRiser(ms){
  stopRiser();
  const ctx = audio();
  if(!ctx || reduceMotion()) return;
  const dur = ms / 1000;
  const t0 = ctx.currentTime;
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  filter.type = 'lowpass';
  filter.Q.value = 3;
  filter.frequency.setValueAtTime(340, t0);
  filter.frequency.exponentialRampToValueAtTime(4200, t0 + dur);
  oscA.type = 'sawtooth';
  oscB.type = 'sawtooth';
  oscA.frequency.setValueAtTime(78, t0);
  oscB.frequency.setValueAtTime(78.7, t0);
  oscA.frequency.exponentialRampToValueAtTime(310, t0 + dur);
  oscB.frequency.exponentialRampToValueAtTime(313, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.05, t0 + dur * 0.85);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  oscA.connect(filter);
  oscB.connect(filter);
  filter.connect(gain);
  gain.connect(audioBus);
  oscA.start(t0);
  oscB.start(t0);
  oscA.stop(t0 + dur + 0.06);
  oscB.stop(t0 + dur + 0.06);
  riser = { gain, oscs: [oscA, oscB] };
}

function stopRiser(){
  if(!riser) return;
  const current = riser;
  riser = null;
  if(!audioCtx) return;
  const now = audioCtx.currentTime;
  try{
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(Math.max(0.0001, current.gain.gain.value), now);
    current.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    current.oscs.forEach(osc => osc.stop(now + 0.16));
  }catch(e){ /* ja terminou */ }
}

function bezierAxis(p1, p2, s){
  const inv = 1 - s;
  return 3 * inv * inv * s * p1 + 3 * inv * s * s * p2 + s * s * s;
}

function timeForProgress(progress){
  let lo = 0;
  let hi = 1;
  for(let i = 0; i < 26; i++){
    const mid = (lo + hi) / 2;
    if(bezierAxis(SPIN_EASE[1], SPIN_EASE[3], mid) < progress) lo = mid;
    else hi = mid;
  }
  return bezierAxis(SPIN_EASE[0], SPIN_EASE[2], (lo + hi) / 2);
}

function clearTicks(){
  tickTimers.forEach(clearTimeout);
  tickTimers = [];
}

function scheduleTicks(count, dur, onTick){
  clearTicks();
  if(reduceMotion() || count < 2) return;
  const steps = Math.min(count, 72);
  for(let i = 1; i <= steps; i++){
    const progress = i / steps;
    const at = timeForProgress(progress) * dur;
    tickTimers.push(setTimeout(() => {
      tickSound(progress);
      if(progress > 0.88) buzz(8);
      if(onTick) onTick();
    }, at));
  }
}

function flash(){
  const el = $('stageFlash');
  el.classList.remove('fire');
  void el.offsetWidth;
  el.classList.add('fire');
}

function transitionDone(el, dur){
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if(done) return;
      done = true;
      el.removeEventListener('transitionend', finish);
      resolve();
    };
    el.addEventListener('transitionend', finish);
    setTimeout(finish, dur + 260);
  });
}

function openStage(mode){
  stageToken += 1;
  lastFocus = document.activeElement;
  $('crateScene').classList.toggle('hidden', mode !== 'reel');
  $('wheelScene').classList.toggle('hidden', mode !== 'wheel');
  $('wheelScene').classList.remove('settled');
  $('crateScene').dataset.phase = 'idle';
  $('reelTrack').classList.remove('blurring');
  $('stageFlash').classList.remove('fire');
  $('stageReveal').classList.add('hidden');
  $('stageScene').classList.remove('is-revealed');
  $('stageButtons').classList.add('hidden');
  $('stageUndo').classList.add('hidden');
  $('stageHint').classList.remove('hot');
  clearConfetti();
  setHint('');
  const stage = $('stage');
  stage.classList.remove('hidden', 'is-hot');
  document.body.classList.add('stage-locked');
  stageOpen = true;
  requestAnimationFrame(() => stage.classList.add('is-open'));
  return stageToken;
}

function closeStage(){
  if(!stageOpen) return;
  stageOpen = false;
  stageToken += 1;
  clearTicks();
  stopRiser();
  drawBusy = false;
  updateDecideButton();
  const stage = $('stage');
  stage.classList.remove('is-open', 'is-hot');
  document.body.classList.remove('stage-locked');
  setTimeout(() => {
    if(stageOpen) return;
    stage.classList.add('hidden');
    $('crateScene').dataset.phase = 'idle';
    $('reelTrack').classList.remove('blurring');
    $('wheelScene').classList.remove('settled');
    clearConfetti();
  }, 280);
  if(lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  lastFocus = null;
}

function tierMap(parts, weights){
  const max = Math.max(...weights, 0.0001);
  const pct = percentSplit(weights);
  const map = {};
  parts.forEach((p, i) => {
    const ratio = weights[i] / max;
    const tier = ratio > 0.8 ? 1 : ratio > 0.6 ? 2 : ratio > 0.4 ? 3 : 4;
    map[p.name] = { tier, pct: pct[i] };
  });
  return map;
}

function reelCardHtml(person, isWin, tiers){
  const info = (tiers && tiers[person.name]) || { tier: 1, pct: null };
  const pct = info.pct === null ? '' : `<span class="reel-card-pct">${info.pct}%</span>`;
  return `<div class="reel-card${isWin ? ' win' : ''}" data-tier="${info.tier}">
    ${avatarHtml(person.name)}
    <span class="reel-card-name">${escapeHtml(person.name)}</span>
    ${pct}
  </div>`;
}

function cardWidth(){
  const raw = parseFloat(getComputedStyle($('reel')).getPropertyValue('--card-w'));
  return Number.isFinite(raw) && raw > 0 ? raw : 116;
}

function fillerPick(parts){
  return parts[Math.min(parts.length - 1, Math.floor(rand() * parts.length))];
}

function prepareReel(parts){
  const track = $('reelTrack');
  const weights = chanceWeights(parts, state.luck);
  const tiers = tierMap(parts, weights);
  const cards = [];
  for(let i = 0; i < 14; i++) cards.push(reelCardHtml(fillerPick(parts), false, tiers));
  track.style.transition = 'none';
  track.style.transform = 'translate3d(0,0,0)';
  track.classList.remove('blurring');
  track.innerHTML = cards.join('');
}

async function openCrate(){
  const scene = $('crateScene');
  const tag = scene.querySelector('.crate-tag');
  scene.dataset.phase = 'closed';
  tag.textContent = t('crate.sealed');
  if(reduceMotion()){
    scene.dataset.phase = 'open';
    tag.textContent = t('crate.open');
    await wait(40);
    return;
  }

  await wait(240);
  scene.dataset.phase = 'charge';
  setHint(t('stage.warm'));
  creakSound();
  await wait(620);

  setHint(t('stage.moving'));
  scene.dataset.phase = 'shake';
  knockSound();
  buzz(18);
  await wait(460);
  thudSound();
  buzz(26);
  await wait(440);

  setHint(t('stage.strain'));
  $('stageHint').classList.add('hot');
  $('stage').classList.add('is-hot');
  scene.dataset.phase = 'strain';
  tag.textContent = t('crate.giving');
  creakSound();
  await wait(760);

  setHint(t('stage.opening'));
  scene.dataset.phase = 'burst';
  whooshSound();
  impactSound();
  flash();
  buzz([0, 40, 30, 60]);
  await wait(320);

  scene.dataset.phase = 'open';
  tag.textContent = t('crate.open');
  await wait(620);
}

async function spinReel(parts, winner){
  const track = $('reelTrack');
  const viewport = $('reel').querySelector('.reel-viewport');
  const weights = chanceWeights(parts, state.luck);
  const tiers = tierMap(parts, weights);
  const reduce = reduceMotion();
  const W = cardWidth();
  const viewportW = viewport.clientWidth || W * 4;
  const winIndex = (reduce ? 5 : 46) + Math.floor(rand() * 9);
  const total = winIndex + Math.ceil(viewportW / W) + 5;

  const cards = [];
  for(let i = 0; i < total; i++){
    cards.push(i === winIndex
      ? reelCardHtml(winner, true, tiers)
      : reelCardHtml(fillerPick(parts), false, tiers));
  }
  track.innerHTML = cards.join('');

  const jitter = (rand() * 0.42 - 0.21) * W;
  const target = -((winIndex * W) + W / 2 - viewportW / 2 + jitter);
  const dur = reduce ? SPIN_MS_REDUCED : SPIN_MS;

  track.style.transition = 'none';
  track.style.transform = 'translate3d(0,0,0)';
  track.classList.remove('blurring');
  void track.offsetWidth;
  track.style.setProperty('--spin-ms', dur + 'ms');
  track.classList.add('blurring');
  track.style.transition = `transform ${dur}ms cubic-bezier(${SPIN_EASE.join(',')})`;
  track.style.transform = `translate3d(${target}px,0,0)`;
  scheduleTicks(winIndex, dur);
  startRiser(dur);

  await transitionDone(track, dur);
  clearTicks();
  stopRiser();
  track.classList.remove('blurring');
  const winCard = track.querySelector('.reel-card.win');
  if(winCard) winCard.classList.add('landed');
  thudSound();
  buzz(45);
}

function polar(cx, cy, r, deg){
  const rad = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function shortName(name){
  const first = name.trim().split(/\s+/)[0] || name;
  return first.length > 9 ? first.slice(0, 8) + '…' : first;
}

const LABEL_Y = 48;

function orientLabels(rotation){
  $('wheelSpin').querySelectorAll('.wheel-text').forEach(el => {
    const angle = ((Number(el.dataset.mid) + rotation) % 360 + 360) % 360;
    if(angle > 90 && angle < 270) el.setAttribute('transform', `rotate(180 120 ${LABEL_Y + 7})`);
    else el.removeAttribute('transform');
  });
}

function buildWheel(parts){
  const g = $('wheelSpin');
  g.style.transition = 'none';
  g.style.transform = 'rotate(0deg)';
  const probs = chanceWeights(parts, state.luck);
  const pct = percentSplit(probs);
  const cx = 120, cy = 120, R = 110;
  let angle = 0;
  let markup = '';
  const segs = [];

  parts.forEach((p, i) => {
    const span = probs[i] * 360;
    const a0 = angle;
    const a1 = angle + span;
    angle = a1;

    if(parts.length === 1){
      markup += `<circle class="wheel-slice" data-i="0" cx="${cx}" cy="${cy}" r="${R}" fill="${colorForName(p.name)}"/>`;
    } else {
      const [x0, y0] = polar(cx, cy, R, a0);
      const [x1, y1] = polar(cx, cy, R, a1);
      const large = span > 180 ? 1 : 0;
      markup += `<path class="wheel-slice" data-i="${i}" d="M${cx} ${cy} L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${colorForName(p.name)}"/>`;
    }

    const mid = (a0 + a1) / 2;
    const label = span >= 30 ? shortName(p.name) : initialsFor(p.name);
    const pctMarkup = span >= 14
      ? `<text class="wheel-pct" data-i="${i}" x="${cx}" y="${LABEL_Y + 14}">${pct[i]}%</text>`
      : '';
    markup += `<g transform="rotate(${mid.toFixed(2)} ${cx} ${cy})">` +
      `<g class="wheel-text" data-mid="${mid.toFixed(2)}">` +
      `<text class="wheel-label" data-i="${i}" x="${cx}" y="${LABEL_Y}">${escapeHtml(label)}</text>` +
      pctMarkup +
      `</g></g>`;

    segs.push({ name: p.name, mid, span });
  });

  g.innerHTML = markup;
  orientLabels(0);
  void g.getBoundingClientRect();
  return segs;
}

async function spinWheel(parts, winner){
  const segs = buildWheel(parts);
  const seg = segs.find(s => s.name === winner.name) || segs[0];
  const g = $('wheelSpin');
  const pin = $('wheelPin');
  const reduce = reduceMotion();
  const turns = reduce ? 1 : 7;
  const jitter = (rand() * 0.62 - 0.31) * seg.span;
  const target = turns * 360 + (360 - (seg.mid + jitter));
  const dur = reduce ? SPIN_MS_REDUCED : SPIN_MS;

  g.style.transition = 'none';
  g.style.transform = 'rotate(0deg)';
  void g.getBoundingClientRect();
  g.style.transition = `transform ${dur}ms cubic-bezier(${SPIN_EASE.join(',')})`;
  g.style.transform = `rotate(${target}deg)`;

  $('wheelScene').classList.remove('settled');
  whooshSound();
  startRiser(dur);
  scheduleTicks(Math.round(target / 360 * parts.length), dur, () => {
    pin.classList.remove('flick');
    void pin.offsetWidth;
    pin.classList.add('flick');
  });
  setTimeout(() => { if(stageOpen) $('stage').classList.add('is-hot'); }, dur * 0.55);

  await transitionDone(g, dur);
  clearTicks();
  stopRiser();
  orientLabels(target % 360);
  $('wheelScene').classList.add('settled');

  const winIndex = parts.findIndex(p => p.name === winner.name);
  g.querySelectorAll('.wheel-slice').forEach(el => {
    el.classList.toggle('dim', el.dataset.i !== String(winIndex));
    el.classList.toggle('hit', el.dataset.i === String(winIndex));
  });
  g.querySelectorAll('.wheel-label, .wheel-pct').forEach(el => {
    el.classList.toggle('faded', el.dataset.i !== String(winIndex));
  });
  thudSound();
  buzz(45);
}

function revealWinner(name, meta){
  $('revealAvatar').style.background = colorForName(name);
  $('revealAvatar').textContent = initialsFor(name);
  $('revealName').textContent = name;
  $('revealMeta').textContent = meta || '';
  $('stageScene').classList.add('is-revealed');
  $('stageReveal').classList.remove('hidden');
  $('stageUndo').classList.toggle('hidden', !undoSnapshot);
  $('stageButtons').classList.remove('hidden');
  $('stageHint').classList.remove('hot');
  $('stage').classList.remove('is-hot');
  setHint('');
  flash();
  chimeSound();
  buzz([0, 30, 40, 30, 40, 90]);
  burstConfetti();
  $('stageDone').focus();
}

function showRemoteReveal(entry){
  openStage('reveal');
  revealWinner(entry.payer, t('reveal.remote', { n: entry.participants.length }));
}

function burstConfetti(){
  const host = $('confetti');
  host.innerHTML = '';
  if(reduceMotion()) return;
  const colors = ['#b8863b', '#f1e4c9', '#e8c07d', '#ffd28a', '#fff3d4', '#3f7a5c', '#8a4b2b', '#6b3f63'];
  const frag = document.createDocumentFragment();
  for(let i = 0; i < 96; i++){
    const round = rand() < 0.32;
    const size = 4 + rand() * 6;
    const bit = document.createElement('i');
    bit.className = round ? 'confetti-bit round' : 'confetti-bit';
    bit.style.left = (rand() * 100).toFixed(2) + '%';
    bit.style.width = size.toFixed(1) + 'px';
    bit.style.height = (round ? size : size + 4 + rand() * 8).toFixed(1) + 'px';
    bit.style.background = colors[Math.floor(rand() * colors.length)];
    bit.style.animationDelay = (rand() * 0.55).toFixed(2) + 's';
    bit.style.animationDuration = (1.5 + rand() * 1.6).toFixed(2) + 's';
    bit.style.setProperty('--dx', ((rand() * 2 - 1) * 190).toFixed(0) + 'px');
    bit.style.setProperty('--spin', (360 + rand() * 1080).toFixed(0) + 'deg');
    frag.appendChild(bit);
  }
  host.appendChild(frag);
  setTimeout(clearConfetti, 3800);
}

function clearConfetti(){
  $('confetti').innerHTML = '';
}

function undoLast(){
  if(!undoSnapshot) return;
  const snapshot = undoSnapshot;
  undoSnapshot = null;
  selfDecisionId = snapshot.history[0] ? snapshot.history[0].id || null : null;
  store.commit(() => ({ next: snapshot }));
  downSound();
  closeStage();
  hideResult();
  toast(t('undo.done'));
}

function showResultCard(payerName){
  $('resultWrap').classList.remove('hidden');
  $('winnerAvatar').style.background = colorForName(payerName);
  $('winnerAvatar').textContent = initialsFor(payerName);
  $('winnerName').textContent = payerName;
  $('undoBtn').classList.toggle('hidden', !undoSnapshot);
  $('resultCard').classList.remove('hidden');
}

function hideResult(){
  $('resultWrap').classList.add('hidden');
}

function handleAddClick(){
  const input = $('nameInput');
  addPerson(input.value);
  input.value = '';
  input.focus();
}

function bindEvents(){
  $('addBtn').addEventListener('click', handleAddClick);
  $('nameInput').addEventListener('keydown', event => {
    if(event.key === 'Enter'){
      event.preventDefault();
      handleAddClick();
    }
  });
  $('selAllBtn').addEventListener('click', selectAll);
  $('selNoneBtn').addEventListener('click', selectNone);
  $('decideBtn').addEventListener('click', decidePayer);
  $('undoBtn').addEventListener('click', undoLast);
  $('luckRange').addEventListener('input', () => {
    state.luck = Number($('luckRange').value);
    paintLuck(state.luck);
    renderSelectionList();
  });
  $('luckRange').addEventListener('change', () => {
    const value = Number($('luckRange').value);
    store.commit(current => { current.luck = value; return { next: current }; });
  });
  document.querySelectorAll('.anim-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      setAnimStyle(btn.dataset.style);
      primeAudio();
      clickSound();
    });
  });
  $('themeBtn').addEventListener('click', () => {
    toggleTheme();
    clickSound();
  });
  $('langBtn').addEventListener('click', switchLang);
  $('modalOk').addEventListener('click', () => closeModal(true));
  $('modalCancel').addEventListener('click', () => closeModal(false));
  $('modalVeil').addEventListener('click', () => closeModal(false));
  $('stageClose').addEventListener('click', closeStage);
  $('stageDone').addEventListener('click', closeStage);
  $('stageVeil').addEventListener('click', closeStage);
  $('stageUndo').addEventListener('click', undoLast);
  $('soundBtn').addEventListener('click', () => {
    const next = !soundOn();
    setSoundOn(next);
    if(next){ primeAudio(); clickSound(); }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  document.addEventListener('keydown', event => {
    if(event.key !== 'Escape') return;
    if(modalResolve) closeModal(false);
    else if(stageOpen) closeStage();
  });
}

async function main(){
  setLang(getLang());
  applyStatic();
  applyTheme();
  bindEvents();
  renderLang();
  renderAnimToggle();
  renderSoundToggle();
  await requireUnlock();
  $('app').classList.remove('hidden');
  store = await createStore({ onState: applyState, onStatus: setStatus });
  updateDecideButton();
}

main();
