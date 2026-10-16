import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLiveAccess } from '../src/access-live.js';
import { initializeAccess } from '../src/access.js';
import { renderAccessAnnouncement, renderAccessDialogs } from '../src/access-view.mjs';
import { translateText } from '../src/i18n.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const signedOut = () => ({ authenticated: false, email: null, phone: null, products: {
  'module-01': { trialUsed: true, paid: false }, 'module-02': { trialUsed: false, paid: false },
}, mailReady: true, developmentMail: true, smsReady: true, developmentSms: true, profileComplete: null });
const signedIn = () => ({ ...signedOut(), authenticated: true, email: 'person@qq.com' });

// Small DOM boundary fixture; execute the actual handlers and API wrapper.
function fixture(t, { session = signedOut(), request, accountMenu = false } = {}) {
  const all = [];
  function element(tag, attrs = {}, parent = null) {
    const handlers = new Map();
    const node = { tag, attrs, parent, dataset: {}, hidden: false, disabled: false,
      value: '', open: false, isConnected: true, textContent: '',
      addEventListener(name, fn) { handlers.set(name, [...(handlers.get(name) || []), fn]); },
      async dispatch(name, event = {}) { await Promise.all((handlers.get(name) || []).map(fn => fn({ preventDefault() {}, ...event }))); },
      setAttribute(name, value) { this.attrs[name] = value; },
      getAttribute(name) { return this.attrs[name] ?? null; },
      removeAttribute(name) { delete this.attrs[name]; },
      contains(child) { for (let p = child; p; p = p.parent) if (p === this) return true; return false; },
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
  const accountRoot = accountMenu ? element('div', { 'data-account-menu-root': '' }, doc) : doc;
  const account = element('button', { 'data-login-open': '', ...(accountMenu ? {'data-account-trigger': ''} : {}) }, accountRoot);
  let menu, menuLogout, menuProfile, menuStatus;
  if (accountMenu) {
    menu = element('div', { 'data-account-menu': '', id: 'account-menu' }, accountRoot); menu.hidden = true;
    menuProfile = element('a', { 'data-account-profile': '', href: '/profile', role: 'menuitem' }, menu);
    menuLogout = element('button', { 'data-account-logout': '', role: 'menuitem' }, menu);
    menuStatus = element('p', { 'data-account-status': '' }, menu); menuStatus.hidden = true;
  }
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
  return { root: doc, announcement, login, close, form, email, phone, code, send, channels, status, access, triggers, account, menu, menuLogout, menuProfile, menuStatus, productStatuses, productErrors, values, destinations, calls, browser };
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
  assert.equal(ui.announcement.textContent, '');
  assert.equal(ui.announcement.hidden, true);
  await ui.browser.dispatch('pagehide');
  await ui.browser.dispatch('pageshow', { persisted: true }); await tick();
  assert.equal(ui.announcement.textContent, '');
  assert.equal(ui.announcement.hidden, true);
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
  assert.equal(ui.announcement.textContent, '');
  assert.equal(ui.announcement.hidden, true);
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
  assert.equal(ui.announcement.textContent, 'Unable to reach the server. Please try again.');
  assert.equal(ui.announcement.hidden, false);
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
  assert.equal(ui.announcement.textContent, 'Opening your product…');
  assert.equal(ui.announcement.hidden, false);
  await ui.browser.dispatch('pagehide');
  const hiddenAfterPagehide = ui.announcement.hidden;
  const textAfterPagehide = ui.announcement.textContent;
  finish({ url: 'https://research.arvivatherap.com' });
  await entering; await tick();
  assert.equal(textAfterPagehide, '');
  assert.equal(hiddenAfterPagehide, true);
  await ui.browser.dispatch('pageshow', { persisted: true }); await tick();
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.announcement.textContent, '');
  assert.equal(ui.announcement.hidden, true);
});

