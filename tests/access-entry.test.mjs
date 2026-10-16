import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLiveAccess } from '../src/access-live.js';
import { initializeAccess } from '../src/access.js';
import { renderAccessDialogs } from '../src/access-view.mjs';
import { translateText } from '../src/i18n.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const signedOut = () => ({ authenticated: false, email: null, phone: null, products: {
  'module-01': { trialUsed: true, paid: false }, 'module-02': { trialUsed: false, paid: false },
}, mailReady: true, developmentMail: true, smsReady: true, developmentSms: true });
const signedIn = () => ({ ...signedOut(), authenticated: true, email: 'person@qq.com' });

// Small DOM boundary fixture; execute the actual handlers and API wrapper.
function fixture(t, { session = signedOut(), request } = {}) {
  const all = [];
  function element(tag, attrs = {}, parent = null) {
    const handlers = new Map();
    const node = { tag, attrs, parent, dataset: {}, hidden: false, disabled: false,
      value: '', open: false, isConnected: true, textContent: '',
      addEventListener(name, fn) { handlers.set(name, [...(handlers.get(name) || []), fn]); },
      async dispatch(name, event = {}) { await Promise.all((handlers.get(name) || []).map(fn => fn({ preventDefault() {}, ...event }))); },
      setAttribute(name, value) { this.attrs[name] = value; },
      toggleAttribute(name, enabled) { if (enabled) this.attrs[name] = ''; else delete this.attrs[name]; },
      querySelectorAll(selector) {
        const descendants = all.filter(child => { for (let p = child.parent; p; p = p.parent) if (p === this) return true; return false; });
        return descendants.filter(child => selector.split(',').some(part => matches(child, part.trim())));
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      reportValidity() { return true; }, closest() { return null; },
      focus() { doc.activeElement = this; },
      reset() { this.querySelectorAll('input').forEach(input => { input.value = ''; }); },
      showModal() { this.open = true; }, close() { this.open = false; queueMicrotask(() => void this.dispatch('close')); },
    };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase())] = value;
    all.push(node);
    return node;
  }
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
  const doc = element('document'); doc.visibilityState = 'visible';
  const login = element('dialog', { 'data-login-dialog': '' }, doc);
  const close = element('button', { 'data-login-close': '', class: 'login-close' }, login);
  const form = element('form', { 'data-login-form': '' }, login);
  const email = element('input', { name: 'email' }, form);
  const phone = element('input', { name: 'phone' }, form);
  const code = element('input', { name: 'code' }, form);
  const send = element('button', { 'data-login-send-code': '' }, form);
  const channels = ['email', 'sms'].map(channel => element('button', { 'data-login-channel': channel }, form));
  element('button', { type: 'submit' }, form);
  const status = element('p', { 'data-login-status': '' }, login);
  element('button', { 'data-live-logout': '', 'data-demo-logout': '' }, login);
  const access = element('dialog', { 'data-access-dialog': '' }, doc);
  element('button', { 'data-access-close': '', class: 'login-close' }, access);
  const announcement = element('p', { 'data-access-announcement': '', role: 'status', 'aria-live': 'polite' }, doc);
  announcement.hidden = true;
  const productStatuses = ['module-01', 'module-02'].map(id => element('p', { 'data-product-status': id }, doc));
  const productErrors = ['module-01', 'module-02'].map(id => element('p', { 'data-product-error': id }, doc));
  const triggers = ['module-01', 'module-02'].map(id => element('button', { 'data-product-open': id }, doc));
  const account = element('button', { 'data-login-open': '' }, doc);
  const values = new Map(); const destinations = []; const calls = [];
  const browser = element('window');
  browser.location = { hostname: 'localhost', href: 'http://localhost:3000/intelligent', assign: url => destinations.push(url) };
  browser.sessionStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  browser.setInterval = () => 1; browser.clearInterval = () => {};
  const original = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  Object.assign(globalThis, { document: doc, window: browser, fetch: async (url, options) => {
    calls.push([url, options]);
    const result = request ? await request(url, options) : url.endsWith('/verify') ? (session = signedIn()) : url.endsWith('/enter') ? { url: url.includes('module-02') ? 'https://thesis.arvivatherap.com' : 'https://research.arvivatherap.com' } : session;
    return new Response(JSON.stringify(result?.errorBody ?? result), { status: result?.errorStatus ?? 200 });
  } });
  t.after(() => Object.assign(globalThis, original));
  return { announcement, login, close, form, email, phone, code, send, channels, status, access, triggers, account, productStatuses, productErrors, values, destinations, calls, browser };
}

