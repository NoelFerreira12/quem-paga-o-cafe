import { firebaseConfig, FIRESTORE_COLLECTION, FIRESTORE_DOC, SEED_STATE } from './config.js?v=11';

const LOCAL_KEY = 'cafeLedger_v2';
const FIREBASE_VERSION = '10.12.2';

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function legacyId(date, time, payer, participants){
  const key = [date, time, payer, participants.join(',')].join('|');
  let hash = 0;
  for(let i = 0; i < key.length; i++){ hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff; }
  return 'hl_' + Math.abs(hash).toString(36);
}

const LUCK_MIN = 10;
const LUCK_MAX = 30;
const LUCK_DEFAULT = 20;

function clampLuck(value){
  if(value === undefined || value === null) return LUCK_DEFAULT;
  const n = Math.round(Number(value));
  if(!Number.isFinite(n)) return LUCK_DEFAULT;
  return Math.min(LUCK_MAX, Math.max(LUCK_MIN, n));
}

function normalize(raw){
  const base = { luck: LUCK_DEFAULT, people: [], selectedIds: [], history: [] };
  if(!raw || typeof raw !== 'object') return base;

  const history = Array.isArray(raw.history)
    ? raw.history.filter(h => h && typeof h.payer === 'string').map(h => {
        const date = String(h.date || '');
        const time = String(h.time || '');
        const participants = Array.isArray(h.participants) ? h.participants.map(String) : [];
        return {
          id: h.id ? String(h.id) : legacyId(date, time, h.payer, participants),
          date,
          time,
          payer: h.payer,
          participants
        };
      })
    : [];

  const pagoFromHistory = {};
  history.forEach(h => {
    pagoFromHistory[h.payer] = (pagoFromHistory[h.payer] || 0) + h.participants.length;
  });

  return {
    luck: clampLuck(raw.luck),
    people: Array.isArray(raw.people)
      ? raw.people
          .filter(p => p && typeof p.name === 'string')
          .map(p => {
            const pagamentos = Number(p.pagamentos) || 0;
            const pago = (p.pago === undefined || p.pago === null)
              ? Math.max(pagoFromHistory[p.name] || 0, pagamentos)
              : Number(p.pago) || 0;
            return {
              id: String(p.id || ''),
              name: p.name,
              idas: Number(p.idas) || 0,
              pagamentos,
              pago
            };
          })
      : [],
    selectedIds: Array.isArray(raw.selectedIds) ? raw.selectedIds.map(String) : [],
    history
  };
}

function createLocalStore({ onState, onStatus }){
  let state;
  try{
    state = normalize(JSON.parse(localStorage.getItem(LOCAL_KEY)));
    if(state.people.length === 0 && state.history.length === 0) state = normalize(SEED_STATE);
  }catch(e){
    state = normalize(SEED_STATE);
  }

  let persistent = true;

  function persist(){
    try{
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    }catch(e){
      persistent = false;
    }
    onStatus(persistent ? 'local' : 'volatile');
  }

  persist();
  onState(clone(state));

  return {
    mode: 'local',
    getState(){ return clone(state); },
    async commit(mutator){
      const outcome = mutator(clone(state));
      if(!outcome) return null;
      state = normalize(outcome.next);
      persist();
      onState(clone(state));
      return outcome.result ?? null;
    }
  };
}

async function createCloudStore({ onState, onStatus }){
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const {
    getFirestore, doc, getDoc, setDoc, onSnapshot, runTransaction
  } = await import(`${base}/firebase-firestore.js`);

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const ref = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC);

  const first = await getDoc(ref);
  if(!first.exists()) await setDoc(ref, clone(SEED_STATE));

  let state = normalize(first.exists() ? first.data() : SEED_STATE);

  onSnapshot(
    ref,
    snap => {
      if(!snap.exists()) return;
      state = normalize(snap.data());
      onStatus('cloud');
      onState(clone(state));
    },
    () => onStatus('error')
  );

  onStatus('cloud');
  onState(clone(state));

  return {
    mode: 'cloud',
    getState(){ return clone(state); },
    async commit(mutator){
      return runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const current = normalize(snap.exists() ? snap.data() : SEED_STATE);
        const outcome = mutator(current);
        if(!outcome) return null;
        tx.set(ref, normalize(outcome.next));
        return outcome.result ?? null;
      });
    }
  };
}

export async function createStore(handlers){
  if(firebaseConfig && firebaseConfig.projectId){
    try{
      return await createCloudStore(handlers);
    }catch(e){
      console.error('Firestore indisponivel, a usar armazenamento local', e);
      handlers.onStatus('error');
    }
  }
  return createLocalStore(handlers);
}