test('restoring a cached live page clears its saved transient notification', async t => {
  const ui = fixture(t); initializeLiveAccess(); await tick();
  await ui.account.dispatch('click'); await tick();
  ui.email.value = 'person@qq.com'; ui.code.value = '123456';
  await ui.form.dispatch('submit'); await tick();
  assert.equal(ui.announcement.textContent, 'Signed in successfully. Choose a platform to continue.');
  assert.equal(ui.announcement.hidden, false);
  await ui.browser.dispatch('pageshow', { persisted: false }); await tick();
  assert.equal(ui.announcement.textContent, 'Signed in successfully. Choose a platform to continue.');
  assert.equal(ui.announcement.hidden, false);
  await ui.browser.dispatch('pageshow', { persisted: true }); await tick();
  assert.equal(ui.announcement.textContent, '');
  assert.equal(ui.announcement.hidden, true);
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
  const html = renderAccessAnnouncement();
  const status = html.match(/<p[^>]*data-access-announcement[^>]*>/)?.[0];
  assert.ok(status);
  assert.doesNotMatch(status, /sr-only/);
  assert.match(status, / hidden/);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
  assert.equal(translateText('Signed in successfully. Choose a platform to continue.', 'zh-CN'), '登录成功，请选择功能模块继续。');
});

for (const profileComplete of [false, true]) {
  test(`live profile hooks receive ${profileComplete ? 'complete' : 'incomplete'} email sessions after login without navigating`, async t => {
    let current = signedOut();
    const ui = fixture(t, { request: url => {
      if (url.endsWith('/verify')) current = { ...signedIn(), profileComplete };
      return current;
    } });
    const sessions = []; const signIns = [];
    initializeLiveAccess(undefined, {
      onSession(session) {
        sessions.push(session);
        assert.equal(ui.form.hidden, Boolean(session?.authenticated), 'login is rendered before the session hook');
      },
      onSignIn(session) {
        signIns.push(session);
        assert.equal(ui.login.open, false, 'login closes before the profile prompt can open');
        assert.equal(ui.announcement.hidden, false, 'success notice is shown before the profile prompt');
      },
    });
    await tick();
    assert.equal(sessions[0], null);
    assert.deepEqual(sessions.at(-1), signedOut());
    await ui.triggers[0].dispatch('click'); await tick();
    ui.email.value = 'person@qq.com'; ui.code.value = '123456';
    await ui.form.dispatch('submit'); await tick();
    assert.deepEqual(signIns, [{ ...signedIn(), profileComplete }]);
    assert.deepEqual(sessions.at(-1), { ...signedIn(), profileComplete });
    assert.deepEqual(ui.destinations, []);
    assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 0);
    await ui.browser.dispatch('focus'); await tick();
    assert.equal(signIns.length, 1, 'session refresh does not trigger another login prompt');
  });
}

test('a failed live session refresh clears the profile session hook', async t => {
  let fail = false;
  const ui = fixture(t, { request: () => {
    if (fail) throw new TypeError('Network error');
    return { ...signedIn(), profileComplete: true };
  } });
  const sessions = []; const states = [];
  initializeLiveAccess(undefined, { onSession: (session, state) => {sessions.push(session);states.push(state);} }); await tick();
  assert.deepEqual(states[0], {loading:true});
  assert.deepEqual(states.at(-1), {loading:false});
  assert.equal(sessions.at(-1)?.profileComplete, true);
  fail = true; await ui.browser.dispatch('focus'); await tick();
  assert.equal(sessions.at(-1), null);
  assert.deepEqual(states.at(-1), {loading:false}, 'network failures are not presented as initial loading');
  assert.equal(ui.form.hidden, false);
});

test('cancelled live verification updates profile session state without opening a completion prompt', async t => {
  let finish;
  const ui = fixture(t, { request: url => url.endsWith('/verify') ? new Promise(resolve => { finish = resolve; }) : signedOut() });
  const sessions = []; const signIns = [];
  initializeLiveAccess(undefined, { onSession: session => sessions.push(session), onSignIn: session => signIns.push(session) });
  await tick(); await ui.triggers[0].dispatch('click'); await tick();
  ui.email.value = 'person@qq.com'; ui.code.value = '123456';
  const verifying = ui.form.dispatch('submit'); await tick();
  await ui.close.dispatch('click'); finish({ ...signedIn(), profileComplete: false }); await verifying; await tick();
  assert.ok(sessions.some(session => session?.authenticated && session.profileComplete === false));
  assert.deepEqual(signIns, []);
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.announcement.hidden, true);
});

