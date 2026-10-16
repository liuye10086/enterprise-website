import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { migrate } from '../scripts/migrate.mjs';

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
    const legacyUserId = randomUUID();
    const legacyToken = randomBytes(32).toString('hex');
    const legacyDigest = createHash('sha256').update(legacyToken).digest('hex');
    const legacyEmail = 'legacy-account@example.com';
    const legacyCode = '102938';
    const legacyCodeDigest = createHmac('sha256', 'integration-test-only-secret-at-least-32-characters').update(`otp\0${legacyEmail}\0${legacyCode}`).digest('hex');
    await pool.query('INSERT INTO arviva_users(id, email, created_at) VALUES ($1, $2, now())', [legacyUserId, legacyEmail]);
    await pool.query("INSERT INTO arviva_sessions(token_digest, user_id, created_at, expires_at) VALUES ($1, $2, now(), now() + interval '7 days')", [legacyDigest, legacyUserId]);
    await pool.query("INSERT INTO arviva_product_entitlements(user_id, product_id, trial_used_at, paid) VALUES ($1, 'module-01', now(), true), ($1, 'module-02', now(), false)", [legacyUserId]);
    await pool.query("INSERT INTO arviva_product_grants(token_digest, product_id, created_at, expires_at) VALUES ($1, 'module-02', now(), now() + interval '15 minutes')", [legacyDigest]);
    await pool.query("INSERT INTO arviva_verification_challenges(email, challenge_id, code_digest, status, requested_at, expires_at, delivered_at) VALUES ($1, $2, $3, 'sent', now(), now() + interval '10 minutes', now())", [legacyEmail, randomUUID(), legacyCodeDigest]);
    const legacyEventId = randomUUID();
    await pool.query("INSERT INTO arviva_auth_events(id, kind, email_digest, ip_digest, created_at) VALUES ($1, 'send', $2, $3, now())", [legacyEventId, 'a'.repeat(64), 'b'.repeat(64)]);
    await migrate(pool);

    let sequence = 0;
    function fixture(sendOverride, smsOverride, smsDailyLimit = 1000) {
      const id = ++sequence;
      let timestamp = Date.now();
      const deliveries = [];
      const smsDeliveries = [];
      const email = `person-${id}@example.com`;
      const phone = `+8613800${String(id).padStart(6, '0')}`;
      const ip = `198.51.100.${id}`;
      const service = createAuthService({
        pool,
        secret: 'integration-test-only-secret-at-least-32-characters',
        now: () => timestamp,
        sendCode: async (delivery) => {
          deliveries.push(delivery);
          if (sendOverride) await sendOverride(delivery);
        },
        sendSmsCode: async (delivery) => {
          smsDeliveries.push(delivery);
          if (smsOverride) await smsOverride(delivery);
        },
        smsDailyLimit,
      });
      return {
        service, email, phone, ip, deliveries, smsDeliveries,
        advance: (milliseconds) => { timestamp += milliseconds; },
        setTime: (value) => { timestamp = value; },
        async login(address = email, source = ip) {
          await service.requestCode(address, source);
          return service.verifyCode(address, deliveries.at(-1).code, source);
        },
        async phoneLogin(number = phone, source = ip) {
          await service.requestPhoneCode(number, source);
          return service.verifyPhoneCode(number, smsDeliveries.at(-1).code, source);
        },
      };
    }

    await t.test('migration preserves existing email users, sessions, entitlements, grants and challenges', async () => {
      const f = fixture();
      const session = await f.service.getSession(legacyToken);
      assert.equal(session.authenticated, true);
      assert.equal(session.email, legacyEmail);
      assert.equal(session.phone, null);
      assert.deepEqual(session.products, { 'module-01': { trialUsed: true, paid: true }, 'module-02': { trialUsed: true, paid: false } });
      assert.equal(await f.service.canViewProduct(legacyToken, 'module-02'), true);
      const login = await f.service.verifyCode(legacyEmail, legacyCode, f.ip);
      assert.equal(login.phone, null);
      assert.equal((await pool.query('SELECT id FROM arviva_users WHERE email = $1', [legacyEmail])).rows[0].id, legacyUserId);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM arviva_auth_events WHERE id = $1', [legacyEventId])).rows[0].count, 1);
      await migrate(pool);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM arviva_sessions WHERE token_digest = $1', [legacyDigest])).rows[0].count, 1);
    });
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
      assert.equal(login.phone, null);
      assert.deepEqual(login.products, {
        'module-01': { trialUsed: false, paid: false },
        'module-02': { trialUsed: false, paid: false },
      });
      assert.deepEqual(await f.service.getSession(login.token), { authenticated: true, email: f.email, phone: null, products: login.products });
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

    await t.test('opens both products repeatedly without consuming trials or creating grants', async () => {
      const f = fixture();
      const login = await f.login();
      const before = await f.service.getSession(login.token);
      const entries = await Promise.all(Array.from({ length: 8 }, () => f.service.enterProduct(login.token, 'module-01')));
      assert.ok(entries.every(result => result.url === 'https://research.arvivatherap.com'));
      assert.equal(await f.service.canViewProduct(login.token, 'module-02'), true);
      assert.deepEqual(await f.service.enterProduct(login.token, 'module-02'), { url: 'https://thesis.arvivatherap.com' });
      assert.deepEqual(await f.service.getSession(login.token), before);
      const grants = await pool.query('SELECT count(*)::int AS count FROM arviva_product_grants WHERE token_digest = $1', [createHash('sha256').update(login.token).digest('hex')]);
      assert.equal(grants.rows[0].count, 0);
    });

    await t.test('used unpaid trials and missing entitlements do not restrict signed-in accounts', async () => {
      const f = fixture();
      const login = await f.login();
      await pool.query('UPDATE arviva_product_entitlements SET trial_used_at = now(), paid = false WHERE user_id = (SELECT id FROM arviva_users WHERE email = $1)', [f.email]);
      const history = await pool.query('SELECT * FROM arviva_product_entitlements WHERE user_id = (SELECT id FROM arviva_users WHERE email = $1) ORDER BY product_id', [f.email]);
      for (const id of ['module-01', 'module-02']) {
        assert.equal(await f.service.canViewProduct(login.token, id), true);
        assert.deepEqual(await f.service.enterProduct(login.token, id), { url: id === 'module-01' ? 'https://research.arvivatherap.com' : 'https://thesis.arvivatherap.com' });
      }
      assert.deepEqual((await pool.query('SELECT * FROM arviva_product_entitlements WHERE user_id = (SELECT id FROM arviva_users WHERE email = $1) ORDER BY product_id', [f.email])).rows, history.rows);
      await pool.query('DELETE FROM arviva_product_entitlements WHERE user_id = (SELECT id FROM arviva_users WHERE email = $1)', [f.email]);
      for (const id of ['module-01', 'module-02']) {
        assert.equal(await f.service.canViewProduct(login.token, id), true);
        assert.deepEqual(await f.service.enterProduct(login.token, id), { url: id === 'module-01' ? 'https://research.arvivatherap.com' : 'https://thesis.arvivatherap.com' });
      }
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM arviva_product_entitlements WHERE user_id = (SELECT id FROM arviva_users WHERE email = $1)', [f.email])).rows[0].count, 0);
    });

    await t.test('all valid sessions for the same user retain access beyond the old trial grant lifetime', async () => {
      const f = fixture();
      const first = await f.login();
      await f.service.enterProduct(first.token, 'module-01');
      f.advance(60_000);
      const second = await f.login();
      f.advance(16 * 60_000);
      for (const token of [first.token, second.token]) {
        assert.equal(await f.service.canViewProduct(token, 'module-01'), true);
        assert.deepEqual(await f.service.enterProduct(token, 'module-01'), { url: 'https://research.arvivatherap.com' });
      }
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
      const signedOut = { authenticated: false, email: null, phone: null, products: { 'module-01': { trialUsed: false, paid: false }, 'module-02': { trialUsed: false, paid: false } } };
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

    await t.test('different QQ mailboxes can independently log in and hold product eligibility', async () => {
      const f = fixture();
      const first = await f.login('100001001@qq.com');
      const second = await f.login('100001002@qq.com');
      assert.equal(first.email, '100001001@qq.com');
      assert.equal(second.email, '100001002@qq.com');
      assert.equal(first.phone, null);
      await f.service.enterProduct(first.token, 'module-01');
      assert.equal((await f.service.getSession(second.token)).products['module-01'].trialUsed, false);
      const users = await pool.query('SELECT id FROM arviva_users WHERE email = ANY($1::text[])', [['100001001@qq.com', '100001002@qq.com']]);
      assert.equal(new Set(users.rows.map(({ id }) => id)).size, 2);
    });

    await t.test('creates a normalized mobile account with private OTP storage and a persistent session', async () => {
      const f = fixture();
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      assert.equal(typeof f.service.verifyPhoneCode, 'function');
      const local = f.phone.slice(3);
      const result = await f.service.requestPhoneCode(`+86 ${local}`, f.ip);
      assert.equal(result.retryAfterSeconds, 60);
      assert.equal(Object.hasOwn(result, 'code'), false);
      assert.equal(f.deliveries.length, 0);
      assert.equal(f.smsDeliveries[0].phone, f.phone);
      assert.equal(f.smsDeliveries[0].expiresMinutes, 10);
      assert.match(f.smsDeliveries[0].code, /^\d{6}$/);
      const login = await f.service.verifyPhoneCode(`0086${local}`, f.smsDeliveries[0].code, f.ip);
      assert.equal(login.email, null);
      assert.equal(login.phone, f.phone);
      assert.match(login.token, /^[a-f0-9]{64}$/);
      assert.deepEqual(await f.service.getSession(login.token), { authenticated: true, email: null, phone: f.phone, products: login.products });
      const challenge = (await pool.query('SELECT * FROM arviva_phone_verification_challenges WHERE phone = $1', [f.phone])).rows[0];
      assert.equal(challenge.status, 'consumed');
      assert.match(challenge.code_digest, /^[a-f0-9]{64}$/);
      assert.notEqual(challenge.code_digest, f.smsDeliveries[0].code);
      const events = await pool.query('SELECT phone_digest, email_digest FROM arviva_auth_events WHERE phone_digest IS NOT NULL');
      assert.ok(events.rows.length >= 2);
      assert.ok(events.rows.every((row) => row.email_digest === null && /^[a-f0-9]{64}$/.test(row.phone_digest)));
      f.advance(60_000);
      const again = await f.phoneLogin(local);
      assert.notEqual(again.token, login.token);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM arviva_users WHERE phone = $1', [f.phone])).rows[0].count, 1);
    });

    await t.test('mobile codes are accepted only once under concurrent verification', async () => {
      const f = fixture();
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      await f.service.requestPhoneCode(f.phone, f.ip);
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => f.service.verifyPhoneCode(f.phone, f.smsDeliveries[0].code, f.ip)));
      assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'INVALID_CODE').length, 5);
    });

    await t.test('mobile codes expire after ten minutes and enforce five failed attempts', async () => {
      const f = fixture();
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      await f.service.requestPhoneCode(f.phone, f.ip);
      f.advance(10 * 60_000);
      await rejectsWith(f.service.verifyPhoneCode(f.phone, f.smsDeliveries[0].code, f.ip), 400, 'INVALID_CODE');
      await f.service.requestPhoneCode(f.phone, f.ip);
      const correct = f.smsDeliveries[1].code;
      const wrong = correct === '000000' ? '000001' : '000000';
      for (let attempt = 0; attempt < 5; attempt++) await rejectsWith(f.service.verifyPhoneCode(f.phone, attempt === 0 ? 'malformed' : wrong, f.ip), 400, 'INVALID_CODE');
      await rejectsWith(f.service.verifyPhoneCode(f.phone, correct, f.ip), 400, 'INVALID_CODE');
    });

    await t.test('mobile expiration is checked after a concurrent challenge row lock', async () => {
      const f = fixture();
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      await f.service.requestPhoneCode(f.phone, f.ip);
      const result = await whileRowLocked(
        'SELECT phone FROM arviva_phone_verification_challenges WHERE phone = $1 FOR UPDATE', [f.phone],
        () => f.service.verifyPhoneCode(f.phone, f.smsDeliveries[0].code, f.ip),
        () => f.advance(10 * 60_000),
      );
      assert.equal(result.error?.code, 'INVALID_CODE');
    });

    await t.test('mobile aliases share a cooldown and five sends per hour, with resend invalidating the old code', async () => {
      const f = fixture();
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      await f.service.requestPhoneCode(f.phone, f.ip);
      await rejectsWith(f.service.requestPhoneCode(f.phone.slice(3), f.ip), 429, 'RATE_LIMITED');
      const old = f.smsDeliveries[0].code;
      f.advance(60_000);
      await f.service.requestPhoneCode(f.phone, f.ip);
      assert.notEqual(old, f.smsDeliveries[1].code);
      await rejectsWith(f.service.verifyPhoneCode(f.phone, old, f.ip), 400, 'INVALID_CODE');
      for (let count = 2; count < 5; count++) {
        f.advance(60_000);
        await f.service.requestPhoneCode(f.phone, f.ip);
      }
      f.advance(60_000);
      await rejectsWith(f.service.requestPhoneCode(f.phone, f.ip), 429, 'RATE_LIMITED');
      f.advance(60 * 60_000);
      await f.service.requestPhoneCode(f.phone, f.ip);
    });

    await t.test('email and mobile share IP send and verification budgets in both directions', async () => {
      const f = fixture();
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      for (let index = 0; index < 15; index++) {
        await f.service.requestCode(`mixed-${sequence}-${index}@example.com`, f.ip);
        await f.service.requestPhoneCode(`+8613900${String(sequence * 100 + index).padStart(6, '0')}`, f.ip);
      }
      await rejectsWith(f.service.requestCode(f.email, f.ip), 429, 'RATE_LIMITED');
      await rejectsWith(f.service.requestPhoneCode(f.phone, f.ip), 429, 'RATE_LIMITED');
      for (let index = 0; index < 30; index++) {
        await rejectsWith(f.service.verifyCode(f.email, '123456', f.ip), 400, 'INVALID_CODE');
        await rejectsWith(f.service.verifyPhoneCode(f.phone, '123456', f.ip), 400, 'INVALID_CODE');
      }
      await rejectsWith(f.service.verifyCode(f.email, '123456', f.ip), 429, 'RATE_LIMITED');
      await rejectsWith(f.service.verifyPhoneCode(f.phone, '123456', f.ip), 429, 'RATE_LIMITED');
    });

    await t.test('failed SMS disables both new and old codes while retaining a cooldown', async () => {
      let fail = false;
      const f = fixture(undefined, async () => { if (fail) throw new Error('SMS delivery refused'); });
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      await f.service.requestPhoneCode(f.phone, f.ip);
      fail = true;
      f.advance(60_000);
      await rejectsWith(f.service.requestPhoneCode(f.phone, f.ip), 503, 'SMS_UNAVAILABLE');
      for (const { code } of f.smsDeliveries) await rejectsWith(f.service.verifyPhoneCode(f.phone, code, f.ip), 400, 'INVALID_CODE');
      await rejectsWith(f.service.requestPhoneCode(f.phone, f.ip), 429, 'RATE_LIMITED');
    });

    await t.test('pending SMS cannot authenticate before successful delivery', async () => {
      let notify;
      let release;
      const started = new Promise((resolve) => { notify = resolve; });
      const pending = new Promise((resolve) => { release = resolve; });
      const f = fixture(undefined, async () => { notify(); await pending; });
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      const request = f.service.requestPhoneCode(f.phone, f.ip);
      await started;
      try {
        await rejectsWith(f.service.verifyPhoneCode(f.phone, f.smsDeliveries[0].code, f.ip), 400, 'INVALID_CODE');
      } finally { release(); }
      await request;
      assert.equal((await f.service.verifyPhoneCode(f.phone, f.smsDeliveries[0].code, f.ip)).phone, f.phone);
    });

    for (const failOldDelivery of [false, true]) {
      await t.test(`a superseded SMS cannot replace the newer challenge when delivery ${failOldDelivery ? 'fails' : 'succeeds'}`, async () => {
        let notify;
        let release;
        let count = 0;
        const started = new Promise((resolve) => { notify = resolve; });
        const pending = new Promise((resolve) => { release = resolve; });
        const f = fixture(undefined, async () => {
          if (++count === 1) {
            notify();
            await pending;
            if (failOldDelivery) throw new Error('Old delivery failed');
          }
        });
        assert.equal(typeof f.service.requestPhoneCode, 'function');
        const first = f.service.requestPhoneCode(f.phone, f.ip).then((value) => ({ value }), (error) => ({ error }));
        await started;
        try {
          f.advance(60_000);
          await f.service.requestPhoneCode(f.phone, f.ip);
        } finally { release(); }
        assert.equal((await first).error?.code, failOldDelivery ? 'SMS_UNAVAILABLE' : 'CODE_SUPERSEDED');
        await rejectsWith(f.service.verifyPhoneCode(f.phone, f.smsDeliveries[0].code, f.ip), 400, 'INVALID_CODE');
        assert.equal((await f.service.verifyPhoneCode(f.phone, f.smsDeliveries[1].code, f.ip)).phone, f.phone);
      });
    }

    await t.test('SMS daily budget is global and reserves capacity atomically across concurrent numbers and IPs', async () => {
      const f = fixture(undefined, undefined, 2);
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      f.setTime(Date.UTC(2040, 0, 1, 12));
      const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => f.service.requestPhoneCode(`+861370000000${index}`, `203.0.113.${index}`)));
      assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 2);
      assert.equal(attempts.filter((entry) => entry.status === 'rejected' && entry.reason.code === 'RATE_LIMITED').length, 3);
      assert.equal(f.smsDeliveries.length, 2);
      const other = fixture(undefined, undefined, 2);
      other.setTime(Date.UTC(2040, 0, 1, 18));
      await rejectsWith(other.service.requestPhoneCode(other.phone, other.ip), 429, 'RATE_LIMITED');
      await other.service.requestCode(other.email, other.ip);
      other.setTime(Date.UTC(2040, 0, 2));
      await other.service.requestPhoneCode(other.phone, other.ip);
    });

    await t.test('failed SMS reservations count toward the global daily budget', async () => {
      const f = fixture(undefined, async () => { throw new Error('SMS provider unavailable'); }, 1);
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      f.setTime(Date.UTC(2041, 0, 1));
      await rejectsWith(f.service.requestPhoneCode(f.phone, f.ip), 503, 'SMS_UNAVAILABLE');
      await rejectsWith(f.service.requestPhoneCode('+8613700000099', '203.0.113.199'), 429, 'RATE_LIMITED');
      assert.equal(f.smsDeliveries.length, 1);
    });

    await t.test('optional SMS delivery fails clearly and never reserves a challenge when disabled', async () => {
      const service = createAuthService({ pool, secret: 'integration-test-only-secret-at-least-32-characters', sendCode: async () => {} });
      assert.equal(typeof service.requestPhoneCode, 'function');
      const phone = '+8613700000098';
      await rejectsWith(service.requestPhoneCode(phone, '203.0.113.198'), 503, 'SMS_UNAVAILABLE');
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM arviva_phone_verification_challenges WHERE phone = $1', [phone])).rows[0].count, 0);
    });

    await t.test('email and phone OTP digests cannot be transplanted between channels', async () => {
      const f = fixture();
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      await f.service.requestCode(f.email, f.ip);
      await f.service.requestPhoneCode(f.phone, f.ip);
      await pool.query('UPDATE arviva_phone_verification_challenges SET code_digest = (SELECT code_digest FROM arviva_verification_challenges WHERE email = $1) WHERE phone = $2', [f.email, f.phone]);
      await rejectsWith(f.service.verifyPhoneCode(f.phone, f.deliveries[0].code, f.ip), 400, 'INVALID_CODE');
      assert.equal((await f.service.verifyCode(f.email, f.deliveries[0].code, f.ip)).email, f.email);
    });

    await t.test('phone product eligibility persists by user and remains independent from email accounts', async () => {
      const f = fixture();
      assert.equal(typeof f.service.requestPhoneCode, 'function');
      const phoneLogin = await f.phoneLogin();
      const emailLogin = await f.login(`${f.phone.slice(3)}@qq.com`);
      const users = await pool.query('SELECT id, email, phone FROM arviva_users WHERE email = $1 OR phone = $2', [emailLogin.email, f.phone]);
      assert.equal(users.rows.length, 2);
      assert.ok(users.rows.some(({ email, phone }) => email === null && phone === f.phone));
      const entries = await Promise.allSettled(Array.from({ length: 6 }, () => f.service.enterProduct(phoneLogin.token, 'module-01')));
      assert.equal(entries.filter(({ status }) => status === 'fulfilled').length, 6);
      assert.equal(entries.filter((entry) => entry.status === 'rejected').length, 0);
      assert.equal((await f.service.getSession(emailLogin.token)).products['module-01'].trialUsed, false);
      f.advance(60_000);
      const renewed = await f.phoneLogin();
      assert.equal((await f.service.getSession(renewed.token)).products['module-01'].trialUsed, false);
      assert.deepEqual(await f.service.enterProduct(renewed.token, 'module-01'), { url: 'https://research.arvivatherap.com' });
      await pool.query('UPDATE arviva_product_entitlements SET paid = true WHERE user_id = (SELECT id FROM arviva_users WHERE phone = $1) AND product_id = $2', [f.phone, 'module-02']);
      assert.equal(await f.service.canViewProduct(renewed.token, 'module-02'), true);
      await f.service.logout(renewed.token);
      assert.deepEqual(await f.service.getSession(renewed.token), { authenticated: false, email: null, phone: null, products: { 'module-01': { trialUsed: false, paid: false }, 'module-02': { trialUsed: false, paid: false } } });
      f.advance(7 * 24 * 60 * 60_000);
      assert.equal((await f.service.getSession(phoneLogin.token)).authenticated, false);
    });

    await t.test('database requires at least one identity, a canonical phone and unique phone ownership', async () => {
      const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'arviva_users'", [schema]);
      assert.ok(columns.rows.some(({ column_name }) => column_name === 'phone'));
      await assert.rejects(pool.query('INSERT INTO arviva_users(id, created_at) VALUES ($1, now())', [randomUUID()]), (error) => error.code === '23514');
      await assert.rejects(pool.query('INSERT INTO arviva_users(id, phone, created_at) VALUES ($1, $2, now())', [randomUUID(), '13800138000']), (error) => error.code === '23514');
      const f = fixture();
      await f.phoneLogin();
      await assert.rejects(pool.query('INSERT INTO arviva_users(id, phone, created_at) VALUES ($1, $2, now())', [randomUUID(), f.phone]), (error) => error.code === '23505');
    });
  } finally {
    if (pool) await pool.end();
    // The identifier is generated above and validated; never drop a supplied schema or public.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