test('live email login stays on the current page with a visible success notice until another product click', async t => {
  const ui = fixture(t); initializeLiveAccess(); await tick();
  await ui.triggers[0].dispatch('click'); await tick();
  assert.equal(ui.login.open, true); assert.equal(ui.access.open, false);
  ui.email.value = 'person@qq.com'; ui.code.value = '123456';
  await ui.form.dispatch('submit'); await tick();
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 0);
  assert.equal(ui.login.open, false);
  assert.equal(ui.announcement.hidden, false);
  assert.equal(ui.announcement.textContent, 'Signed in successfully. Choose a platform to continue.');
  await ui.browser.dispatch('focus'); await tick();
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 0);
  await ui.triggers[0].dispatch('click');
  assert.deepEqual(ui.destinations, ['http://localhost:3000/research-demo.html']);
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 1);
});

test('live SMS login stays on the current page and a later click opens the selected product', async t => {
  const ui = fixture(t); initializeLiveAccess(); await tick();
  await ui.triggers[1].dispatch('click'); await tick();
  await ui.channels[1].dispatch('click'); ui.phone.value = '13800138000'; ui.code.value = '123456';
  await ui.form.dispatch('submit'); await tick();
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 0);
  assert.equal(ui.login.open, false);
  assert.equal(ui.announcement.hidden, false);
  assert.equal(ui.announcement.textContent, 'Signed in successfully. Choose a platform to continue.');
  await ui.triggers[1].dispatch('click');
  assert.deepEqual(ui.destinations, ['http://localhost:3000/research-demo.html?platform=prediction']);
  assert.ok(ui.calls.some(([url]) => url === '/api/auth/sms/verify'));
  assert.ok(ui.calls.some(([url]) => url === '/api/products/module-02/enter'));
});

test('signed-in users with used unpaid trials enter directly and repeated clicks submit once', async t => {
  let finish;
  const ui = fixture(t, { request: url => url.endsWith('/enter') ? new Promise(resolve => { finish = resolve; }) : signedIn() });
  initializeLiveAccess(); await tick();
  const entering = ui.triggers[0].dispatch('click'); await ui.triggers[0].dispatch('click'); await tick();
  assert.equal(ui.login.open, false); assert.equal(ui.access.open, false);
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 1);
  finish({ url: 'https://research.arvivatherap.com' }); await entering; await tick();
  assert.equal(ui.destinations.length, 1);
});

test('expired session login stays on the current page and entry requires a second module click', async t => {
  let authenticated = true;
  let expired = true;
  const ui = fixture(t, { request: (url, options) => {
    if (url === '/api/auth/request-code') {
      assert.deepEqual(JSON.parse(options.body), { email: 'person@qq.com' });
      return { message: 'Code sent.', retryAfterSeconds: 60 };
    }
    if (url === '/api/auth/verify') {
      assert.deepEqual(JSON.parse(options.body), { email: 'person@qq.com', code: '123456' });
      authenticated = true; expired = false;
      return signedIn();
    }
    if (!url.endsWith('/enter')) return authenticated ? signedIn() : signedOut();
    if (expired) {
      authenticated = false;
      return { errorStatus: 401, errorBody: { message: 'Sign in to access this product.' } };
    }
    return { url: 'https://research.arvivatherap.com' };
  } });
  initializeLiveAccess(); await tick(); await ui.triggers[0].dispatch('click'); await tick();
  assert.equal(ui.login.open, true); assert.deepEqual(ui.destinations, []);
  assert.equal(ui.status.textContent, 'Your session expired. Please sign in to continue.');
  ui.email.value = 'person@qq.com'; await ui.send.dispatch('click'); await tick();
  ui.code.value = '123456'; await ui.form.dispatch('submit'); await tick();
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 1);
  assert.equal(ui.login.open, false);
  assert.equal(ui.announcement.hidden, false);
  assert.equal(ui.announcement.textContent, 'Signed in successfully. Choose a platform to continue.');
  await ui.browser.dispatch('focus'); await tick();
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 1);
  await ui.triggers[0].dispatch('click');
  assert.deepEqual(ui.destinations, ['http://localhost:3000/research-demo.html']);
  assert.equal(ui.login.open, false); assert.equal(ui.access.open, false);
  assert.equal(ui.calls.filter(([url]) => url === '/api/products/module-01/enter').length, 2);
  assert.equal(ui.calls.filter(([url]) => url === '/api/products/module-02/enter').length, 0);
});