test('SMS sign-in passes its phone session without adding profile state or automatic navigation', async t => {
  const phoneSession = { ...signedIn(), email: null, phone: '+8613800138000', profileComplete: null };
  let current = signedOut();
  const ui = fixture(t, { request: url => {
    if (url === '/api/auth/sms/verify') current = phoneSession;
    return current;
  } });
  const signIns = [];
  initializeLiveAccess(undefined, { onSignIn: session => signIns.push(session) }); await tick();
  await ui.triggers[1].dispatch('click'); await tick();
  await ui.channels[1].dispatch('click'); ui.phone.value = '13800138000'; ui.code.value = '123456';
  await ui.form.dispatch('submit'); await tick();
  assert.deepEqual(signIns, [phoneSession]);
  assert.deepEqual(ui.destinations, []);
  assert.equal(ui.calls.filter(([url]) => url.endsWith('/enter')).length, 0);
});

test('an expired product session clears profile completion for the now anonymous account', async t => {
  const ui = fixture(t, { request: url => url.endsWith('/enter')
    ? { errorStatus: 401, errorBody: { message: 'Sign in required.' } }
    : { ...signedIn(), profileComplete: true } });
  const sessions = [];
  initializeLiveAccess(undefined, { onSession: session => sessions.push(session) }); await tick();
  await ui.triggers[0].dispatch('click'); await tick();
  assert.equal(sessions.at(-1)?.authenticated, false);
  assert.equal(sessions.at(-1)?.profileComplete, null);
});

test('preview profile hooks capture the normalized login email without changing the access storage shape', async t => {
  const ui = fixture(t);
  const sessions = []; const signIns = [];
  initializeAccess(undefined, {
    onSession(session) {
      sessions.push(session);
      assert.equal(ui.form.hidden, session.authenticated);
    },
    onSignIn(session) {
      signIns.push(session);
      assert.equal(ui.login.open, false);
      assert.equal(ui.email.value, '', 'email is captured before dismissing and clearing the login form');
      assert.equal(ui.announcement.hidden, false);
    },
  });
  assert.deepEqual(sessions, [{ authenticated: false }]);
  await ui.triggers[0].dispatch('click');
  ui.email.value = ' Person@QQ.COM '; await ui.send.dispatch('click'); ui.code.value = '123456';
  await ui.form.dispatch('submit');
  assert.deepEqual(signIns, [{ authenticated: true, email: 'person@qq.com', profileComplete: false }]);
  assert.deepEqual(sessions.at(-1), { authenticated: true });
  assert.deepEqual(ui.destinations, []);
  assert.deepEqual([...ui.values.keys()], ['arviva-access-preview-v1']);
  assert.deepEqual(Object.keys(JSON.parse(ui.values.get('arviva-access-preview-v1'))).sort(), ['products', 'signedIn', 'version']);
  await ui.login.querySelector('[data-demo-logout]').dispatch('click');
  assert.deepEqual(sessions.at(-1), { authenticated: false });
  assert.equal(signIns.length, 1);
});

test('signed-in account markup includes a hidden profile link and retains logout', () => {
  const html = renderAccessDialogs();
  assert.match(html, /data-login-session[^>]*>[\s\S]*<a[^>]*href="\/profile"[^>]*data-profile-link[^>]*hidden[^>]*>Personal profile<\/a>/);
  assert.match(html, /data-demo-logout data-live-logout>Log out<\/button>/);
});

test('signed-in header avatar opens the live account dropdown, not the login dialog', async t => {
  const ui = fixture(t, { session: signedIn(), accountMenu: true });
  initializeLiveAccess(); await tick();
  await ui.account.dispatch('click'); await tick();
  assert.equal(ui.menu.hidden, false);
  assert.equal(ui.login.open, false);
  assert.equal(ui.account.getAttribute('aria-expanded'), 'true');
  assert.equal(ui.account.getAttribute('aria-controls'), 'account-menu');
  assert.equal(ui.menuProfile.getAttribute('href'), '/profile');
  await ui.account.dispatch('click');
  assert.equal(ui.menu.hidden, true);
  assert.deepEqual(ui.destinations, []);
});

