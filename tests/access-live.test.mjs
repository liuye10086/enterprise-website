import assert from 'node:assert/strict';
import test from 'node:test';
import * as live from '../src/access-live.js';

const serverSession = () => ({
  authenticated: true,
  email: 'person@example.com',
  phone: null,
  products: {
    'module-01': { trialUsed: false, paid: false },
    'module-02': { trialUsed: true, paid: true },
  },
  mailReady: true,
  developmentMail: false,
  smsReady: true,
  developmentSms: false,
});

test('phone sessions preserve product access and display only a masked phone number', () => {
  const session = { ...serverSession(), email: null, phone: '+8613800138000' };
  assert.deepEqual(live.readLiveSession(session), session);
  assert.equal(live.liveAccountLabel(session), '138****8000');
  assert.equal(live.liveAccountLabel(serverSession()), 'person@example.com');
});

test('sessions accept legacy email metadata but reject ambiguous or missing identities', () => {
  const legacy = serverSession();
  delete legacy.phone;
  delete legacy.smsReady;
  delete legacy.developmentSms;
  assert.deepEqual(live.readLiveSession(legacy), { ...legacy, phone: null, smsReady: false, developmentSms: false });
  for (const changes of [
    { email: null, phone: null }, { phone: '+8613800138000' }, { email: null, phone: '13800138000' },
    { email: null, phone: '+12125550100' }, { email: 'not-an-email' }, { smsReady: 'true' },
    { developmentSms: 'true' }, { authenticated: false, phone: '+8613800138000', email: null },
  ]) assert.throws(() => live.readLiveSession({ ...serverSession(), ...changes }), /session/i);
});

test('login target normalization accepts mainland mobile numbers and QQ or other email providers', () => {
  assert.equal(live.normalizeLoginTarget('sms', '13800138000'), '+8613800138000');
  assert.equal(live.normalizeLoginTarget('sms', ' 13800138000 '), '+8613800138000');
  assert.equal(live.normalizeLoginTarget('email', ' Person@QQ.COM '), 'person@qq.com');
  assert.equal(live.normalizeLoginTarget('email', 'Person@example.com'), 'person@example.com');
  for (const value of ['', '123', '12800138000', '+8613800138000', '138 0013 8000', '138001380000']) {
    assert.equal(live.normalizeLoginTarget('sms', value), '');
  }
});

test('resend delays follow the channel and normalized destination after switching or resetting', () => {
  let now = 1000;
  const login = live.createLoginFlow({ now: () => now });
  login.setTarget('email', 'Person@QQ.COM');
  login.delayResend(login.attempt(), 60);
  assert.equal(login.remainingSeconds(), 60);
  login.setTarget('sms', '13800138000');
  assert.equal(login.remainingSeconds(), 0);
  login.delayResend(login.attempt(), 42);
  login.setTarget('sms', '13900139000');
  assert.equal(login.remainingSeconds(), 0);
  login.setTarget('sms', '13800138000');
  assert.equal(login.remainingSeconds(), 42);
  login.reset();
  login.setTarget('email', ' person@qq.com ');
  assert.equal(login.remainingSeconds(), 60);
  now += 60500;
  assert.equal(login.remainingSeconds(), 0);
});

test('a response for a changed target or channel stays stale even after switching back', () => {
  const login = live.createLoginFlow();
  login.setTarget('sms', '13800138000');
  const first = login.attempt();
  assert.equal(first.destination, '+8613800138000');
  assert.equal(login.isCurrent(first), true);
  login.setTarget('sms', '13900139000');
  assert.equal(login.isCurrent(first), false);
  login.setTarget('sms', '13800138000');
  assert.equal(login.isCurrent(first), false);
  const second = login.attempt();
  login.setTarget('email', 'person@qq.com');
  assert.equal(login.isCurrent(second), false);
  const third = login.attempt();
  login.reset();
  assert.equal(login.isCurrent(third), false);
});

test('live access accepts complete server sessions and never fills in missing eligibility', () => {
  assert.equal(typeof live.readLiveSession, 'function');
  const session = serverSession();
  assert.deepEqual(live.readLiveSession(session), session);
  for (const invalid of [null, {}, { ...session, authenticated: 'true' }, { ...session, email: null },
    { ...session, products: {} }, { ...session, mailReady: undefined }]) {
    assert.throws(() => live.readLiveSession(invalid), /session/i);
  }
});

