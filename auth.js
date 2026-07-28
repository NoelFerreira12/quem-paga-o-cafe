import { SHARED_PASSWORD_HASH } from './config.js?v=9';

const UNLOCK_KEY = 'cafeUnlock_v1';

async function sha256(text){
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function readUnlock(){
  try{ return localStorage.getItem(UNLOCK_KEY); }catch(e){ return null; }
}

function writeUnlock(value){
  try{ localStorage.setItem(UNLOCK_KEY, value); }catch(e){ /* modo privado, so esta sessao */ }
}

function bindReveal(input){
  const btn = document.getElementById('gateReveal');
  const iconShow = document.getElementById('eyeShow');
  const iconHide = document.getElementById('eyeHide');

  btn.addEventListener('click', () => {
    const revealed = input.type === 'text';
    input.type = revealed ? 'password' : 'text';
    btn.setAttribute('aria-pressed', String(!revealed));
    btn.setAttribute('aria-label', revealed ? 'Mostrar palavra-passe' : 'Esconder palavra-passe');
    iconShow.classList.toggle('hidden', !revealed);
    iconHide.classList.toggle('hidden', revealed);
    input.focus();
  });
}

export function requireUnlock(){
  const gate = document.getElementById('gate');
  const form = document.getElementById('gateForm');
  const input = document.getElementById('gatePassword');
  const error = document.getElementById('gateError');

  bindReveal(input);

  if(readUnlock() === SHARED_PASSWORD_HASH){
    gate.classList.add('hidden');
    return Promise.resolve();
  }

  gate.classList.remove('hidden');
  input.focus();

  return new Promise(resolve => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.textContent = '';

      if(!crypto.subtle){
        error.textContent = 'abre a pagina em https ou localhost';
        return;
      }

      const hash = await sha256(input.value);
      if(hash !== SHARED_PASSWORD_HASH){
        error.textContent = 'palavra-passe errada';
        input.select();
        return;
      }

      writeUnlock(hash);
      input.value = '';
      gate.classList.add('hidden');
      resolve();
    });
  });
}
