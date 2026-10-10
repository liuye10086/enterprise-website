import assert from 'node:assert/strict';
import test from 'node:test';
import * as live from '../src/access-live.js';

const serverSession = () => ({
  authenticated: true,
  email: 'person@example.com',
  products: {
    'module-01': { trialUsed: false, paid: false },
    'module-02': { trialUsed: true, paid: true },
  },
  mailReady: true,
  developmentMail: false,
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