test('JSON API requests include cookies and POST the supplied body without granting client access', async () => {
  assert.equal(typeof live.requestAccessApi, 'function');
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ message: 'Code sent.', retryAfterSeconds: 60 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await live.requestAccessApi('/api/session', { fetcher });
  await live.requestAccessApi('/api/auth/request-code', { method: 'POST', body: { email: 'person@example.com' }, fetcher });
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), { email: 'person@example.com' });
});

test('API failures preserve the server message, status and resend delay', async () => {
  assert.equal(typeof live.requestAccessApi, 'function');
  await assert.rejects(live.requestAccessApi('/api/auth/request-code', {
    method: 'POST', body: {},
    fetcher: async () => new Response(JSON.stringify({ error: 'rate_limited', message: 'Please wait before trying again.' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '42' },
    }),
  }), error => error.status === 429 && error.retryAfterSeconds === 42 && error.message === 'Please wait before trying again.');
});

test('SMS API failures read the retryAfter response field', async () => {
  await assert.rejects(live.requestAccessApi('/api/auth/sms/request-code', {
    method: 'POST', body: { phone: '+8613800138000' },
    fetcher: async () => new Response(JSON.stringify({ message: 'Please wait.', retryAfter: 35 }), { status: 429 }),
  }), error => error.status === 429 && error.retryAfterSeconds === 35);
});

test('product destinations must match the requested platform on the current origin', () => {
  assert.equal(typeof live.validateProductUrl, 'function');
  const base = 'http://localhost:3000/kyfw';
  assert.equal(live.validateProductUrl('/research-platform', base, 'module-01'), 'http://localhost:3000/research-platform');
  for (const unsafe of ['https://example.com/research-platform', '//example.com/research-platform', 'javascript:alert(1)', '/prediction-platform', '/api/session']) {
    assert.throws(() => live.validateProductUrl(unsafe, base, 'module-01'));
  }
});

function productTab() {
  return {
    opener: {}, closed: false, destination: null,
    close() { this.closed = true; },
    location: { replace(url) { this.url = url; } },
  };
}

test('blocked popups do not submit a request that could consume the trial', async () => {
  assert.equal(typeof live.openLiveProduct, 'function');
  let requestCount = 0;
  await assert.rejects(live.openLiveProduct({
    productId: 'module-01', baseUrl: 'http://localhost:3000/kyfw',
    openWindow: () => null, request: async () => { requestCount += 1; },
  }), /pop-ups/i);
  assert.equal(requestCount, 0);
});

test('the blank tab opens synchronously before the server grants product access', async () => {
  assert.equal(typeof live.openLiveProduct, 'function');
  const target = productTab();
  const events = [];
  let finishRequest;
  const entering = live.openLiveProduct({
    productId: 'module-01', baseUrl: 'http://localhost:3000/kyfw',
    openWindow: (url, where) => { events.push([url, where]); return target; },
    request: (path, options) => {
      events.push([path, options]);
      return new Promise(resolve => { finishRequest = resolve; });
    },
  });
  assert.deepEqual(events[0], ['about:blank', '_blank']);
  assert.equal(events[1][0], '/api/products/module-01/enter');
  assert.equal(events[1][1].method, 'POST');
  assert.equal(target.opener, null);
  assert.equal(target.location.url, undefined);
  finishRequest({ url: '/research-platform' });
  assert.equal(await entering, true);
  assert.equal(target.location.url, 'http://localhost:3000/research-platform');
});

test('a late response after the flow closes never navigates its blank tab', async () => {
  assert.equal(typeof live.openLiveProduct, 'function');
  const target = productTab();
  let active = true;
  let finishRequest;
  const entering = live.openLiveProduct({
    productId: 'module-01', baseUrl: 'http://localhost:3000/kyfw',
    openWindow: () => target, isCurrent: () => active,
    request: () => new Promise(resolve => { finishRequest = resolve; }),
  });
  active = false;
  finishRequest({ url: '/research-platform' });
  assert.equal(await entering, false);
  assert.equal(target.closed, true);
  assert.equal(target.location.url, undefined);
});

test('server rejection and an unsafe destination close the preopened tab', async () => {
  assert.equal(typeof live.openLiveProduct, 'function');
  for (const request of [async () => { throw new Error('Trial used.'); }, async () => ({ url: 'https://example.com/' })]) {
    const target = productTab();
    await assert.rejects(live.openLiveProduct({
      productId: 'module-01', baseUrl: 'http://localhost:3000/kyfw', openWindow: () => target, request,
    }));
    assert.equal(target.closed, true);
    assert.equal(target.location.url, undefined);
  }
});
