import { createStore } from './store.js?v=2';
import { requireUnlock, lock } from './auth.js?v=2';

const AVATAR_COLORS = ['#4a3323', '#2f5d50', '#8a4b2b', '#3b5b7a', '#6b3f63', '#7a5c1e', '#455a3f', '#734a4a'];
const HISTORY_LIMIT = 25;
const EPS = 1e-9;

const STATUS_TEXT = {
  cloud: 'sincronizado com a equipa',
  local: 'so neste browser',
  volatile: 'sem guardar (browser bloqueou)',
  error: 'sem ligacao a nuvem'
};

let store = null;
let state = { people: [], selectedIds: [], history: [] };
let undoSnapshot = null;
let lastHistoryId = null;
let selfDecisionId = null;
let initialized = false;

const $ = id => document.getElementById(id);

function uid(prefix){
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function ratioOf(p){
  return p.idas === 0 ? 0 : p.pagamentos / p.idas;
}

function pct(p){
  if(p.idas === 0) return '0%';
  return Math.round((p.pagamentos / p.idas) * 100) + '%';
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
    li.innerHTML = `
      ${avatarHtml(p.name)}
      <span class="person-name">${escapeHtml(p.name)}</span>
      <span class="person-stats">${p.pagamentos}/${p.idas} &middot; ${pct(p)}</span>
      <button class="remove-btn" data-id="${escapeHtml(p.id)}" aria-label="Remover ${escapeHtml(p.name)}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>
    `;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removePerson(btn.dataset.id));
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
        <span class="sel-badge">${pct(p)}</span>
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
    const diff = ratioOf(a) - ratioOf(b);
    if(Math.abs(diff) > EPS) return diff;
    return a.pagamentos - b.pagamentos;
  });
  sorted.forEach((p, idx) => {
    const li = document.createElement('li');
    li.className = 'fair-row';
    const barWidth = Math.min(100, Math.round(ratioOf(p) * 100));
    li.innerHTML = `
      <span class="fair-rank">${idx + 1}&ordm;</span>
      ${avatarHtml(p.name, 'avatar-sm')}
      <span class="fair-name">${escapeHtml(p.name)}</span>
      <div class="fair-bar-track"><div class="fair-bar-fill" style="width:${barWidth}%"></div></div>
      <span class="fair-pct">${pct(p)}</span>
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
    li.className = 'history-row';
    const outros = h.participants.filter(n => n !== h.payer);
    const outrosTxt = outros.length ? ' com ' + outros.join(', ') : ' sozinho';
    li.innerHTML = `
      <span class="history-time">${escapeHtml(h.date)}<br>${escapeHtml(h.time)}</span>
      <span class="history-text"><b>${escapeHtml(h.payer)}</b> pagou,${escapeHtml(outrosTxt)}</span>
    `;
    ul.appendChild(li);
  });
}

function renderStats(){
  $('statTeamCount').textContent = state.people.length;
  $('statTodayCount').textContent = state.selectedIds.length;
}

function updateDecideButton(){
  $('decideBtn').disabled = !store || state.selectedIds.length === 0 || state.people.length === 0;
}

function renderAll(){
  renderPeopleList();
  renderSelectionList();
  renderFairness();
  renderHistory();
  renderStats();
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
    current.people.push({ id: uid('p'), name, idas: 0, pagamentos: 0 });
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
  const decisionId = uid('h');
  selfDecisionId = decisionId;
  undoSnapshot = store.getState();

  const btn = $('decideBtn');
  btn.disabled = true;
  showDeciding();

  const result = await store.commit(current => {
    const participants = current.people.filter(p => current.selectedIds.includes(p.id));
    if(participants.length === 0) return null;

    const minRatio = Math.min(...participants.map(ratioOf));
    const tier1 = participants.filter(p => Math.abs(ratioOf(p) - minRatio) < EPS);
    const minPag = Math.min(...tier1.map(p => p.pagamentos));
    const tier2 = tier1.filter(p => p.pagamentos === minPag);
    const chosen = tier2[Math.floor(Math.random() * tier2.length)];

    participants.forEach(p => { p.idas += 1; });
    chosen.pagamentos += 1;

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

  if(!result){
    hideResult();
    undoSnapshot = null;
    return;
  }

  setTimeout(() => showResultCard(result), 550);
}

function undoLast(){
  if(!undoSnapshot) return;
  const snapshot = undoSnapshot;
  undoSnapshot = null;
  selfDecisionId = snapshot.history[0] ? snapshot.history[0].id || null : null;
  store.commit(() => ({ next: snapshot }));
  hideResult();
}

function resetAll(){
  if(!confirm('Apagar toda a equipa, idas e pagamentos? Esta acao nao pode ser desfeita.')) return;
  undoSnapshot = null;
  store.commit(() => ({ next: { people: [], selectedIds: [], history: [] } }));
  hideResult();
}

function showDeciding(){
  $('resultWrap').classList.remove('hidden');
  $('resultCard').classList.add('hidden');
  $('decidingState').classList.remove('hidden');
}

function showResultCard(payerName){
  $('resultWrap').classList.remove('hidden');
  $('decidingState').classList.add('hidden');
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
  $('resetBtn').addEventListener('click', resetAll);
  $('lockBtn').addEventListener('click', lock);
}

async function main(){
  bindEvents();
  await requireUnlock();
  $('app').classList.remove('hidden');
  store = await createStore({ onState: applyState, onStatus: setStatus });
  updateDecideButton();
}

main();
