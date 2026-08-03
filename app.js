import { createStore } from './store.js?v=11';
import { requireUnlock } from './auth.js?v=11';

const AVATAR_COLORS = ['#4a3323', '#2f5d50', '#8a4b2b', '#3b5b7a', '#6b3f63', '#7a5c1e', '#455a3f', '#734a4a'];
const HISTORY_LIMIT = 25;
const ANIM_KEY = 'cafeAnim_v1';
const SOUND_KEY = 'cafeSound_v1';
const SPIN_EASE = [0.13, 0.72, 0.10, 1];
const SPIN_MS = 5200;
const SPIN_MS_REDUCED = 320;

const STATUS_TEXT = {
  cloud: 'sincronizado com a equipa',
  local: 'so neste browser',
  volatile: 'sem guardar (browser bloqueou)',
  error: 'sem ligacao a nuvem'
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
let tickTimers = [];

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

function signed(n){
  return n > 0 ? '+' + n : String(n);
}

function saldoLabel(p){
  const b = balanceOf(p);
  if(b < 0) return 'deve ' + (-b);
  if(b > 0) return 'à frente ' + b;
  return 'em dia';
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
    ul.innerHTML = emptyStateHtml('ainda sem ninguem, adiciona a equipa acima');
    return;
  }
  state.people.forEach(p => {
    const li = document.createElement('li');
    li.className = 'person-row';
    li.dataset.id = p.id;
    const saldo = balanceOf(p);
    const tone = saldo < 0 ? 'debt' : saldo > 0 ? 'ahead' : 'even';
    li.innerHTML = `
      ${avatarHtml(p.name)}
      <div class="person-main">
        <span class="person-name">${escapeHtml(p.name)}</span>
        <span class="person-stats">bebeu ${p.idas} &middot; pagou ${p.pago} &middot; <span class="person-saldo" data-tone="${tone}">${saldoLabel(p)}</span></span>
      </div>
      <button class="row-btn edit-btn" data-id="${escapeHtml(p.id)}" aria-label="Mudar o nome de ${escapeHtml(p.name)}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
      </button>
      <button class="row-btn remove-btn" data-id="${escapeHtml(p.id)}" aria-label="Remover ${escapeHtml(p.name)}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>
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
    alert('Já existe alguém com esse nome.');
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
    ul.innerHTML = emptyStateHtml('adiciona pessoas a equipa primeiro');
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
          ? '<span class="sel-chance out" title="pagou a última ronda, fica de fora">fora</span>'
          : `<span class="sel-chance" title="hipótese de pagar">${chanceById[p.id]}%</span>`;
      li.innerHTML = `
        <input type="checkbox" data-id="${escapeHtml(p.id)}" ${checked} id="chk_${escapeHtml(p.id)}">
        ${avatarHtml(p.name, 'avatar-sm')}
        <label class="sel-name" for="chk_${escapeHtml(p.id)}">${escapeHtml(p.name)}</label>
        ${chance}
        <span class="sel-badge" data-tone="${balanceOf(p) < 0 ? 'debt' : balanceOf(p) > 0 ? 'ahead' : 'even'}">${saldoLabel(p)}</span>
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
    ul.innerHTML = emptyStateHtml('ainda sem pessoas para ordenar');
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
    const tone = b < 0 ? 'debt' : b > 0 ? 'ahead' : 'even';
    const barWidth = Math.round((Math.abs(b) / maxAbs) * 100);
    const next = p.name === blocked
      ? '<span class="fair-out">pagou a última</span>'
      : (p === nextUp ? '<span class="fair-next">próximo</span>' : '');
    li.innerHTML = `
      <span class="fair-rank">${idx + 1}&ordm;</span>
      ${avatarHtml(p.name, 'avatar-sm')}
      <span class="fair-name">${escapeHtml(p.name)}</span>
      ${next}
      <div class="fair-bar-track"><div class="fair-bar-fill" data-tone="${tone}" style="width:${barWidth}%"></div></div>
      <span class="fair-pct" data-tone="${tone}">${signed(b)}</span>
    `;
    ul.appendChild(li);
  });
}

