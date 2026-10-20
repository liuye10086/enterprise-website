import test from 'node:test';
import assert from 'node:assert/strict';
import * as view from '../src/research-access-view.mjs';

const entry = await import('../src/research-entry.js').catch(() => ({}));
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = access => ({ authenticated: access !== 'signed-out', access, trialExpiresAt: access === 'trial' ? new Date(Date.now() + 900_000).toISOString() : null, serverNow: new Date().toISOString() });
const session = authenticated => ({ authenticated, email: authenticated ? 'person@example.test' : null, phone: null, products: {
  'module-01': { trialUsed: false, paid: false }, 'module-02': { trialUsed: false, paid: false },
}, mailReady: true, developmentMail: true, smsReady: false, developmentSms: false, profileComplete: authenticated ? true : null });

// The DOM/network boundary is simulated; the entry, sign-in and access handlers run unchanged.
function fixture(t, { referrer = 'https://research.arvivatherap.com/', origin = 'https://arvivatherap.com', framed = true, authenticated = false, delaySession = false } = {}) {
  const all = []; const values = new Map(); const messages = []; const destinations = []; const calls = [];
  function matches(node, selector) {
    if (selector.includes(' ') || selector.includes(':')) return false;
    const tag = /^[a-z]+/.exec(selector)?.[0];
    if (tag && tag !== node.tag) return false;
    const id = /#([\w-]+)/.exec(selector)?.[1];
    if (id && node.attrs.id !== id) return false;
    const cls = /\.([\w-]+)/.exec(selector)?.[1];
    if (cls && node.attrs.class !== cls) return false;
    return [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, key, value]) => Object.hasOwn(node.attrs, key) && (value === undefined || node.attrs[key] === value));
  }
  function element(tag, attrs = {}, parent = null) {
    const handlers = new Map();
    const node = { tag, attrs, parentNode: parent, dataset: {}, hidden: false, disabled: false, value: '', open: false, isConnected: true, textContent: '',
      addEventListener(name, fn) { handlers.set(name, [...(handlers.get(name) || []), fn]); },
      removeEventListener(name, fn) { handlers.set(name, (handlers.get(name) || []).filter(handler => handler !== fn)); },
      async dispatch(name, event = {}) { const value = { preventDefault() { this.defaultPrevented = true; }, ...event }; await Promise.all((handlers.get(name) || []).map(fn => fn(value))); return value; },
      click() { if (!this.disabled) return this.dispatch('click'); },
      setAttribute(name, value) { this.attrs[name] = value; }, getAttribute(name) { return this.attrs[name] ?? null; },
      querySelectorAll(selector) { return all.filter(child => { for (let p = child.parentNode; p; p = p.parentNode) if (p === this) return selector.split(',').some(part => matches(child, part.trim())); return false; }); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      reportValidity() { return true; }, closest() { return null; }, focus() { doc.activeElement = this; },
      reset() { this.querySelectorAll('input').forEach(input => { input.value = ''; }); },
      showModal() { this.open = true; }, close() { this.open = false; queueMicrotask(() => void this.dispatch('close')); },
    };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase())] = value;
    all.push(node); return node;
  }
  const doc = element('document'); doc.referrer = referrer; doc.visibilityState = 'visible';
  doc.documentElement = element('html', {}, doc); doc.createTreeWalker = () => ({ nextNode: () => null });
  const page = element('section', { 'data-research-access': '' }, doc);
  const states = Object.fromEntries(['loading', 'error', 'guest', 'options', 'preview', 'trial-label', 'trial-description', 'trial-button', 'retry'].map(key => { const node = element('div', { [`data-research-${key}`]: '' }, page); node.hidden = true; return [key, node]; }));
  const trigger = element('button', { 'data-login-open': '' }, states.guest);
  const upgrade = element('a', { class: 'research-upgrade', href: '/plans?product=module-01' }, page);
  const login = element('dialog', { 'data-login-dialog': '' }, doc);
  element('button', { 'data-login-close': '', class: 'login-close' }, login);
  const form = element('form', { 'data-login-form': '' }, login);
  const email = element('input', { name: 'email' }, form); const phone = element('input', { name: 'phone' }, form); const code = element('input', { name: 'code' }, form);
  const send = element('button', { 'data-login-send-code': '' }, form);
  element('button', { type: 'submit' }, form); element('p', { 'data-login-status': '' }, login);
  element('button', { 'data-live-logout': '', 'data-demo-logout': '' }, login);
  element('p', { 'data-access-announcement': '' }, doc);
  const browser = element('window'); doc.defaultView = browser;
  browser.location = Object.assign(new URL(`${origin}/research-entry?lang=zh-CN`), { assign: path => destinations.push(path), replace: path => destinations.push(path) });
  browser.parent = framed ? { postMessage: (message, targetOrigin) => messages.push([message, targetOrigin]) } : browser;
  browser.sessionStorage = browser.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  browser.MutationObserver = class { observe() {} disconnect() {} };
  browser.performance = { now: () => 0 }; browser.setInterval = () => 1; browser.clearInterval = () => {};
  let grant = authenticated ? 'trial-available' : 'signed-out'; let releaseSession;
  const original = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  Object.assign(globalThis, { document: doc, window: browser, fetch: async (url, options) => {
    calls.push([url, options]);
    if (url === '/api/session' && delaySession) { delaySession = false; await new Promise(resolve => { releaseSession = resolve; }); }
    let result;
    if (url === '/api/auth/verify') { authenticated = true; grant = 'trial-available'; result = session(true); }
    else if (url === '/api/research/access') result = response(grant);
    else if (url === '/api/research/trial') { grant = 'trial'; result = response(grant); }
    else result = session(authenticated);
    return new Response(JSON.stringify(result), { status: 200 });
  } });
  t.after(() => Object.assign(globalThis, original));
  return { root: doc, browser, messages, destinations, calls, login, trigger, form, email, phone, code, send, states, upgrade, releaseSession: () => releaseSession() };
}

