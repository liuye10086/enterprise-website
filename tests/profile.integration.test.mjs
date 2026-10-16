import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrate } from '../scripts/migrate.mjs';
import { createAuthService } from '../server/auth-service.mjs';
import { createApp } from '../server/app.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = databaseUrl ? false : 'TEST_DATABASE_URL is required for profile integration tests.';

test('customer profiles use authenticated ownership and preserve login identities', { skip }, async t => {
  const { Pool } = await import('pg');
  const schema = `arviva_profile_test_${randomBytes(12).toString('hex')}`;
  assert.match(schema, /^arviva_profile_test_[a-f0-9]{24}$/);
  const admin = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const root = await mkdtemp(path.join(os.tmpdir(), 'arviva-profile-http-'));
  let pool, server;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 5 });
    await migrate(pool);
    let now = Date.UTC(2026, 9, 16, 8, 0, 0);
    let sequence = 0;
    const emailDeliveries = [], smsDeliveries = [];
    const auth = createAuthService({
      pool, secret: 'profile-integration-secret-at-least-32-characters', now: () => now,
      sendCode: async delivery => { emailDeliveries.push(delivery); },
      sendSmsCode: async delivery => { smsDeliveries.push(delivery); },
    });
    const login = async () => {
      const email = `profile-${++sequence}@example.com`;
      const ip = `198.51.100.${sequence}`;
      await auth.requestCode(email, ip);
      return auth.verifyCode(email, emailDeliveries.at(-1).code, ip);
    };
    const valid = { fullName: '  李明  ', contactPhone: '+86 (138) 0013-8000', organization: ' 示例大学 ', researchArea: ' 生物医学 ' };
    const forUser = (user, values = valid) => ({ ...values, expectedEmail: user.email });
    const rejects = (work, status, code) => assert.rejects(work, error => error.status === status && (!code || error.code === code));

    await t.test('exposes incomplete profiles after first email sign-in', async () => {
      assert.equal(typeof auth.getProfile, 'function');
      const user = await login();
      assert.equal(user.profileComplete, false);
      assert.equal((await auth.getSession(user.token)).profileComplete, false);
      assert.deepEqual(await auth.getProfile(user.token), {
        profile: { fullName: '', email: user.email, contactPhone: '', organization: '', researchArea: '', submittedAt: null }, complete: false,
      });
      assert.equal((await auth.getSession(null)).profileComplete, null);
    });

    await t.test('requires the account shown on the form before creating a profile', async () => {
      const user = await login();
      await rejects(auth.saveProfile(user.token, valid), 409, 'profile_account_changed');
      assert.equal((await auth.getProfile(user.token)).complete, false);
    });

    await t.test('rejects stale form ownership without changing either account profile', async () => {
      const first = await login(), second = await login();
      const firstSaved = await auth.saveProfile(first.token, forUser(first));
      const secondSaved = await auth.saveProfile(second.token, forUser(second, { ...valid, fullName: 'Second account' }));
      await rejects(auth.saveProfile(second.token, {
        ...valid, fullName: 'First account private edit', expectedEmail: first.email,
      }), 409, 'profile_account_changed');
      assert.deepEqual(await auth.getProfile(first.token), firstSaved);
      assert.deepEqual(await auth.getProfile(second.token), secondSaved);
    });

    await t.test('persists only the current user profile without binding a phone login', async () => {
      const first = await login(), second = await login();
      const saved = await auth.saveProfile(first.token, forUser(first));
      assert.deepEqual(saved, { profile: {
        fullName: '李明', email: first.email, contactPhone: valid.contactPhone,
        organization: '示例大学', researchArea: '生物医学', submittedAt: new Date(now).toISOString(),
      }, complete: true });
      assert.deepEqual(await auth.getProfile(first.token), saved);
      assert.equal((await auth.getProfile(second.token)).complete, false);
      assert.equal((await auth.getSession(first.token)).profileComplete, true);
      assert.equal((await pool.query('SELECT phone FROM arviva_users WHERE email = $1', [first.email])).rows[0].phone, null);
      assert.equal(await auth.canViewProduct(first.token, 'module-01'), true);
      assert.equal(await auth.canViewProduct(second.token, 'module-01'), true, 'Incomplete profiles must not change product access.');
      now += 61_000;
      await auth.requestCode(first.email, '203.0.113.10');
      const renewed = await auth.verifyCode(first.email, emailDeliveries.at(-1).code, '203.0.113.10');
      assert.equal(renewed.profileComplete, true);
      assert.deepEqual(await auth.getProfile(renewed.token), saved);
    });

    await t.test('preserves the server-generated first submission date when editing', async () => {
      const user = await login();
      const first = await auth.saveProfile(user.token, forUser(user));
      now += 86_400_000;
      const edited = await auth.saveProfile(user.token, forUser(user, { fullName: 'A. Researcher', contactPhone: '020 7946 0018' }));
      assert.equal(edited.profile.submittedAt, first.profile.submittedAt);
      assert.equal(edited.profile.fullName, 'A. Researcher');
      assert.equal(edited.profile.organization, '');
      assert.equal(edited.profile.researchArea, '');
    });

    await t.test('validates fields and refuses submitted email, identity or date changes', async () => {
      const user = await login();
      const invalid = [
        {}, { ...valid, fullName: '' }, { ...valid, fullName: 'x'.repeat(101) },
        { ...valid, fullName: 'A\nB' }, { ...valid, contactPhone: '123456' },
        { ...valid, contactPhone: '1'.repeat(16) }, { ...valid, contactPhone: '+1+234567890' },
        { ...valid, contactPhone: '1234567' + ' '.repeat(32) + '8' }, { ...valid, contactPhone: '1234567\n' },
        { ...valid, organization: 'x'.repeat(201) }, { ...valid, researchArea: 123 },
        { ...valid, email: 'victim@example.com' }, { ...valid, userId: 'other' },
        { ...valid, submittedAt: '2000-01-01T00:00:00.000Z' },
      ];
      for (const data of invalid) await rejects(auth.saveProfile(user.token, forUser(user, data)), 400, 'invalid_profile');
      assert.equal((await auth.getProfile(user.token)).complete, false);
    });

    await t.test('rejects anonymous, revoked, expired and phone-only accounts', async () => {
      await rejects(auth.getProfile(null), 401, 'AUTH_REQUIRED');
      await rejects(auth.saveProfile('a'.repeat(64), valid), 401, 'AUTH_REQUIRED');
      const revoked = await login();
      await auth.logout(revoked.token);
      await rejects(auth.getProfile(revoked.token), 401, 'AUTH_REQUIRED');
      await rejects(auth.saveProfile(revoked.token, valid), 401, 'AUTH_REQUIRED');
      const phone = '+8613800138000';
      await auth.requestPhoneCode(phone, '203.0.113.20');
      const phoneUser = await auth.verifyPhoneCode(phone, smsDeliveries.at(-1).code, '203.0.113.20');
      assert.equal(phoneUser.profileComplete, null);
      assert.equal((await auth.getSession(phoneUser.token)).profileComplete, null);
      await rejects(auth.getProfile(phoneUser.token), 403, 'email_account_required');
      await rejects(auth.saveProfile(phoneUser.token, valid), 403, 'email_account_required');
      const expired = await login();
      now += 7 * 86_400_000;
      await rejects(auth.getProfile(expired.token), 401, 'AUTH_REQUIRED');
      await rejects(auth.saveProfile(expired.token, valid), 401, 'AUTH_REQUIRED');
    });

    await t.test('HTTP endpoints enforce session, origin, JSON and request-method boundaries', async () => {
      await writeFile(path.join(root, 'index.html'), 'PROFILE TEST');
      const config = { origin: 'http://127.0.0.1', secureCookies: false, trustProxy: false };
      server = createApp({ config, auth, mailer: { ready: true, development: true }, root });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      config.origin = base;
      const user = await login();
      const cookie = `arviva_session=${user.token}`;
      const post = (body, headers = {}) => fetch(base + '/api/profile', {
        method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: JSON.stringify(forUser(user, body)),
      });
      assert.equal((await fetch(base + '/api/profile')).status, 401);
      assert.equal((await post(valid, { Cookie: '' })).status, 401);
      assert.equal((await post(valid, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await post(valid, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
      assert.equal((await post(valid, { 'Content-Type': 'text/plain' })).status, 415);
      assert.equal((await fetch(base + '/api/profile', { method: 'DELETE' })).status, 405);
      assert.equal((await post({ ...valid, organization: 'x'.repeat(5000) })).status, 413);
      const saved = await post(valid);
      assert.equal(saved.status, 200);
      assert.equal(saved.headers.get('cache-control'), 'no-store');
      assert.equal((await saved.json()).complete, true);
      const current = await fetch(base + '/api/profile', { headers: { Cookie: cookie } });
      assert.equal(current.status, 200);
      assert.equal((await current.json()).profile.email, user.email);
      const other = await login();
      const otherSaved = await auth.saveProfile(other.token, forUser(other, { ...valid, fullName: 'Other account' }));
      const staleSave = await post({ ...valid, fullName: 'Stale private edit' }, {
        Cookie: `arviva_session=${other.token}`,
      });
      assert.equal(staleSave.status, 409);
      assert.deepEqual(await staleSave.json(), {
        error: 'profile_account_changed',
        message: 'Your sign-in account has changed. Reload this page before saving your profile.',
      });
      assert.deepEqual(await auth.getProfile(other.token), otherSaved);
      assert.equal((await auth.getProfile(user.token)).profile.fullName, '李明');
      const session = await (await fetch(base + '/api/session', { headers: { Cookie: cookie } })).json();
      assert.equal(session.profileComplete, true);
      assert.equal(session.phone, null);
      now += 61_000;
      await auth.requestCode(user.email, '203.0.113.30');
      const verified = await fetch(base + '/api/auth/verify', {
        method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, code: emailDeliveries.at(-1).code }),
      });
      assert.equal(verified.status, 200);
      assert.equal((await verified.json()).profileComplete, true);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (pool) await pool.end();
    // Only this generated schema is removed; the configured database is never dropped.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
});
