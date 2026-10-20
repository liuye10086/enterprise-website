import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../scripts/migrate.mjs';
import { createAuthService } from '../server/auth-service.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
const serverTime = fixture => new Date(fixture.now()).toISOString();
const signedOut = fixture => ({ authenticated: false, access: 'signed-out', trialExpiresAt: null, serverNow: serverTime(fixture) });

test('research trial eligibility is owned by PostgreSQL and independent of the introduction entry', {
  skip: databaseUrl ? false : 'TEST_DATABASE_URL is required for isolated PostgreSQL tests.',
}, async t => {
  const schema = `arviva_test_${randomBytes(12).toString('hex')}`;
  assert.match(schema, /^arviva_test_[a-f0-9]{24}$/);
  const admin = new Pool({ connectionString: databaseUrl });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
    await migrate(pool);
    async function fixture({ paid = false, used = false, entitlement = true } = {}) {
      const userId = randomUUID();
      let now = Date.now();
      const service = createAuthService({ pool, secret: 'research-tests-only-secret-at-least-32-characters',
        sendCode: async () => { throw new Error('Research tests must not send mail.'); }, now: () => now });
      await pool.query('INSERT INTO arviva_users (id, email, created_at) VALUES ($1, $2, $3)', [userId, `${userId}@example.com`, new Date(now)]);
      if (entitlement) await pool.query("INSERT INTO arviva_product_entitlements (user_id, product_id, trial_used_at, paid) VALUES ($1, 'module-01', $2, $3)", [userId, used ? new Date(now) : null, paid]);
      async function session(lifetime = 7 * 24 * 60 * 60_000) {
        const token = randomBytes(32).toString('hex');
        const digest = createHash('sha256').update(token).digest('hex');
        await pool.query('INSERT INTO arviva_sessions (token_digest, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [digest, userId, new Date(now), new Date(now + lifetime)]);
        return { token, digest };
      }
      const first = await session();
      return { service, userId, ...first, session, advance: ms => { now += ms; }, now: () => now };
    }
    const rejectsWith = (promise, status, code) => assert.rejects(promise, error => error.status === status && error.code === code);
    const grants = async userId => (await pool.query('SELECT g.* FROM arviva_product_grants g JOIN arviva_sessions s ON s.token_digest = g.token_digest WHERE s.user_id = $1', [userId])).rows;

    await t.test('checking access does not consume the trial or change login-only entry', async () => {
      const f = await fixture();
      assert.equal(typeof f.service.getResearchAccess, 'function', 'the server must expose the independent research access check');
      assert.deepEqual(await f.service.getResearchAccess(null), signedOut(f));
      assert.deepEqual(await f.service.getResearchAccess('forged'), signedOut(f));
      for (let i = 0; i < 2; i++) assert.deepEqual(await f.service.getResearchAccess(f.token), { authenticated: true, access: 'trial-available', trialExpiresAt: null, serverNow: serverTime(f) });
      assert.equal((await f.service.enterProduct(f.token, 'module-01')).url, 'https://research.arvivatherap.com');
      assert.equal(await f.service.canViewProduct(f.token, 'module-01'), true);
      assert.equal((await f.service.getSession(f.token)).products['module-01'].trialUsed, false);
      assert.equal((await grants(f.userId)).length, 0);
    });

    await t.test('starting a trial grants fifteen minutes and retries do not extend it', async () => {
      const f = await fixture();
      const started = await f.service.startResearchTrial(f.token);
      const expires = new Date(f.now() + 15 * 60_000).toISOString();
      assert.deepEqual(started, { authenticated: true, access: 'trial', trialExpiresAt: expires, serverNow: serverTime(f), url: '/research-workspace' });
      assert.equal(Date.parse(started.trialExpiresAt) - Date.parse(started.serverNow), 15 * 60_000, 'trial duration is measured against the server clock');
      f.advance(60_000);
      const retried = await f.service.startResearchTrial(f.token);
      assert.deepEqual(retried, { ...started, serverNow: serverTime(f) });
      assert.equal(Date.parse(retried.trialExpiresAt) - Date.parse(retried.serverNow), 14 * 60_000);
      assert.deepEqual(await f.service.getResearchAccess(f.token), { authenticated: true, access: 'trial', trialExpiresAt: expires, serverNow: serverTime(f) });
      assert.equal((await grants(f.userId)).length, 1);
      assert.equal((await f.service.getSession(f.token)).products['module-01'].trialUsed, true);
      assert.equal((await f.service.getSession(f.token)).products['module-02'].trialUsed, false);
      f.advance(14 * 60_000);
      assert.deepEqual(await f.service.getResearchAccess(f.token), { authenticated: true, access: 'trial-used', trialExpiresAt: null, serverNow: serverTime(f) });
      await rejectsWith(f.service.startResearchTrial(f.token), 403, 'TRIAL_USED');
    });

    await t.test('concurrent claims from two sessions give only one session a trial', async () => {
      const f = await fixture();
      const second = await f.session();
      const outcomes = await Promise.allSettled([f.service.startResearchTrial(f.token), f.service.startResearchTrial(second.token)]);
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = outcomes.find(result => result.status === 'rejected').reason;
      assert.equal(rejected.code, 'TRIAL_USED');
      assert.equal(rejected.status, 403);
      assert.equal((await grants(f.userId)).length, 1);
      const access = await Promise.all([f.service.getResearchAccess(f.token), f.service.getResearchAccess(second.token)]);
      assert.deepEqual(access.map(state => state.access).sort(), ['trial', 'trial-used']);
    });

    await t.test('concurrent retries in the same session return the same grant', async () => {
      const f = await fixture();
      const states = await Promise.all(Array.from({ length: 5 }, () => f.service.startResearchTrial(f.token)));
      for (const state of states) assert.deepEqual(state, states[0]);
      assert.equal((await grants(f.userId)).length, 1);
    });

    await t.test('paid access takes precedence without consuming a trial or issuing grants', async () => {
      const f = await fixture({ paid: true });
      const expected = { authenticated: true, access: 'paid', trialExpiresAt: null, serverNow: serverTime(f) };
      assert.deepEqual(await f.service.getResearchAccess(f.token), expected);
      assert.deepEqual(await f.service.startResearchTrial(f.token), { ...expected, url: '/research-workspace' });
      assert.equal((await f.service.getSession(f.token)).products['module-01'].trialUsed, false);
      assert.equal((await grants(f.userId)).length, 0);
    });

    await t.test('missing eligibility and historical used trials cannot grant access', async () => {
      for (const options of [{ used: true }, { entitlement: false }]) {
        const f = await fixture(options);
        assert.deepEqual(await f.service.getResearchAccess(f.token), { authenticated: true, access: 'trial-used', trialExpiresAt: null, serverNow: serverTime(f) });
        await rejectsWith(f.service.startResearchTrial(f.token), 403, options.entitlement === false ? 'ACCESS_DENIED' : 'TRIAL_USED');
        assert.equal((await grants(f.userId)).length, 0);
      }
    });

    await t.test('logout and session expiry invalidate an otherwise unexpired trial', async () => {
      const f = await fixture();
      await f.service.startResearchTrial(f.token);
      await f.service.logout(f.token);
      assert.deepEqual(await f.service.getResearchAccess(f.token), signedOut(f));
      await rejectsWith(f.service.startResearchTrial(f.token), 401, 'AUTH_REQUIRED');
      const expired = await fixture();
      const short = await expired.session(2 * 60_000);
      await expired.service.startResearchTrial(short.token);
      expired.advance(2 * 60_000);
      assert.deepEqual(await expired.service.getResearchAccess(short.token), signedOut(expired));
      await rejectsWith(expired.service.startResearchTrial(short.token), 401, 'AUTH_REQUIRED');
    });

    await t.test('a session expiring while waiting for eligibility cannot consume a trial', async () => {
      const f = await fixture();
      const short = await f.session(60_000);
      const blocker = await pool.connect();
      let pending;
      try {
        await blocker.query('BEGIN');
        const { pid } = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0];
        await blocker.query("SELECT 1 FROM arviva_product_entitlements WHERE user_id = $1 AND product_id = 'module-01' FOR UPDATE", [f.userId]);
        pending = f.service.startResearchTrial(short.token).then(value => ({ value }), error => ({ error }));
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          waiting = (await pool.query('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS waiting', [pid])).rows[0].waiting;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true, 'trial claim must wait for the existing entitlement row lock');
        f.advance(60_000);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
      const outcome = await pending;
      assert.equal(outcome.error?.code, 'AUTH_REQUIRED');
      assert.equal((await grants(f.userId)).length, 0);
      assert.equal((await f.service.getSession(f.token)).products['module-01'].trialUsed, false);
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