test('entry renderer has only the embedded access flow and existing login dialog', () => {
  assert.equal(typeof view.renderResearchEntryPage, 'function');
  const html = view.renderResearchEntryPage();
  assert.match(html, /^<!doctype html>/); assert.match(html, /src="\/research-entry.js"/);
  assert.match(html, /data-research-access/); assert.match(html, /data-login-dialog/);
  assert.doesNotMatch(html, /site-header|site-footer|data-profile-prompt|data-research-entry-close|src="\/main.js"|class="research-back"/);
});

test('parent messages use only the exact approved referrer origin', async t => {
  const ui = fixture(t); const controller = entry.initializeResearchEntry(ui.root, ui.browser, { mode: 'live' }); await tick();
  await ui.upgrade.dispatch('click'); await ui.login.dispatch('cancel'); await ui.root.dispatch('keydown', { key: 'Escape' });
  assert.deepEqual(ui.messages, [
    [{ type: 'arviva-research', action: 'ready' }, 'https://research.arvivatherap.com'],
    [{ type: 'arviva-research', action: 'navigate', path: '/plans?product=module-01' }, 'https://research.arvivatherap.com'],
    [{ type: 'arviva-research', action: 'close' }, 'https://research.arvivatherap.com'],
  ]); assert.deepEqual(ui.destinations, []); controller.destroy();
});

test('untrusted or unavailable parent origins cannot receive messages and upgrade falls back locally', async t => {
  for (const options of [ { referrer: '' }, { referrer: 'https://research.arvivatherap.com.evil.example/' }, { referrer: 'http://research.arvivatherap.com/' }, { referrer: 'https://research.arvivatherap.com:444/' }, { origin: 'http://127.0.0.1:3000', referrer: 'http://127.0.0.1:3001/' }, { framed: false } ]) {
    const ui = fixture(t, options); const controller = entry.initializeResearchEntry(ui.root, ui.browser, { mode: 'live' }); await tick();
    await ui.upgrade.dispatch('click'); await ui.login.dispatch('cancel'); await ui.root.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(ui.messages, []); assert.deepEqual(ui.destinations, ['/plans?product=module-01']); controller.destroy();
  }
});

