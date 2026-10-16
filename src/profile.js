import { requestAccessApi } from './access-live.js';

const editable = ['fullName', 'contactPhone', 'organization', 'researchArea'];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank = email => ({profile:{fullName:'',email,contactPhone:'',organization:'',researchArea:'',submittedAt:null},complete:false});

export function validateProfileFields(raw) {
  const fields = Object.fromEntries(editable.map(key => [key, typeof raw?.[key] === 'string' ? raw[key].trim() : '']));
  if (!fields.fullName || fields.fullName.length > 100 || /[\x00-\x1f\x7f]/.test(fields.fullName)) throw new Error('Enter your name (up to 100 characters).');
  const digits = fields.contactPhone.replace(/\D/g, '');
  if (fields.contactPhone.length > 32 || !/^\+?[0-9 ()-]+$/.test(fields.contactPhone) || digits.length < 7 || digits.length > 15) throw new Error('Enter a valid contact phone number (7–15 digits).');
  for (const key of ['organization','researchArea']) {
    if (fields[key].length > 200 || /[\x00-\x1f\x7f]/.test(fields[key])) throw new Error('Organization and research area must each be 200 characters or fewer.');
  }
  return fields;
}

export function readProfileResponse(raw, email) {
  const p = raw?.profile;
  if (!p || p.email !== email || !emailPattern.test(email) || typeof raw.complete !== 'boolean' ||
      editable.some(key => typeof p[key] !== 'string') ||
      (p.submittedAt !== null && (typeof p.submittedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(p.submittedAt) || !Number.isFinite(Date.parse(p.submittedAt))))) {
    throw new Error('The server returned an invalid profile. Please try again.');
  }
  if (raw.complete) {
    try { validateProfileFields(p); if (!p.submittedAt) throw new Error(); }
    catch { throw new Error('The server returned an invalid profile. Please try again.'); }
  }
  return {profile:Object.fromEntries(['email',...editable,'submittedAt'].map(key=>[key,p[key]])),complete:raw.complete};
}

// Used only by the loopback static preview. Live customer data stays on the server.
export function createPreviewProfileStore(storage) {
  const identityKey = 'arviva-profile-preview-email-v1';
  const profileKey = email => `arviva-profile-preview-v1:${encodeURIComponent(email)}`;
  const load = email => {
    try { const raw = JSON.parse(storage?.getItem(profileKey(email)) || 'null'); return readProfileResponse(raw,email); }
    catch { return blank(email); }
  };
  return {
    identity() { try { const email = storage?.getItem(identityKey); return emailPattern.test(email || '') ? email : null; } catch { return null; } },
    setIdentity(email) { try { storage?.setItem(identityKey,email); return storage?.getItem(identityKey)===email; } catch { return false; } },
    load,
    save(email, values) {
      const current = load(email);
      const result = {profile:{...validateProfileFields(values),email,submittedAt:current.profile.submittedAt || new Date().toISOString()},complete:true};
      try {
        if (!storage) throw new Error();
        const serialized = JSON.stringify(result);
        storage.setItem(profileKey(email),serialized);
        if (storage.getItem(profileKey(email)) !== serialized) throw new Error();
      } catch { throw new Error('Preview storage is unavailable. Enable browser storage and try again.'); }
      return result;
    },
  };
}

