import { normalizeDemoState, consumeTrial } from './access-state.js';
import { requestAccessApi } from './access-live.js';

const stateKey = 'arviva-access-preview-v1';
const deadlineKey = 'arviva-research-trial-preview-v1';
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const states = new Set(['signed-out', 'trial-available', 'trial-used', 'trial', 'paid']);
const snapshot = (access, trialExpiresAt = null, serverNow = new Date().toISOString()) => ({ authenticated: access !== 'signed-out', access, trialExpiresAt, serverNow });
const allowed = state => state?.access === 'paid' || state?.access === 'trial';
const isTimestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));

export function readResearchAccessResponse(raw) {
  if (!raw || typeof raw.authenticated !== 'boolean' || !states.has(raw.access) ||
      raw.authenticated !== (raw.access !== 'signed-out') ||
      !isTimestamp(raw.serverNow) ||
      (raw.trialExpiresAt !== null && !isTimestamp(raw.trialExpiresAt)) ||
      (raw.access === 'trial' && raw.trialExpiresAt === null)) {
    throw new Error('The server returned invalid access information. Please try again.');
  }
  if (raw.access === 'trial' && Date.parse(raw.trialExpiresAt) <= Date.parse(raw.serverNow)) return snapshot('trial-used', null, raw.serverNow);
  return snapshot(raw.access, raw.access === 'trial' ? raw.trialExpiresAt : null, raw.serverNow);
}

// This store is only instantiated for the loopback preview. Production access is
// always checked with the authenticated server API and never browser storage.
export function createPreviewResearchAccess(storage, { now = () => Date.now() } = {}) {
  const load = () => normalizeDemoState(JSON.parse(storage?.getItem(stateKey) || 'null'));
  const read = () => {
    const state = load();
    const serverNow = new Date(now()).toISOString();
    if (!state.signedIn) return snapshot('signed-out', null, serverNow);
    const product = state.products['module-01'];
    if (product.paid) return snapshot('paid', null, serverNow);
    if (!product.trialUsed) return snapshot('trial-available', null, serverNow);
    const expires = storage?.getItem(deadlineKey);
    return Number.isFinite(Date.parse(expires)) && Date.parse(expires) > now() ? snapshot('trial', expires, serverNow) : snapshot('trial-used', null, serverNow);
  };
  return {
    read,
    start() {
      const current = read();
      if (allowed(current)) return current;
      if (!current.authenticated) throw new Error('Sign in before starting your free trial.');
      if (current.access !== 'trial-available') throw new Error('Your free trial has already been used.');
      const expires = new Date(now() + 15 * 60 * 1000).toISOString();
      const serialized = JSON.stringify(consumeTrial(load(), 'module-01'));
      try {
        if (!storage) throw new Error();
        storage.setItem(deadlineKey, expires);
        storage.setItem(stateKey, serialized);
        if (storage.getItem(stateKey) !== serialized || storage.getItem(deadlineKey) !== expires) throw new Error();
      } catch { throw new Error('Preview storage is unavailable. Enable browser storage and try again.'); }
      return read();
    },
  };
}