test('network failure stays visible at the module and a repeated attempt can succeed', async t => {
  let fail = true;
  const ui = fixture(t, { request: url => {
    if (!url.endsWith('/enter')) return signedIn();
    if (fail) throw new TypeError('Network error');
    return { url: 'https://research.arvivatherap.com' };
  } });
  initializeLiveAccess(); await tick(); await ui.triggers[0].dispatch('click');
  assert.equal(ui.productErrors[0].textContent, 'Unable to reach the server. Please try again.');
  assert.equal(ui.productErrors[0].hidden, false);
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.triggers[0].disabled, false);
  fail = false; await ui.triggers[0].dispatch('click');
  assert.equal(ui.destinations.length, 1);
});

test('leaving the page while an explicitly clicked product entry is pending suppresses late navigation', async t => {
  let finish;
  const ui = fixture(t, { request: url => url.endsWith('/enter') ? new Promise(resolve => { finish = resolve; }) : signedIn() });
  initializeLiveAccess(); await tick();
  const entering = ui.triggers[0].dispatch('click'); await tick();
  await ui.browser.dispatch('pagehide'); finish({ url: 'https://research.arvivatherap.com' });
  await entering; await tick();
  assert.deepEqual(ui.destinations, []);
});

test('cancelled login verification may update account state but never resumes the cancelled product', async t => {
  let finish;
  const ui = fixture(t, { request: url => url.endsWith('/verify') ? new Promise(resolve => { finish = resolve; }) : signedOut() });
  initializeLiveAccess(); await tick(); await ui.triggers[0].dispatch('click'); await tick();
  ui.email.value = 'person@qq.com'; ui.code.value = '123456';
  const verifying = ui.form.dispatch('submit'); await tick();
  await ui.close.dispatch('click'); finish(signedIn()); await verifying; await tick();
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 0);
  assert.equal(ui.announcement.hidden, true);
});

test('static preview login stays on the current page with visible success and later clicks enter without changing trials', async t => {
  const ui = fixture(t); initializeAccess();
  await ui.triggers[0].dispatch('click');
  assert.equal(ui.login.open, true); assert.equal(ui.access.open, false);
  ui.email.value = 'person@qq.com'; await ui.send.dispatch('click'); ui.code.value = '123456';
  await ui.form.dispatch('submit');
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.login.open, false);
  assert.equal(ui.announcement.hidden, false);
  assert.equal(ui.announcement.textContent, 'Signed in successfully. Choose a platform to continue.');
  await ui.triggers[0].dispatch('click');
  assert.deepEqual(ui.destinations, ['http://localhost:3000/research-demo.html']);
  const stored = JSON.parse(ui.values.get('arviva-access-preview-v1'));
  assert.deepEqual(stored.products['module-01'], { trialUsed: false, paid: false });
  await ui.triggers[1].dispatch('click');
  assert.deepEqual(ui.destinations, ['http://localhost:3000/research-demo.html', 'http://localhost:3000/research-demo.html?platform=prediction']);
  assert.equal(ui.access.open, false);
});

test('static preview preserves old used unpaid trials and never shows purchase options', async t => {
  const ui = fixture(t);
  const history = { version: 1, signedIn: true, products: signedIn().products };
  ui.values.set('arviva-access-preview-v1', JSON.stringify(history));
  initializeAccess(); await ui.triggers[0].dispatch('click'); await ui.triggers[1].dispatch('click');
  assert.equal(ui.login.open, false); assert.equal(ui.access.open, false);
  assert.deepEqual(JSON.parse(ui.values.get('arviva-access-preview-v1')), history);
  assert.deepEqual(ui.destinations, ['http://localhost:3000/research-demo.html', 'http://localhost:3000/research-demo.html?platform=prediction']);
});

test('cancelling static login clears the selected product before account sign-in', async t => {
  const ui = fixture(t); initializeAccess();
  await ui.triggers[0].dispatch('click'); await ui.close.dispatch('click'); await tick();
  await ui.account.dispatch('click'); ui.email.value = 'person@qq.com';
  await ui.send.dispatch('click'); ui.code.value = '123456'; await ui.form.dispatch('submit');
  assert.deepEqual(ui.destinations, []);
});

test('success status markup is visible, hidden when empty and translated without alerts', () => {
  const html = renderAccessDialogs();
  const status = html.match(/<p[^>]*data-access-announcement[^>]*>/)?.[0];
  assert.ok(status);
  assert.doesNotMatch(status, /sr-only/);
  assert.match(status, / hidden/);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
  assert.equal(translateText('Signed in successfully. Choose a platform to continue.', 'zh-CN'), '登录成功，请选择功能模块继续。');
});
