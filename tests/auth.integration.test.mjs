import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = databaseUrl ? false : 'TEST_DATABASE_URL is not set; real PostgreSQL integration tests require a dedicated database.';

test('PostgreSQL authentication and product authorization', { skip }, async (t) => {
  const { Pool } = await import('pg');
  const { createAuthService } = await import('../server/auth-service.mjs');
  const schema = `arviva_test_${randomBytes(12).toString('hex')}`;
  assert.match(schema, /^arviva_test_[a-f0-9]{24}$/);
  const admin = new Pool({ connectionString: databaseUrl });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
    await pool.query(await readFile(new URL('../db/migrations/001_auth.sql', import.meta.url), 'utf8'));

    let sequence = 0;
    function fixture(sendOverride) {
      const id = ++sequence;
      let timestamp = Date.now();
      const deliveries = [];
      const email = `person-${id}@example.com`;
      const ip = `198.51.100.${id}`;
      const service = createAuthService({
        pool,
        secret: 'integration-test-only-secret-at-least-32-characters',
        now: () => timestamp,
        sendCode: async (delivery) => {
          deliveries.push(delivery);
          if (sendOverride) await sendOverride(delivery);
        },
      });
      return {
        service, email, ip, deliveries,
        advance: (milliseconds) => { timestamp += milliseconds; },
        async login(address = email, source = ip) {
          await service.requestCode(address, source);
          return service.verifyCode(address, deliveries.at(-1).code, source);
        },
      };
    }
    const rejectsWith = (promise, status, code) => assert.rejects(promise, (error) => {
      assert.equal(error.status, status);
      if (code) assert.equal(error.code, code);
      assert.equal(typeof error.message, 'string');
      return true;
    });
    async function whileRowLocked(sql, parameters, operation, advance) {
      const blocker = await pool.connect();
      let pending;
      try {
        await blocker.query('BEGIN');
        const { pid } = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0];
        await blocker.query(sql, parameters);
        pending = operation().then((value) => ({ value }), (error) => ({ error }));
        let waiting = false;
        for (let retry = 0; retry < 100 && !waiting; retry++) {
          waiting = (await pool.query('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS waiting', [pid])).rows[0].waiting;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true, 'The service must reach the row lock before the clock advances.');
        advance();
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
      return pending;
    }

    await t.test('creates a persistent account and session without storing plaintext secrets', async () => {
      const f = fixture();
      const result = await f.service.requestCode(`  ${f.email.toUpperCase()}  `, f.ip);
      assert.equal(result.retryAfterSeconds, 60);
      assert.equal(Object.hasOwn(result, 'code'), false);
      assert.equal(f.deliveries[0].email, f.email);
      assert.match(f.deliveries[0].code, /^\d{6}$/);
      assert.equal(f.deliveries[0].expiresMinutes, 10);
      const login = await f.service.verifyCode(f.email, f.deliveries[0].code, f.ip);
      assert.match(login.token, /^[a-f0-9]{64}$/);
      assert.equal(login.email, f.email);
      assert.deepEqual(login.products, {
        'module-01': { trialUsed: false, paid: false },
        'module-02': { trialUsed: false, paid: false },
      });
      assert.deepEqual(await f.service.getSession(login.token), { authenticated: true, email: f.email, products: login.products });
      const stored = await pool.query('SELECT code_digest FROM arviva_verification_challenges WHERE email = $1', [f.email]);
      assert.match(stored.rows[0].code_digest, /^[a-f0-9]{64}$/);
      assert.notEqual(stored.rows[0].code_digest, f.deliveries[0].code);
      const sessions = await pool.query('SELECT token_digest FROM arviva_sessions');
      assert.equal(sessions.rows.some((row) => row.token_digest === login.token), false);
      const events = await pool.query('SELECT ip_digest FROM arviva_auth_events');
      assert.equal(events.rows.some((row) => row.ip_digest === f.ip), false);
    });

    await t.test('accepts a code once even when verification requests race', async () => {
      const f = fixture();
      await f.service.requestCode(f.email, f.ip);
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => f.service.verifyCode(f.email, f.deliveries[0].code, f.ip)));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.status === 400).length, 5);
      const users = await pool.query('SELECT count(*)::int AS count FROM arviva_users WHERE email = $1', [f.email]);
      assert.equal(users.rows[0].count, 1);
    });

    await t.test('expires codes after ten minutes', async () => {
      const f = fixture();
      await f.service.requestCode(f.email, f.ip);
      f.advance(10 * 60 * 1000);
      await rejectsWith(f.service.verifyCode(f.email, f.deliveries[0].code, f.ip), 400, 'INVALID_CODE');
    });

    await t.test('checks code expiration after waiting for a concurrent row lock', async () => {
      const f = fixture();
      await f.service.requestCode(f.email, f.ip);
      const result = await whileRowLocked(
        'SELECT email FROM arviva_verification_challenges WHERE email = $1 FOR UPDATE', [f.email],
        () => f.service.verifyCode(f.email, f.deliveries[0].code, f.ip),
        () => f.advance(10 * 60_000),
      );
      assert.equal(result.error?.status, 400);
      assert.equal(result.error?.code, 'INVALID_CODE');
    });

    await t.test('invalidates a code after five wrong attempts', async () => {
      const f = fixture();
      await f.service.requestCode(f.email, f.ip);
      const correct = f.deliveries[0].code;
      const wrong = correct === '000000' ? '000001' : '000000';
      for (let attempt = 0; attempt < 5; attempt++) await rejectsWith(f.service.verifyCode(f.email, wrong, f.ip), 400, 'INVALID_CODE');
      await rejectsWith(f.service.verifyCode(f.email, correct, f.ip), 400, 'INVALID_CODE');
    });

    await t.test('resending invalidates the old code and preserves one user across later logins', async () => {
      const f = fixture();
      await f.service.requestCode(f.email, f.ip);
      const old = f.deliveries[0].code;
      f.advance(60_000);
      await f.service.requestCode(f.email, f.ip);
      const current = f.deliveries[1].code;
      assert.notEqual(old, current);
      await rejectsWith(f.service.verifyCode(f.email, old, f.ip), 400);
      const first = await f.service.verifyCode(f.email, current, f.ip);
      f.advance(60_000);
      const second = await f.login();
      assert.notEqual(first.token, second.token);
      const users = await pool.query('SELECT count(*)::int AS count FROM arviva_users WHERE email = $1', [f.email]);
      assert.equal(users.rows[0].count, 1);
    });

    await t.test('enforces a sixty-second cooldown and five sends per email per hour', async () => {
      const f = fixture();
      await f.service.requestCode(f.email, f.ip);
      await rejectsWith(f.service.requestCode(f.email, f.ip), 429, 'RATE_LIMITED');
      for (let count = 1; count < 5; count++) {
        f.advance(60_000);
        await f.service.requestCode(f.email, f.ip);
      }
      f.advance(60_000);
      await rejectsWith(f.service.requestCode(f.email, f.ip), 429, 'RATE_LIMITED');
      f.advance(60 * 60 * 1000);
      await f.service.requestCode(f.email, f.ip);
    });

    await t.test('limits sending and verification across addresses from one IP', async () => {
      const f = fixture();
      for (let index = 0; index < 30; index++) await f.service.requestCode(`ip-${sequence}-${index}@example.com`, f.ip);
      await rejectsWith(f.service.requestCode(`ip-${sequence}-extra@example.com`, f.ip), 429, 'RATE_LIMITED');
      for (let index = 0; index < 60; index++) await rejectsWith(f.service.verifyCode(`unknown-${sequence}@example.com`, '123456', f.ip), 400);
      await rejectsWith(f.service.verifyCode(`unknown-${sequence}@example.com`, '123456', f.ip), 429, 'RATE_LIMITED');
    });

    await t.test('failed delivery disables new and old codes but still applies a cooldown', async () => {
      let fail = false;
      const f = fixture(async () => { if (fail) throw new Error('SMTP refused delivery'); });
      await f.service.requestCode(f.email, f.ip);
      const old = f.deliveries[0].code;
      fail = true;
      f.advance(60_000);
      await rejectsWith(f.service.requestCode(f.email, f.ip), 503, 'MAIL_UNAVAILABLE');
      await rejectsWith(f.service.verifyCode(f.email, f.deliveries[1].code, f.ip), 400);
      await rejectsWith(f.service.verifyCode(f.email, old, f.ip), 400);
      await rejectsWith(f.service.requestCode(f.email, f.ip), 429);
    });

    await t.test('pending delivery cannot be verified before the mail operation succeeds', async () => {
      let release;
      let notify;
      const started = new Promise((resolve) => { notify = resolve; });
      const sending = new Promise((resolve) => { release = resolve; });
      const f = fixture(async () => { notify(); await sending; });
      const request = f.service.requestCode(f.email, f.ip);
      await started;
      try {
        await rejectsWith(f.service.verifyCode(f.email, f.deliveries[0].code, f.ip), 400);
      } finally { release(); }
      await request;
      assert.equal((await f.service.verifyCode(f.email, f.deliveries[0].code, f.ip)).email, f.email);
    });

    for (const failOldDelivery of [false, true]) {
      await t.test(`a replaced delivery cannot overwrite the current code when it later ${failOldDelivery ? 'fails' : 'succeeds'}`, async () => {
        let release;
        let notify;
        const started = new Promise((resolve) => { notify = resolve; });
        const delayed = new Promise((resolve) => { release = resolve; });
        let deliveryCount = 0;
        const f = fixture(async () => {
          if (++deliveryCount === 1) {
            notify();
            await delayed;
            if (failOldDelivery) throw new Error('Old SMTP operation failed');
          }
        });
        const first = f.service.requestCode(f.email, f.ip).then((value) => ({ value }), (error) => ({ error }));
        await started;
        try {
          f.advance(60_000);
          await f.service.requestCode(f.email, f.ip);
        } finally { release(); }
        const result = await first;
        assert.equal(result.error?.status, failOldDelivery ? 503 : 409);
        assert.equal(result.error?.code, failOldDelivery ? 'MAIL_UNAVAILABLE' : 'CODE_SUPERSEDED');
        await rejectsWith(f.service.verifyCode(f.email, f.deliveries[0].code, f.ip), 400);
        assert.equal((await f.service.verifyCode(f.email, f.deliveries[1].code, f.ip)).email, f.email);
      });
    }

    await t.test('consumes one trial under concurrency and isolates other products and users', async () => {
      const f = fixture();
      const login = await f.login();
      const entries = await Promise.allSettled(Array.from({ length: 8 }, () => f.service.enterProduct(login.token, 'module-01')));
      assert.equal(entries.filter((entry) => entry.status === 'fulfilled').length, 1);
      assert.equal(entries.filter((entry) => entry.status === 'rejected' && entry.reason.status === 403).length, 7);
      assert.equal(await f.service.canViewProduct(login.token, 'module-01'), true);
      assert.equal(await f.service.canViewProduct(login.token, 'module-02'), false);
      assert.deepEqual((await f.service.getSession(login.token)).products, {
        'module-01': { trialUsed: true, paid: false },
        'module-02': { trialUsed: false, paid: false },
      });
      const other = fixture();
      const otherLogin = await other.login();
      assert.equal(await other.service.canViewProduct(otherLogin.token, 'module-01'), false);
      assert.equal((await other.service.getSession(otherLogin.token)).products['module-01'].trialUsed, false);
      assert.deepEqual(await f.service.enterProduct(login.token, 'module-02'), { url: '/prediction-platform' });
    });

    await t.test('serializes trial consumption across different sessions for one user', async () => {
      const f = fixture();
      const first = await f.login();
      f.advance(60_000);
      const second = await f.login();
      const tokens = [first.token, second.token];
      const entries = await Promise.allSettled(tokens.map((token) => f.service.enterProduct(token, 'module-01')));
      assert.equal(entries.filter((entry) => entry.status === 'fulfilled').length, 1);
      assert.equal(entries.filter((entry) => entry.status === 'rejected' && entry.reason.status === 403).length, 1);
      const access = await Promise.all(tokens.map((token) => f.service.canViewProduct(token, 'module-01')));
      assert.equal(access.filter(Boolean).length, 1);
    });

    await t.test('binds a trial grant to one session and expires it after fifteen minutes', async () => {
      const f = fixture();
      const first = await f.login();
      assert.deepEqual(await f.service.enterProduct(first.token, 'module-01'), { url: '/research-platform' });
      f.advance(60_000);
      const second = await f.login();
      assert.equal(await f.service.canViewProduct(second.token, 'module-01'), false);
      await rejectsWith(f.service.enterProduct(second.token, 'module-01'), 403, 'TRIAL_USED');
      assert.equal(await f.service.canViewProduct(first.token, 'module-01'), true);
      f.advance(14 * 60_000);
      assert.equal(await f.service.canViewProduct(first.token, 'module-01'), false);
    });

    await t.test('reads existing paid eligibility without consuming a trial', async () => {
      const f = fixture();
      const login = await f.login();
      await pool.query('UPDATE arviva_product_entitlements SET paid = true WHERE user_id = (SELECT id FROM arviva_users WHERE email = $1) AND product_id = $2', [f.email, 'module-01']);
      assert.equal(await f.service.canViewProduct(login.token, 'module-01'), true);
      await f.service.enterProduct(login.token, 'module-01');
      await f.service.enterProduct(login.token, 'module-01');
      assert.deepEqual((await f.service.getSession(login.token)).products['module-01'], { paid: true, trialUsed: false });
    });

    await t.test('rejects missing sessions and revokes access on logout or session expiration', async () => {
      const f = fixture();
      const signedOut = { authenticated: false, email: null, products: { 'module-01': { trialUsed: false, paid: false }, 'module-02': { trialUsed: false, paid: false } } };
      assert.deepEqual(await f.service.getSession(), signedOut);
      assert.deepEqual(await f.service.getSession('untrusted-token'), signedOut);
      assert.equal(await f.service.canViewProduct(null, 'module-01'), false);
      await rejectsWith(f.service.enterProduct(null, 'module-01'), 401, 'AUTH_REQUIRED');
      const login = await f.login();
      await f.service.enterProduct(login.token, 'module-01');
      await f.service.logout(login.token);
      assert.deepEqual(await f.service.getSession(login.token), signedOut);
      assert.equal(await f.service.canViewProduct(login.token, 'module-01'), false);
      f.advance(60_000);
      const renewed = await f.login();
      f.advance(7 * 24 * 60 * 60_000);
      assert.deepEqual(await f.service.getSession(renewed.token), signedOut);
      await rejectsWith(f.service.enterProduct(renewed.token, 'module-02'), 401);
    });

    await t.test('rejects invalid addresses and unknown product identifiers', async () => {
      const f = fixture();
      await rejectsWith(f.service.requestCode('not-an-address', f.ip), 400, 'INVALID_EMAIL');
      await rejectsWith(f.service.enterProduct(null, 'not-a-product'), 404, 'PRODUCT_NOT_FOUND');
      assert.equal(await f.service.canViewProduct(null, 'not-a-product'), false);
    });

    await t.test('rejects mailbox separators and malformed addresses while accepting plus addressing', async () => {
      const f = fixture();
      const invalid = [
        'first,second@example.com', 'first;second@example.com', 'first:second@example.com',
        '"first"@example.com', 'first\\second@example.com', 'first\r\nBcc:other@example.com',
        'first\u0000last@example.com', '.first@example.com', 'first..last@example.com',
        'first.@example.com', 'first@-example.com', 'first@example-.com',
        'first@example..com', `${'a'.repeat(65)}@example.com`,
      ];
      for (const email of invalid) await rejectsWith(f.service.requestCode(email, f.ip), 400, 'INVALID_EMAIL');
      assert.equal(f.deliveries.length, 0);
      const email = `first.last+${sequence}@example.co.uk`;
      const login = await f.login(email);
      assert.equal(login.email, email);
    });

    await t.test('checks session expiration after waiting for a concurrent row lock', async () => {
      const f = fixture();
      const login = await f.login();
      const result = await whileRowLocked(
        'SELECT s.token_digest FROM arviva_sessions s JOIN arviva_users u ON u.id = s.user_id WHERE u.email = $1 FOR UPDATE OF s', [f.email],
        () => f.service.enterProduct(login.token, 'module-01'),
        () => f.advance(7 * 24 * 60 * 60_000),
      );
      assert.equal(result.error?.status, 401);
      assert.equal(result.error?.code, 'AUTH_REQUIRED');
      const entitlement = await pool.query('SELECT trial_used_at FROM arviva_product_entitlements WHERE user_id = (SELECT id FROM arviva_users WHERE email = $1) AND product_id = $2', [f.email, 'module-01']);
      assert.equal(entitlement.rows[0].trial_used_at, null);
    });
  } finally {
    if (pool) await pool.end();
    // The identifier is generated above and validated; never drop a supplied schema or public.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
