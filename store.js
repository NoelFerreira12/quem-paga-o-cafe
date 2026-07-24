import { firebaseConfig, FIRESTORE_COLLECTION, FIRESTORE_DOC, SEED_STATE } from './config.js?v=3';

const LOCAL_KEY = 'cafeLedger_v2';
const FIREBASE_VERSION = '10.12.2';

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function normalize(raw){
  const base = { people: [], selectedIds: [], history: [] };
  if(!raw || typeof raw !== 'object') return base;
  return {
    people: Array.isArray(raw.people)
      ? raw.people
          .filter(p => p && typeof p.name === 'string')
          .map(p => ({
            id: String(p.id || ''),
            name: p.name,
            idas: Number(p.idas) || 0,
            pagamentos: Number(p.pagamentos) || 0
          }))
      : [],
    selectedIds: Array.isArray(raw.selectedIds) ? raw.selectedIds.map(String) : [],
    history: Array.isArray(raw.history)
      ? raw.history.filter(h => h && typeof h.payer === 'string').map(h => ({
          date: String(h.date || ''),
          time: String(h.time || ''),
          payer: h.payer,
          participants: Array.isArray(h.participants) ? h.participants.map(String) : []
        }))
      : []
  };
}

function createLocalStore({ onState, onStatus }){
  let state;
  try{
    state = normalize(JSON.parse(localStorage.getItem(LOCAL_KEY)));
    if(state.people.length === 0 && state.history.length === 0) state = clone(SEED_STATE);
  }catch(e){
    state = clone(SEED_STATE);
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