export function initializeProfile({mode = 'live', root = document, browser = window, request = requestAccessApi} = {}) {
  const page = root.querySelector('[data-profile-page]');
  const form = root.querySelector('[data-profile-form]');
  const prompt = root.querySelector('[data-profile-prompt]');
  const live = mode === 'live';
  const demo = !live && ['localhost','127.0.0.1','[::1]'].includes(browser.location.hostname);
  let previewStorage;
  if (demo) { try { previewStorage = browser.sessionStorage; } catch { /* Display a storage error on save. */ } }
  const preview = createPreviewProfileStore(previewStorage);
  let previewEmail = preview.identity();
  let previewIdentityInMemory = false;
  let session = null;
  let identity = 'uninitialized';
  let revision = 0;
  let saving = false;
  let previousFocus = null;
  let previousOverflow = null;
  const input = name => form?.querySelector(`[name="${name}"]`);
  const setHidden = (name, hidden) => root.querySelectorAll(`[data-profile-${name}]`).forEach(el=>{el.hidden=hidden;});
  const setText = (name,text) => { const el=root.querySelector(`[data-profile-${name}]`); if(el) el.textContent=text; };
  const state = name => {
    for (const key of ['guest','loading','load-error','email-only','form']) setHidden(key,key!==name);
  };
  const status = (message,kind='success') => {
    setText('status',message);
    root.querySelector('[data-profile-status]')?.setAttribute('data-kind',kind);
  };
  function unlockPage() {
    if (previousOverflow !== null && root.body) root.body.style.overflow=previousOverflow;
    previousOverflow=null;
  }
  function dismiss() {
    if(prompt?.open) prompt.close();
    unlockPage();
    if(previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus();
    previousFocus=null;
  }
  function controls() {
    if (!form) return;
    form.querySelectorAll('input').forEach(el=>{el.disabled=saving;});
    const button=root.querySelector('[data-profile-save]');
    if(button) {button.disabled=saving;button.textContent=saving?'Saving…':'Save profile';}
    form.setAttribute('aria-busy',String(saving));
  }
  function render(result) {
    if(!form) return;
    for(const key of ['email',...editable]) if(input(key)) input(key).value=result.profile[key];
    setText('date',result.profile.submittedAt ? result.profile.submittedAt.slice(0,10) : 'Recorded when you save');
    setHidden('complete',!result.complete);
    state('form');
  }
  async function load() {
    if(!page || !session?.authenticated || !session.email || saving) return;
    const ticket=++revision;
    const email=session.email;
    state('loading'); status(''); setText('load-error-message','Please try again in a moment.');
    try {
      const raw=live ? await request('/api/profile') : preview.load(email);
      if(ticket!==revision) return;
      render(readProfileResponse(raw,email));
    } catch(error) {
      if(ticket!==revision) return;
      if(error.status===401) onSession({authenticated:false,email:null});
      else state('load-error');
    }
  }
  function onSession(raw, {loading=false} = {}) {
    if(demo && !raw?.email && !previewIdentityInMemory) previewEmail=preview.identity();
    session = raw && { ...raw, email:live ? raw.email : raw.authenticated ? raw.email || previewEmail : null };
    const emailAccount = session?.authenticated && typeof session.email==='string' && emailPattern.test(session.email) && (live || demo);
    setHidden('link',!emailAccount);
    const next = !session ? loading ? 'loading' : 'unavailable' : !session.authenticated ? 'guest' : emailAccount ? session.email : 'phone';
    if(next===identity) return;
    identity=next; ++revision; saving=false; dismiss();
    if(form) { form.reset(); input('email').value=''; status(''); setHidden('complete',true); controls(); }
    if(!page) return;
    if(!session) state(loading ? 'loading' : 'load-error');
    else if(!session.authenticated) state('guest');
    else if(!emailAccount) state('email-only');
    else void load();
  }
  function onSignIn(raw) {
    if(demo && raw?.email) {previewEmail=raw.email;previewIdentityInMemory=!preview.setIdentity(raw.email);}
    onSession(raw);
    if(!session?.authenticated || !session.email || (!live&&!demo)) return;
    const incomplete=live ? session.profileComplete===false : !preview.load(session.email).complete;
    if(!incomplete || page || !prompt || prompt.open) return;
    previousFocus=root.activeElement;
    if(root.body) {previousOverflow=root.body.style.overflow;root.body.style.overflow='hidden';}
    prompt.showModal();
    root.querySelector('[data-profile-go]')?.focus();
  }
  root.querySelectorAll('[data-profile-dismiss]').forEach(button=>button.addEventListener('click',dismiss));
  prompt?.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  prompt?.addEventListener('close',unlockPage);
  root.querySelector('[data-profile-retry]')?.addEventListener('click',()=>{
    if(!session) browser.location.reload();
    else void load();
  });
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    if(saving || !session?.authenticated || !session.email || !form.reportValidity()) return;
    let values;
    try {values=validateProfileFields(Object.fromEntries(editable.map(key=>[key,input(key).value])));}
    catch(error) {status(error.message,'error');return;}
    const ticket=++revision;
    const email=session.email;
    saving=true;controls();status('');
    try {
      const raw=live ? await request('/api/profile',{method:'POST',body:{...values,expectedEmail:email}}) : preview.save(email,values);
      if(ticket!==revision) return;
      const result=readProfileResponse(raw,email);
      render(result);session.profileComplete=result.complete;
      status('Your profile has been saved.');
    } catch(error) {
      if(ticket!==revision) return;
      if(error.status===401) onSession({authenticated:false,email:null});
      else if(error.status===409 || error.status===403) {onSession(null);setText('load-error-message',error.message);}
      else status(error.message,'error');
    } finally {if(ticket===revision){saving=false;controls();}}
  });
  browser.addEventListener('pagehide',()=>{
    ++revision;identity='uninitialized';dismiss();
    if(form){form.reset();state('loading');}
  });
  setHidden('preview',!demo);
  return {onSession,onSignIn};
}