test('signed-out header avatar retains email login and its profile reminder hook', async t => {
  const ui = fixture(t, { accountMenu: true }); const signIns = [];
  initializeLiveAccess(undefined, { onSignIn: session => signIns.push(session) }); await tick();
  await ui.account.dispatch('click'); await tick();
  assert.equal(ui.menu.hidden, true); assert.equal(ui.login.open, true);
  assert.equal(ui.account.getAttribute('aria-haspopup'), 'dialog');
  ui.email.value = 'person@qq.com'; ui.code.value = '123456';
  await ui.form.dispatch('submit'); await tick();
  assert.equal(signIns.length, 1);
  assert.equal(ui.login.open, false);
  assert.equal(ui.menu.hidden, true, 'successful sign-in does not automatically open the account dropdown');
});

test('phone accounts retain the dropdown profile entry', async t => {
  const ui = fixture(t, { accountMenu: true, session: {...signedIn(), email:null, phone:'+8613800138000'} });
  initializeLiveAccess(); await tick(); await ui.account.dispatch('click');
  assert.equal(ui.menu.hidden, false);
  assert.equal(ui.menuProfile.hidden, false);
  assert.equal(ui.login.open, false);
});

test('live dropdown logout is single-flight and updates the account without opening a modal', async t => {
  let current = signedIn(); let finish;
  const ui = fixture(t, { accountMenu: true, request: url => {
    if (url === '/api/auth/logout') return new Promise(resolve => { finish = () => {current = signedOut();resolve({ok:true});}; });
    return current;
  } });
  initializeLiveAccess(); await tick(); await ui.account.dispatch('click');
  const logout = ui.menuLogout.dispatch('click'); await tick();
  assert.equal(ui.menuLogout.disabled, true);
  await ui.menuLogout.dispatch('click');
  assert.equal(ui.calls.filter(([url]) => url === '/api/auth/logout').length, 1);
  finish(); await logout; await tick();
  assert.equal(ui.menu.hidden, true); assert.equal(ui.login.open, false);
  assert.equal(ui.account.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(ui.announcement.textContent, 'You have been logged out.');
  assert.equal(ui.root.activeElement, ui.account, 'successful logout restores focus after the session refresh enables the avatar');
  await ui.account.dispatch('click'); await tick();
  assert.equal(ui.login.open, true);
});

test('failed dropdown logout keeps the account signed in and displays an actionable error', async t => {
  const ui = fixture(t, { accountMenu: true, request: url => {
    if (url === '/api/auth/logout') throw new TypeError('Network error');
    return signedIn();
  } });
  initializeLiveAccess(); await tick(); await ui.account.dispatch('click');
  await ui.menuLogout.dispatch('click'); await tick();
  assert.equal(ui.menu.hidden, false); assert.equal(ui.login.open, false);
  assert.equal(ui.menuLogout.disabled, false);
  assert.equal(ui.menuStatus.hidden, false);
  assert.equal(ui.menuStatus.textContent, 'Unable to reach the server. Please try again.');
});

test('preview header dropdown logs out while preserving product history and returning to ordinary login', async t => {
  const ui = fixture(t, { accountMenu: true });
  const history = {version:1,signedIn:true,products:signedIn().products};
  ui.values.set('arviva-access-preview-v1', JSON.stringify(history));
  initializeAccess(); await ui.account.dispatch('click');
  assert.equal(ui.menu.hidden, false); assert.equal(ui.login.open, false);
  await ui.menuLogout.dispatch('click');
  assert.equal(ui.menu.hidden, true);
  assert.deepEqual(JSON.parse(ui.values.get('arviva-access-preview-v1')), {...history,signedIn:false});
  await ui.account.dispatch('click'); assert.equal(ui.login.open, true);
});
