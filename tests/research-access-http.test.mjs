import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';

test('research access API and workspace enforce the server session, methods, origin and aliases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'arviva-research-http-'));
  let server, trialCalls = 0, unavailable = false;
  const serverNow = '2026-10-19T12:00:00.000Z';
  const states = {
    signedOut: { authenticated: false, access: 'signed-out', trialExpiresAt: null, serverNow },
    unused: { authenticated: true, access: 'trial-available', trialExpiresAt: null, serverNow },
    used: { authenticated: true, access: 'trial-used', trialExpiresAt: null, serverNow },
    paid: { authenticated: true, access: 'paid', trialExpiresAt: null, serverNow },
    trial: { authenticated: true, access: 'trial', trialExpiresAt: '2026-10-19T12:15:00.000Z', serverNow },
  };
  const auth = {
    getResearchAccess: async token => { if (unavailable) throw new Error('database unavailable'); return states[token] ?? states.signedOut; },
    startResearchTrial: async token => {
      trialCalls++;
      if (token !== 'unused') throw Object.assign(new Error('Sign in first.'), { status: 401, code: 'AUTH_REQUIRED' });
      return { ...states.trial, url: '/research-workspace' };
    },
  };
  try {
    await mkdir(path.join(root, 'research-workspace'));
    await writeFile(path.join(root, 'research-workspace', 'index.html'), 'AUTHORIZED RESEARCH PREVIEW');
    await symlink(path.join(root, 'research-workspace'), path.join(root, 'workspace-alias'), 'junction');
    await writeFile(path.join(root, 'index.html'), 'PUBLIC');
    const config = { origin: 'http://127.0.0.1', secureCookies: false, trustProxy: false };
    server = createApp({ config, auth, mailer: { ready: false, development: false }, root });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    config.origin = base;
    const post = (headers = {}, body = '{}') => fetch(base + '/api/research/trial', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: 'arviva_session=unused', ...headers }, body });
    for (const [token, state] of Object.entries(states)) {
      const response = await fetch(base + '/api/research/access', { headers: { Cookie: `arviva_session=${token}` } });
      assert.equal(response.status, 200, 'access state endpoint must exist');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), state);
    }
    assert.equal(trialCalls, 0, 'GET access never consumes a trial');
    assert.equal((await fetch(base + '/api/research/access', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/api/research/trial')).status, 405);
    assert.equal((await post({ Origin: 'https://research.arvivatherap.com' })).status, 403);
    assert.equal((await post({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post({ 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post({}, '[]')).status, 400);
    assert.equal((await post({}, JSON.stringify({ data: 'x'.repeat(5000) }))).status, 413);
    assert.equal(trialCalls, 0, 'invalid requests never invoke the trial mutation');
    assert.deepEqual(await (await post()).json(), { ...states.trial, url: '/research-workspace' });
    assert.equal((await post({ Cookie: '' })).status, 401);

    const aliases = ['/research-workspace', '/research-workspace/', '/research-workspace/index.html', '/RESEARCH-WORKSPACE/INDEX.HTML', '/research%2dworkspace/index.html', '//research-workspace//index.html', '/workspace-alias', '/workspace-alias/index.html'];
    for (const route of aliases) for (const token of ['signedOut', 'unused', 'used']) for (const method of ['GET', 'HEAD']) {
      const response = await fetch(base + route, { method, redirect: 'manual', headers: { Cookie: `arviva_session=${token}` } });
      assert.equal(response.status, 302, `${method} ${route} ${token}`);
      assert.equal(response.headers.get('location'), '/research-access');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const token of ['trial', 'paid']) for (const route of ['/research-workspace', '/research-workspace/index.html', '/workspace-alias']) {
      const response = await fetch(base + route, { headers: { Cookie: `arviva_session=${token}` } });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'AUTHORIZED RESEARCH PREVIEW');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const head = await fetch(base + '/research-workspace', { method: 'HEAD', headers: { Cookie: 'arviva_session=paid' } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(base + '/research-workspace', { method: 'POST', redirect: 'manual' })).status, 405);
    unavailable = true;
    assert.equal((await fetch(base + '/api/research/access')).status, 503);
    assert.equal((await fetch(base + '/research-workspace', { redirect: 'manual' })).status, 503);
    assert.equal((await fetch(base + '/workspace-alias', { redirect: 'manual' })).status, 503);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(root, { recursive: true, force: true });
  }
});

test('only the fixed research entry document permits the research parent to frame it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'arviva-research-frame-'));
  let server;
  const auth = {
    getResearchAccess: async () => ({ authenticated: false, access: 'signed-out' }),
    verifyCode: async () => ({ token: 'test-session', email: 'test@example.com', profileComplete: false, products: [] }),
  };
  try {
    await mkdir(path.join(root, 'research-entry'));
    await writeFile(path.join(root, 'research-entry', 'index.html'), 'RESEARCH ENTRY');
    await writeFile(path.join(root, 'research-entry', 'other.html'), 'OTHER DOCUMENT');
    await symlink(path.join(root, 'research-entry'), path.join(root, 'entry-alias'), 'junction');
    await mkdir(path.join(root, 'research-access'));
    await writeFile(path.join(root, 'research-access', 'index.html'), 'RESEARCH ACCESS');
    await writeFile(path.join(root, 'index.html'), 'PUBLIC');
    const config = { origin: 'http://127.0.0.1', secureCookies: true, trustProxy: false };
    server = createApp({ config, auth, mailer: { ready: false, development: false }, root });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    config.origin = base;
    const parent = 'https://research.arvivatherap.com';
    const framePolicy = "frame-ancestors 'self' https://research.arvivatherap.com";

    for (const route of ['/research-entry', '/research-entry/', '/research-entry/index.html']) {
      for (const method of ['GET', 'HEAD']) for (const origin of [parent, 'https://untrusted.example']) {
        const response = await fetch(base + route + '?origin=https://untrusted.example&parentOrigin=*', { method, headers: { Origin: origin } });
        assert.equal(response.status, 200, `${method} ${route}`);
        assert.equal(response.headers.get('content-security-policy'), framePolicy, 'frame ancestors must be fixed, independent of request origin and query');
        assert.equal(response.headers.get('x-frame-options'), null, 'DENY must not override the explicit CSP frame policy');
        assert.equal(response.headers.get('access-control-allow-origin'), null, 'framing does not grant cross-origin API access');
        assert.equal(response.headers.get('set-cookie'), null);
      }
    }

    const deniedRoutes = ['/', '/research-access', '/research-workspace', '/api/research/access', '/runtime-config.js', '/missing', '/research-entry/other.html', '/entry-alias', '/entry-alias/index.html', '/RESEARCH-ENTRY', '/research%2dentry', '//research-entry//index.html', '/research-entry/index.html/'];
    for (const route of deniedRoutes) {
      const response = await fetch(base + route + '?origin=' + encodeURIComponent(parent), { redirect: 'manual', headers: { Origin: parent } });
      assert.equal(response.headers.get('x-frame-options'), 'DENY', route);
      assert.equal(response.headers.get('content-security-policy'), null, route);
      assert.equal(response.headers.get('access-control-allow-origin'), null, route);
    }
    const wrongMethod = await fetch(base + '/research-entry', { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('x-frame-options'), 'DENY');
    assert.equal(wrongMethod.headers.get('content-security-policy'), null);

    const verify = origin => fetch(base + '/api/auth/verify', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@example.com', code: '000000' }) });
    const crossOrigin = await verify(parent);
    assert.equal(crossOrigin.status, 403, 'research parent still cannot call auth mutation directly');
    assert.equal(crossOrigin.headers.get('x-frame-options'), 'DENY');
    assert.equal(crossOrigin.headers.get('access-control-allow-origin'), null);
    assert.equal(crossOrigin.headers.get('set-cookie'), null);
    const sameOrigin = await verify(base);
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.headers.get('x-frame-options'), 'DENY');
    assert.equal(sameOrigin.headers.get('set-cookie'), 'arviva_session=test-session; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure', 'session remains host-only with the existing SameSite setting');

    // An allowed URL must not relax headers when it resolves to a different document.
    await rm(path.join(root, 'research-entry'), { recursive: true, force: true });
    await symlink(path.join(root, 'research-access'), path.join(root, 'research-entry'), 'junction');
    const changedTarget = await fetch(base + '/research-entry');
    assert.equal(changedTarget.status, 200);
    assert.equal(await changedTarget.text(), 'RESEARCH ACCESS');
    assert.equal(changedTarget.headers.get('x-frame-options'), 'DENY');
    assert.equal(changedTarget.headers.get('content-security-policy'), null);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(root, { recursive: true, force: true });
  }
});