test('same-origin loopback previews can message their parent', async t => {
  const ui = fixture(t, { origin: 'http://127.0.0.1:3000', referrer: 'http://127.0.0.1:3000/research-demo.html' });
  const controller = entry.initializeResearchEntry(ui.root, ui.browser, { mode: 'demo' });
  assert.deepEqual(ui.messages, [[{ type: 'arviva-research', action: 'ready' }, 'http://127.0.0.1:3000']]);
  assert.equal(ui.login.open, true); assert.equal(ui.calls.length, 0); controller.destroy();
});

test('local preview login keeps the trial unconsumed until the trial button is selected', async t => {
  const ui = fixture(t, { origin: 'http://127.0.0.1:3000', referrer: 'http://127.0.0.1:3000/research-demo.html' });
  const controller = entry.initializeResearchEntry(ui.root, ui.browser, { mode: 'demo' });
  ui.email.value = 'person@example.test'; await ui.send.dispatch('click'); ui.code.value = '123456'; await ui.form.dispatch('submit');
  assert.equal(ui.login.open, false); assert.equal(ui.states.options.hidden, false);
  assert.equal(JSON.parse(ui.browser.sessionStorage.getItem('arviva-access-preview-v1')).products['module-01'].trialUsed, false);
  assert.equal(ui.calls.length, 0); assert.equal(ui.messages.filter(([message]) => message.action === 'navigate').length, 0);
  await ui.states['trial-button'].dispatch('click');
  assert.equal(JSON.parse(ui.browser.sessionStorage.getItem('arviva-access-preview-v1')).products['module-01'].trialUsed, true);
  assert.equal(ui.messages.at(-1)[0].path, '/research-workspace'); controller.destroy();
});

test('signed-out live entry waits for session readiness, signs in, then requires an explicit trial click', async t => {
  const ui = fixture(t, { delaySession: true }); const controller = entry.initializeResearchEntry(ui.root, ui.browser, { mode: 'live' }); await tick();
  assert.equal(ui.login.open, false); ui.releaseSession(); await tick();
  assert.equal(ui.login.open, true); assert.equal(ui.states.guest.hidden, false);
  ui.email.value = 'person@example.test'; ui.code.value = '123456'; await ui.form.dispatch('submit'); await tick();
  assert.equal(ui.login.open, false); assert.equal(ui.states.options.hidden, false);
  assert.equal(ui.calls.filter(([path]) => path === '/api/research/trial').length, 0);
  assert.deepEqual(ui.messages.filter(([message]) => message.action === 'navigate'), []);
  await ui.states['trial-button'].dispatch('click'); await tick();
  assert.equal(ui.calls.filter(([path]) => path === '/api/research/trial').length, 1);
  assert.deepEqual(ui.messages.at(-1), [{ type: 'arviva-research', action: 'navigate', path: '/research-workspace' }, 'https://research.arvivatherap.com']); controller.destroy();
});

test('Escape closes the login first and a dismissed login is not reopened on refresh', async t => {
  const ui = fixture(t); const controller = entry.initializeResearchEntry(ui.root, ui.browser, { mode: 'live' }); await tick();
  assert.equal(ui.login.open, true); await ui.root.dispatch('keydown', { key: 'Escape' });
  assert.equal(ui.messages.filter(([message]) => message.action === 'close').length, 0);
  await ui.login.dispatch('cancel'); await ui.browser.dispatch('focus'); await tick();
  assert.equal(ui.login.open, false); await ui.root.dispatch('keydown', { key: 'Escape' });
  assert.equal(ui.messages.filter(([message]) => message.action === 'close').length, 1); controller.destroy();
});

test('entry accepts only en or zh-CN from the language query', async t => {
  for (const [query, expected] of [['en', 'en'], ['zh-CN', 'zh-CN'], ['fr', 'en'], ['<script>', 'en']]) {
    const ui = fixture(t); ui.browser.location.search = `?lang=${encodeURIComponent(query)}`;
    const controller = entry.initializeResearchEntry(ui.root, ui.browser, { mode: 'live' });
    assert.equal(ui.root.documentElement.lang, expected); await tick(); controller.destroy();
  }
});
