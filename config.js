export const SHARED_PASSWORD_HASH = '05e1d1ef9ff7562ae720f5fbb06f6456559ffb9e0dcd17092451698768fc867b';

export const firebaseConfig = {
  apiKey: 'AIzaSyBgoARID7gLVJ6rrEnf54x2xJQnWsLTY10',
  authDomain: 'quem-paga-o-cafe.firebaseapp.com',
  projectId: 'quem-paga-o-cafe',
  storageBucket: 'quem-paga-o-cafe.firebasestorage.app',
  messagingSenderId: '636017980188',
  appId: '1:636017980188:web:188f2f88398682db7000d9'
};

export const FIRESTORE_COLLECTION = 'cafe';
export const FIRESTORE_DOC = 'ledger';

export const SEED_STATE = {
  people: [
    { id: 'p_noel',    name: 'NOEL',    idas: 5, pagamentos: 1 },
    { id: 'p_hugo',    name: 'HUGO',    idas: 5, pagamentos: 1 },
    { id: 'p_jorge',   name: 'JORGE',   idas: 5, pagamentos: 0 },
    { id: 'p_ruben',   name: 'RUBEN',   idas: 5, pagamentos: 1 },
    { id: 'p_almeida', name: 'ALMEIDA', idas: 5, pagamentos: 1 },
    { id: 'p_andre',   name: 'ANDRE',   idas: 5, pagamentos: 1 }
  ],
  selectedIds: [],
  history: [
    { date: '24/07/2026', time: '14:40', payer: 'NOEL',    participants: ['NOEL', 'HUGO', 'JORGE', 'RUBEN', 'ALMEIDA', 'ANDRE'] },
    { date: '24/07/2026', time: '14:40', payer: 'ANDRE',   participants: ['NOEL', 'HUGO', 'JORGE', 'RUBEN', 'ALMEIDA', 'ANDRE'] },
    { date: '24/07/2026', time: '14:40', payer: 'ALMEIDA', participants: ['NOEL', 'HUGO', 'JORGE', 'RUBEN', 'ALMEIDA', 'ANDRE'] },
    { date: '24/07/2026', time: '14:40', payer: 'RUBEN',   participants: ['NOEL', 'HUGO', 'JORGE', 'RUBEN', 'ALMEIDA', 'ANDRE'] },
    { date: '24/07/2026', time: '14:39', payer: 'HUGO',    participants: ['NOEL', 'HUGO', 'JORGE', 'RUBEN', 'ALMEIDA', 'ANDRE'] }
  ]
};