function renderHistory(){
  const ul = $('historyList');
  ul.innerHTML = '';
  if(state.history.length === 0){
    ul.innerHTML = emptyStateHtml('ainda sem decisoes registadas');
    return;
  }
  state.history.forEach(h => {
    const li = document.createElement('li');
    if(editDraft && editDraft.id === h.id){
      li.className = 'history-edit';
      li.innerHTML = roundEditorHtml(h);
    } else {
      li.className = 'history-row';
      const outros = h.participants.filter(n => n !== h.payer);
      const outrosTxt = outros.length ? ' com ' + outros.join(', ') : ' sozinho';
      li.innerHTML = `
        <span class="history-time">${escapeHtml(h.date)}<br>${escapeHtml(h.time)}</span>
        <span class="history-text"><b>${escapeHtml(h.payer)}</b> pagou,${escapeHtml(outrosTxt)}</span>
        <span class="hist-actions">
          <button class="row-btn hist-edit" data-id="${escapeHtml(h.id)}" aria-label="Editar quem foi nesta ronda">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
          <button class="row-btn hist-undo" data-id="${escapeHtml(h.id)}" aria-label="Anular esta ronda">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.6-8.4L3 7"/></svg>
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
    <div class="re-head">quem foi neste café <span class="re-when">${escapeHtml(h.date)} ${escapeHtml(h.time)}</span></div>
    <div class="re-people">${rows}</div>
    <div class="re-payer">
      <span class="re-payer-label">quem pagou</span>
      <select class="re-payer-sel">${payerOpts}</select>
    </div>
    <div class="re-actions">
      <button class="chip-btn re-cancel" type="button">cancelar</button>
      <button class="chip-btn re-save" type="button">guardar</button>
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
  if(newParts.length === 0){ alert('Escolhe pelo menos uma pessoa.'); return; }
  if(!newParts.includes(newPayer)){ alert('Escolhe quem pagou.'); return; }
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
    if(!result) alert('Não dá para editar esta ronda — alguém que participou já foi removido.');
    renderHistory();
  }).catch(() => {});
}

function reverseRound(historyId){
  const entry = state.history.find(h => h.id === historyId);
  if(!entry) return;
  if(!confirm(`Anular esta ronda (${entry.payer} pagou a ${entry.participants.length})? Os contadores voltam atrás.`)) return;

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
    if(!result) alert('Não dá para anular esta ronda — alguém que participou já foi removido.');
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
  const media = rondas === 0 ? '—' : (cafes / rondas).toFixed(1).replace('.', ',');

  const comIdas = people.filter(p => p.idas > 0);
  const maisEmDivida = comIdas.length
    ? comIdas.reduce((a, b) => (balanceOf(b) < balanceOf(a) ? b : a))
    : null;
  const quemMaisPagou = people.length
    ? people.reduce((a, b) => (b.pago > a.pago ? b : a))
    : null;

  const tiles = [
    { label: 'rondas', value: rondas },
    { label: 'cafés bebidos', value: cafes },
    { label: 'média por ronda', value: media },
    {
      label: 'mais em dívida',
      value: maisEmDivida && balanceOf(maisEmDivida) < 0 ? maisEmDivida.name : '—',
      sub: maisEmDivida && balanceOf(maisEmDivida) < 0 ? saldoLabel(maisEmDivida) : 'ninguém'
    },
    {
      label: 'já pagou mais',
      value: quemMaisPagou && quemMaisPagou.pago > 0 ? quemMaisPagou.name : '—',
      sub: quemMaisPagou && quemMaisPagou.pago > 0 ? quemMaisPagou.pago + ' cafés' : 'ninguém'
    }
  ];

  ul.innerHTML = tiles.map(t => `
    <li class="summary-tile">
      <strong>${escapeHtml(String(t.value))}</strong>
      <span class="summary-label">${escapeHtml(t.label)}</span>
      ${t.sub ? `<span class="summary-sub">${escapeHtml(t.sub)}</span>` : ''}
    </li>
  `).join('');
}

function updateDecideButton(){
  $('decideBtn').disabled = drawBusy || !store || state.selectedIds.length === 0 || state.people.length === 0;
}

function renderLuck(){
  const range = $('luckRange');
  if(document.activeElement !== range) range.value = state.luck;
  $('luckVal').textContent = state.luck + '%';
}

function renderAll(){
  renderPeopleList();
  renderSelectionList();
  renderFairness();
  renderHistory();
  renderStats();
  renderSummary();
  renderLuck();
}

function setStatus(mode){
  const badge = $('syncBadge');
  badge.dataset.mode = mode === 'volatile' ? 'error' : mode;
  $('syncText').textContent = STATUS_TEXT[mode] || mode;
}

function applyState(next){
  state = next;
  renderAll();

  const newest = state.history[0];
  const newestId = newest ? newest.id || null : null;

  if(initialized && newestId && newestId !== lastHistoryId && newestId !== selfDecisionId){
    undoSnapshot = null;
    showResultCard(newest.payer);
    if(!stageOpen && !editDraft && !drawBusy) showRemoteReveal(newest);
  }

  lastHistoryId = newestId;
  initialized = true;
}

function addPerson(rawName){
  const name = rawName.trim();
  if(!name) return;
  store.commit(current => {
    if(current.people.some(p => p.name.toLowerCase() === name.toLowerCase())) return null;
    current.people.push({ id: uid('p'), name, idas: 0, pagamentos: 0, pago: 0 });
    return { next: current };
  });
}

function removePerson(id){
  const person = state.people.find(p => p.id === id);
  if(!person) return;
  if(!confirm('Remover ' + person.name + ' da equipa? Os dados dessa pessoa perdem-se.')) return;
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
    setHint('roleta pronta');
  } else {
    prepareReel(localPool);
    setHint('caixa selada');
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
    return;
  }

  const winner = selectedPeople.find(p => p.name === winnerName) || { name: winnerName };
  const spinPool = localPool.some(p => p.name === winnerName) ? localPool : localPool.concat([winner]);

  if(mode === 'wheel'){
    setHint('a rodar…');
    await spinWheel(spinPool, winner);
  } else {
    await opening;
    if(token !== stageToken) return;
    setHint('a sortear…');
    await spinReel(spinPool, winner);
  }
  if(token !== stageToken) return;

  await wait(reduceMotion() ? 60 : 460);
  if(token !== stageToken) return;

  drawBusy = false;
  updateDecideButton();
  const chance = chances[winnerName];
  const meta = (typeof chance === 'number' ? chance + '% de hipótese · ' : '') + selectedPeople.length + ' na mesa';
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
  document.querySelectorAll('.anim-opt').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.style === current));
  });
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
  btn.setAttribute('aria-label', on ? 'Desligar som' : 'Ligar som');
  $('soundOnIcon').classList.toggle('hidden', !on);
  $('soundOffIcon').classList.toggle('hidden', on);
}

function audio(){
  if(!soundOn()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return null;
  try{
    if(!audioCtx) audioCtx = new Ctx();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }catch(e){
    return null;
  }
}

function primeAudio(){
  audio();
}

function blip(freq, dur, type, peak){
  const ctx = audio();
  if(!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function tickSound(){
  blip(1120 + rand() * 180, 0.05, 'square', 0.03);
}

function thudSound(){
  blip(96 + rand() * 20, 0.24, 'sine', 0.18);
}

function chimeSound(){
  blip(659, 0.32, 'triangle', 0.1);
  setTimeout(() => blip(988, 0.5, 'triangle', 0.085), 120);
}

function whooshSound(){
  const ctx = audio();
  if(!ctx) return;
  const len = Math.floor(ctx.sampleRate * 0.55);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i = 0; i < len; i++){
    const decay = 1 - i / len;
    data[i] = (Math.random() * 2 - 1) * decay * decay;
  }
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(380, t0);
  filter.frequency.exponentialRampToValueAtTime(2800, t0 + 0.5);
  gain.gain.value = 0.14;
  src.buffer = buffer;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t0);
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
  const steps = Math.min(count, 64);
  for(let i = 1; i <= steps; i++){
    const at = timeForProgress(i / steps) * dur;
    tickTimers.push(setTimeout(() => {
      tickSound();
      if(onTick) onTick();
    }, at));
  }
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
  $('crateScene').dataset.phase = 'idle';
  $('stageReveal').classList.add('hidden');
  $('stageScene').classList.remove('is-revealed');
  $('stageButtons').classList.add('hidden');
  $('stageUndo').classList.add('hidden');
  clearConfetti();
  setHint('');
  const stage = $('stage');
  stage.classList.remove('hidden');
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
  drawBusy = false;
  updateDecideButton();
  const stage = $('stage');
  stage.classList.remove('is-open');
  document.body.classList.remove('stage-locked');
  setTimeout(() => {
    if(stageOpen) return;
    stage.classList.add('hidden');
    $('crateScene').dataset.phase = 'idle';
    clearConfetti();
  }, 260);
  if(lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  lastFocus = null;
}

function reelCardHtml(person, isWin){
  return `<div class="reel-card${isWin ? ' win' : ''}">
    ${avatarHtml(person.name)}
    <span class="reel-card-name">${escapeHtml(person.name)}</span>
  </div>`;
}

function cardWidth(){
  const raw = parseFloat(getComputedStyle($('reel')).getPropertyValue('--card-w'));
  return Number.isFinite(raw) && raw > 0 ? raw : 116;
}

function prepareReel(parts){
  const track = $('reelTrack');
  const weights = chanceWeights(parts, state.luck);
  const cards = [];
  for(let i = 0; i < 14; i++) cards.push(reelCardHtml(parts[pickIndex(weights)], false));
  track.style.transition = 'none';
  track.style.transform = 'translate3d(0,0,0)';
  track.innerHTML = cards.join('');
}

async function openCrate(){
  const scene = $('crateScene');
  const tag = scene.querySelector('.crate-tag');
  scene.dataset.phase = 'closed';
  tag.textContent = 'selada';
  if(reduceMotion()){
    scene.dataset.phase = 'open';
    tag.textContent = 'aberta';
    await wait(40);
    return;
  }
  await wait(300);
  setHint('alguma coisa mexe lá dentro…');
  scene.dataset.phase = 'shake';
  thudSound();
  await wait(450);
  thudSound();
  await wait(470);
  setHint('a abrir…');
  scene.dataset.phase = 'burst';
  whooshSound();
  await wait(280);
  scene.dataset.phase = 'open';
  tag.textContent = 'aberta';
  await wait(600);
}

async function spinReel(parts, winner){
  const track = $('reelTrack');
  const viewport = $('reel').querySelector('.reel-viewport');
  const weights = chanceWeights(parts, state.luck);
  const reduce = reduceMotion();
  const W = cardWidth();
  const viewportW = viewport.clientWidth || W * 4;
  const winIndex = (reduce ? 5 : 42) + Math.floor(rand() * 7);
  const total = winIndex + Math.ceil(viewportW / W) + 5;

  const cards = [];
  for(let i = 0; i < total; i++){
    cards.push(i === winIndex ? reelCardHtml(winner, true) : reelCardHtml(parts[pickIndex(weights)], false));
  }
  track.innerHTML = cards.join('');

  const jitter = (rand() * 0.42 - 0.21) * W;
  const target = -((winIndex * W) + W / 2 - viewportW / 2 + jitter);
  const dur = reduce ? SPIN_MS_REDUCED : SPIN_MS;

  track.style.transition = 'none';
  track.style.transform = 'translate3d(0,0,0)';
  void track.offsetWidth;
  track.style.transition = `transform ${dur}ms cubic-bezier(${SPIN_EASE.join(',')})`;
  track.style.transform = `translate3d(${target}px,0,0)`;
  scheduleTicks(winIndex, dur);

  await transitionDone(track, dur);
  clearTicks();
  const winCard = track.querySelector('.reel-card.win');
  if(winCard) winCard.classList.add('landed');
  thudSound();
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

  scheduleTicks(Math.round(target / 360 * parts.length), dur, () => {
    pin.classList.remove('flick');
    void pin.offsetWidth;
    pin.classList.add('flick');
  });

  await transitionDone(g, dur);
  clearTicks();
  orientLabels(target % 360);

  const winIndex = parts.findIndex(p => p.name === winner.name);
  g.querySelectorAll('.wheel-slice').forEach(el => {
    el.classList.toggle('dim', el.dataset.i !== String(winIndex));
    el.classList.toggle('hit', el.dataset.i === String(winIndex));
  });
  g.querySelectorAll('.wheel-label, .wheel-pct').forEach(el => {
    el.classList.toggle('faded', el.dataset.i !== String(winIndex));
  });
  thudSound();
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
  setHint('');
  chimeSound();
  burstConfetti();
  $('stageDone').focus();
}

function showRemoteReveal(entry){
  openStage('reveal');
  revealWinner(entry.payer, 'decidido noutro dispositivo · ' + entry.participants.length + ' na mesa');
}

function burstConfetti(){
  const host = $('confetti');
  host.innerHTML = '';
  if(reduceMotion()) return;
  const colors = AVATAR_COLORS.concat(['#b8863b', '#f1e4c9', '#e8c07d', '#3f7a5c']);
  for(let i = 0; i < 60; i++){
    const bit = document.createElement('i');
    bit.className = 'confetti-bit';
    bit.style.left = (rand() * 100).toFixed(2) + '%';
    bit.style.width = (5 + rand() * 6).toFixed(1) + 'px';
    bit.style.height = (9 + rand() * 9).toFixed(1) + 'px';
    bit.style.background = colors[Math.floor(rand() * colors.length)];
    bit.style.animationDelay = (rand() * 0.4).toFixed(2) + 's';
    bit.style.animationDuration = (1.6 + rand() * 1.3).toFixed(2) + 's';
    bit.style.setProperty('--dx', ((rand() * 2 - 1) * 140).toFixed(0) + 'px');
    bit.style.setProperty('--spin', (360 + rand() * 900).toFixed(0) + 'deg');
    host.appendChild(bit);
  }
  setTimeout(clearConfetti, 3400);
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
  closeStage();
  hideResult();
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
    $('luckVal').textContent = state.luck + '%';
    renderSelectionList();
  });
  $('luckRange').addEventListener('change', () => {
    const value = Number($('luckRange').value);
    store.commit(current => { current.luck = value; return { next: current }; });
  });
  document.querySelectorAll('.anim-opt').forEach(btn => {
    btn.addEventListener('click', () => setAnimStyle(btn.dataset.style));
  });
  $('stageClose').addEventListener('click', closeStage);
  $('stageDone').addEventListener('click', closeStage);
  $('stageVeil').addEventListener('click', closeStage);
  $('stageUndo').addEventListener('click', undoLast);
  $('soundBtn').addEventListener('click', () => setSoundOn(!soundOn()));
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && stageOpen) closeStage();
  });
}

async function main(){
  bindEvents();
  renderAnimToggle();
  renderSoundToggle();
  await requireUnlock();
  $('app').classList.remove('hidden');
  store = await createStore({ onState: applyState, onStatus: setStatus });
  updateDecideButton();
}

main();