export function initializeResearchAccess(root = document, browser = root.defaultView, {
  mode = 'live', request = requestAccessApi, navigate = path => browser.location.replace(path), onGuest = () => {},
} = {}) {
  const accessPage = root.querySelector('[data-research-access]');
  const workspace = root.querySelector('[data-research-workspace]');
  const page = accessPage || workspace;
  if (!page) return { refresh() {}, onSession() {}, destroy() {} };
  let revision = 0;
  let current = null;
  let busy = false;
  let destroyed = false;
  let interval = null;
  let sessionIdentity = null;
  const listeners = [];
  const find = name => page.querySelector(`[data-research-${name}]`);
  const hidden = (name, value) => { const element = find(name); if (element) element.hidden = value; };
  const text = (name, value) => { const element = find(name); if (element && element.textContent !== value) element.textContent = value; };
  const listen = (target, event, handler) => {
    target?.addEventListener(event, handler);
    if (target) listeners.push(() => target.removeEventListener(event, handler));
  };
  const isPreview = () => mode === 'demo' && loopback.has(browser.location.hostname);
  const preview = () => createPreviewResearchAccess(browser.sessionStorage);
  const clearTimer = () => { if (interval !== null) browser.clearInterval(interval); interval = null; };
  const showState = name => {
    for (const state of ['loading', 'error', 'guest', 'options', 'content']) hidden(state, state !== name);
  };
  const controls = () => {
    const button = find('trial-button');
    if (button) button.disabled = busy || current?.access !== 'trial-available';
    page.setAttribute('aria-busy', String(busy));
  };
  const showError = () => { clearTimer(); current = null; showState('error'); };
  const redirect = path => { clearTimer(); navigate(path); };
  const render = result => {
    current = result;
    controls();
    clearTimer();
    if (workspace) {
      if (!allowed(result)) { showState('loading'); redirect('/research-access'); return; }
      showState('content');
      text('access-label', result.access === 'paid' ? 'Full access active' : 'Free trial active');
      hidden('timer', result.access !== 'trial');
      if (result.access === 'trial') {
        const remainingMs = Date.parse(result.trialExpiresAt) - Date.parse(result.serverNow);
        const startedAt = browser.performance.now();
        const updateTimer = () => {
          const seconds = Math.max(0, Math.ceil((remainingMs - (browser.performance.now() - startedAt)) / 1000));
          // Hide the preview while checking expiry with the server. The browser
          // countdown is display-only and cannot decide account entitlements.
          if (!seconds) { clearTimer(); showState('loading'); refresh(); return; }
          text('remaining', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
        };
        updateTimer();
        interval = browser.setInterval(updateTimer, 1000);
      }
      return;
    }
    if (allowed(result)) { showState('loading'); redirect('/research-workspace'); return; }
    if (!result.authenticated) { showState('guest'); onGuest(); return; }
    showState('options');
    const available = result.access === 'trial-available';
    text('trial-label', available ? 'TRY IT FIRST' : 'TRIAL COMPLETED');
    text('trial-description', available ? 'Start a 15-minute trial of the Research Platform. One trial per account.' : 'Your free trial has ended. Upgrade to continue exploring the Research Platform.');
    text('trial-button', available ? 'Start free trial →' : 'Trial used');
  };
  async function refresh() {
    if (destroyed || busy) return;
    const ticket = ++revision;
    clearTimer(); showState('loading');
    hidden('preview', !isPreview());
    try {
      if (mode !== 'live' && !isPreview()) throw new Error('Preview unavailable.');
      const raw = mode === 'live' ? await request('/api/research/access') : preview().read();
      if (ticket !== revision || destroyed) return;
      render(readResearchAccessResponse(raw));
    } catch {
      if (ticket === revision && !destroyed) showError();
    }
  }
  async function startTrial() {
    if (busy || current?.access !== 'trial-available') return;
    busy = true; controls();
    const ticket = ++revision;
    try {
      if (mode !== 'live' && !isPreview()) throw new Error('Preview unavailable.');
      const raw = mode === 'live' ? await request('/api/research/trial', { method: 'POST' }) : preview().start();
      if (ticket !== revision || destroyed) return;
      // Navigation uses a fixed local route, never the untrusted response URL.
      render(readResearchAccessResponse(raw));
    } catch (error) {
      if (ticket !== revision || destroyed) return;
      if (error.status === 401) render(snapshot('signed-out'));
      else if (mode === 'live' && (error.status === 403 || error.status === 409)) {
        try {
          const latest = await request('/api/research/access');
          if (ticket === revision && !destroyed) render(readResearchAccessResponse(latest));
        } catch {
          if (ticket === revision && !destroyed) showError();
        }
      }
      else showError();
    } finally {
      if (ticket === revision && !destroyed) { busy = false; controls(); }
    }
  }
  listen(find('trial-button'), 'click', startTrial);
  listen(find('retry'), 'click', refresh);
  listen(browser, 'focus', refresh);
  listen(browser, 'pageshow', refresh);
  listen(root, 'visibilitychange', () => { if (!root.hidden) refresh(); });
  refresh();
  return {
    refresh,
    onSession(session, { loading = false } = {}) {
      if (loading || !session) return;
      const identity = JSON.stringify([session.authenticated === true, session.email || null, session.phone || null]);
      if (identity === sessionIdentity) return;
      sessionIdentity = identity;
      ++revision; busy = false; current = null; controls(); refresh();
    },
    destroy() { destroyed = true; ++revision; clearTimer(); listeners.forEach(remove => remove()); },
  };
}
