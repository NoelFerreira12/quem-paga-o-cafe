import { createStore } from './store.js?v=9';
import { requireUnlock } from './auth.js?v=9';

const AVATAR_COLORS = ['#4a3323', '#2f5d50', '#8a4b2b', '#3b5b7a', '#6b3f63', '#7a5c1e', '#455a3f', '#734a4a'];
const HISTORY_LIMIT = 25;

const STATUS_TEXT = {
  cloud: 'sincronizado com a equipa',
  local: 'so neste browser',
  volatile: 'sem guardar (browser bloqueou)',
  error: 'sem ligacao a nuvem'
};

let store = null;
let state = { luck: 30, people: [], selectedIds: [], history: [] };
let editDraft = null;
let undoSnapshot = null;
let lastHistoryId = null;
let selfDecisionId = null;
let initialized = false;

const $ = id => document.getElementById(id);

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
  let r = Math.random();
  for(let i = 0; i < weights.length; i++){
    r -= weights[i];
    if(r <= 0) return i;
  }
  return weights.length - 1;
}

function weightedPick(parts, luck){
  return parts[pickIndex(chanceWeights(parts, luck))];
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
    state.people.forEach(p => {
      const li = document.createElement('li');
      li.className = 'sel-row';
      const checked = state.selectedIds.includes(p.id) ? 'checked' : '';
      li.innerHTML = `
        <input type="checkbox" data-id="${escapeHtml(p.id)}" ${checked} id="chk_${escapeHtml(p.id)}">
        ${avatarHtml(p.name, 'avatar-sm')}
        <label class="sel-name" for="chk_${escapeHtml(p.id)}">${escapeHtml(p.name)}</label>
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
  sorted.forEach((p, idx) => {
    const li = document.createElement('li');
    li.className = 'fair-row';
    const b = balanceOf(p);
    const tone = b < 0 ? 'debt' : b > 0 ? 'ahead' : 'even';
    const barWidth = Math.round((Math.abs(b) / maxAbs) * 100);
    const next = idx === 0 ? '<span class="fair-next">próximo</span>' : '';
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
  $('decideBtn').disabled = !store || state.selectedIds.length === 0 || state.people.length === 0;
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
    showResultCard(newest.payer);
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

  $('decideBtn').disabled = true;
  openRoulette(selectedPeople);

  const winnerName = await store.commit(current => {
    const participants = current.people.filter(p => current.selectedIds.includes(p.id));
    if(participants.length === 0) return null;

    const chosen = weightedPick(participants, current.luck);

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

  updateDecideButton();

  if(!winnerName){
    closeRoulette();
    hideResult();
    undoSnapshot = null;
    return;
  }

  const winner = selectedPeople.find(p => p.name === winnerName) || { name: winnerName };
  await spinRoulette(selectedPeople, winner);
  await wait(500);
  closeRoulette();
  showResultCard(winnerName);
}

function rouletteCardHtml(person, isWin){
  return `<div class="roulette-card${isWin ? ' win' : ''}">
    <div class="avatar avatar-sm" style="background:${colorForName(person.name)}">${escapeHtml(initialsFor(person.name))}</div>
    <span class="roulette-card-name">${escapeHtml(person.name)}</span>
  </div>`;
}

function openRoulette(parts){
  $('resultWrap').classList.remove('hidden');
  $('resultCard').classList.add('hidden');
  $('roulette').classList.remove('hidden');
  const track = $('rouletteTrack');
  const weights = chanceWeights(parts, state.luck);
  const cards = [];
  for(let i = 0; i < 24; i++) cards.push(rouletteCardHtml(parts[pickIndex(weights)], false));
  track.style.transition = 'none';
  track.style.transform = 'translateX(0)';
  track.innerHTML = cards.join('');
}

function spinRoulette(parts, winner){
  const roul = $('roulette');
  const viewportW = roul.querySelector('.roulette-viewport').clientWidth;
  const track = $('rouletteTrack');
  const CARDW = 96;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const winIndex = (reduce ? 6 : 44) + Math.floor(Math.random() * 6);
  const total = winIndex + Math.ceil(viewportW / CARDW) + 4;
  const weights = chanceWeights(parts, state.luck);

  const cards = [];
  for(let i = 0; i < total; i++){
    cards.push(i === winIndex ? rouletteCardHtml(winner, true) : rouletteCardHtml(parts[pickIndex(weights)], false));
  }
  track.innerHTML = cards.join('');

  const jitter = (Math.random() * 0.4 - 0.2) * CARDW;
  const target = -((winIndex * CARDW) + CARDW / 2 - viewportW / 2 + jitter);
  track.style.transition = 'none';
  track.style.transform = 'translateX(0)';
  void track.offsetWidth;
  const dur = reduce ? 350 : 4200;
  track.style.transition = `transform ${dur}ms cubic-bezier(0.13, 0.72, 0.10, 1)`;
  track.style.transform = `translateX(${target}px)`;

  return new Promise(resolve => {
    let done = false;
    const finish = () => { if(done) return; done = true; track.removeEventListener('transitionend', finish); resolve(); };
    track.addEventListener('transitionend', finish);
    setTimeout(finish, dur + 250);
  });
}

function closeRoulette(){
  $('roulette').classList.add('hidden');
}

function undoLast(){
  if(!undoSnapshot) return;
  const snapshot = undoSnapshot;
  undoSnapshot = null;
  selfDecisionId = snapshot.history[0] ? snapshot.history[0].id || null : null;
  store.commit(() => ({ next: snapshot }));
  hideResult();
}

function showResultCard(payerName){
  $('resultWrap').classList.remove('hidden');
  closeRoulette();
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
  $('luckRange').addEventListener('input', () => { $('luckVal').textContent = $('luckRange').value + '%'; });
  $('luckRange').addEventListener('change', () => {
    const value = Number($('luckRange').value);
    store.commit(current => { current.luck = value; return { next: current }; });
  });
}

async function main(){
  bindEvents();
  await requireUnlock();
  $('app').classList.remove('hidden');
  store = await createStore({ onState: applyState, onStatus: setStatus });
  updateDecideButton();
}

main();
