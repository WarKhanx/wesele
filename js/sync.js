/* =========================================================
   Synchronizacja planu między urządzeniami
   Używa Firebase Realtime Database przez zwykłe zapytania HTTP
   (bez bibliotek – działa na GitHub Pages).
   Adres bazy wpisujesz w pliku config.js.
   ========================================================= */
window.Sync = (function(){
  'use strict';

  const CODE_KEY = 'plan-wesela-code';
  const POLL_MS = 4000;
  const PUSH_DELAY_MS = 600;
  const CODE_RE = /^[A-Za-z0-9_-]{12,}$/;

  let api = { getState: () => null, onRemote: () => false, onStatus: () => {} };
  let code = '';
  let dirty = false;
  let pushTimer = null;
  let pollTimer = null;
  let inFlight = false;

  function baseUrl(){
    const cfg = window.WESELE_CONFIG || {};
    return String(cfg.databaseURL || '').trim().replace(/\/+$/, '');
  }
  function configured(){ return /^https:\/\//.test(baseUrl()); }
  function enabled(){ return configured() && CODE_RE.test(code); }
  function endpoint(){ return baseUrl() + '/plans/' + encodeURIComponent(code) + '.json'; }

  function readCode(){ try{ return localStorage.getItem(CODE_KEY) || ''; }catch(e){ return ''; } }
  function writeCode(c){ try{ if(c) localStorage.setItem(CODE_KEY, c); else localStorage.removeItem(CODE_KEY); }catch(e){} }

  async function request(method, body){
    const opts = { method, cache: 'no-store' };
    if(body !== undefined){
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(endpoint(), opts);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function pushNow(){
    if(!enabled() || inFlight) return;
    inFlight = true;
    api.onStatus('syncing');
    try{
      await request('PUT', api.getState());
      dirty = false;
      api.onStatus('ok');
    }catch(e){
      dirty = true;               // spróbujemy ponownie przy następnym odpytaniu
      api.onStatus('error');
    }finally{
      inFlight = false;
    }
  }

  function push(){
    if(!enabled()) return;
    dirty = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, PUSH_DELAY_MS);
  }

  async function poll(){
    if(!enabled() || inFlight || document.hidden) return;
    if(dirty){ await pushNow(); return; }
    inFlight = true;
    try{
      const remote = await request('GET');
      const local = api.getState();
      const lt = (local && local.updatedAt) || 0;
      const rt = (remote && remote.updatedAt) || 0;
      if(remote && rt > lt){
        api.onRemote(remote);     // gdy użytkownik właśnie edytuje, wróci przy następnym odpytaniu
        api.onStatus('ok');
      } else if(!remote || rt < lt){
        inFlight = false;
        dirty = true;
        await pushNow();
        return;
      } else {
        api.onStatus('ok');
      }
    }catch(e){
      api.onStatus('error');
    }finally{
      inFlight = false;
    }
  }

  function startPolling(){
    stopPolling();
    pollTimer = setInterval(poll, POLL_MS);
    poll();
  }
  function stopPolling(){
    clearInterval(pollTimer);
    pollTimer = null;
  }

  /* Łączy z planem o podanym kodzie. Zwraca dane z serwera (lub null, gdy plan jeszcze nie istnieje). */
  async function connect(newCode){
    if(!configured()) throw new Error('Najpierw wpisz adres bazy w pliku config.js (patrz README.md).');
    if(!CODE_RE.test(newCode)) throw new Error('Kod musi mieć co najmniej 12 znaków: litery, cyfry, - lub _.');
    const prev = code;
    code = newCode;
    let remote;
    try{
      remote = await request('GET');
    }catch(e){
      code = prev;
      throw new Error('Nie można połączyć z bazą. Sprawdź internet, adres w config.js i reguły bazy.');
    }
    writeCode(code);
    dirty = false;
    startPolling();
    return remote;
  }

  function disconnect(){
    stopPolling();
    clearTimeout(pushTimer);
    code = '';
    dirty = false;
    writeCode('');
    api.onStatus(configured() ? 'local' : 'unconfigured');
  }

  function init(callbacks){
    api = Object.assign(api, callbacks);
    code = readCode();
    if(!configured()){ api.onStatus('unconfigured'); return; }
    if(!enabled()){ api.onStatus('local'); return; }
    api.onStatus('syncing');
    startPolling();
    document.addEventListener('visibilitychange', () => { if(!document.hidden) poll(); });
    window.addEventListener('online', poll);
  }

  return { init, push, connect, disconnect, configured, enabled, getCode: () => code };
})();
