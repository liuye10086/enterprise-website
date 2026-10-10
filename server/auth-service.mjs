import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PRODUCTS } from '../src/access-state.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CODE_LIFETIME = 10 * MINUTE;
const SESSION_LIFETIME = 7 * 24 * HOUR;
const GRANT_LIFETIME = 15 * MINUTE;
const PRODUCT_IDS = PRODUCTS.map(({ id }) => id);

function authError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function normalizeEmail(value) {
  if (typeof value !== 'string') throw authError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  const [local, domain] = parts;
  const localValid = local && local.length <= 64 && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local);
  const domainValid = domain && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain);
  if (email.length > 254 || parts.length !== 2 || !localValid || !domainValid) {
    throw authError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  }
  return email;
}

function freshProducts() {
  return Object.fromEntries(PRODUCT_IDS.map((id) => [id, { trialUsed: false, paid: false }]));
}

function signedOut() {
  return { authenticated: false, email: null, products: freshProducts() };
}

function sessionDigest(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
    ? createHash('sha256').update(token).digest('hex')
    : null;
}

function invalidCode() {
  return authError(400, 'INVALID_CODE', 'This code is invalid or expired. Request a new code and try again.');
}

function rateLimited() {
  return authError(429, 'RATE_LIMITED', 'Too many requests. Please wait before trying again.');
}

export function createAuthService({ pool, secret, sendCode, now = Date.now }) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required.');
  if (typeof secret !== 'string' || secret.length < 32) throw new TypeError('The authentication secret must contain at least 32 characters.');
  if (typeof sendCode !== 'function') throw new TypeError('A code delivery function is required.');

  const timestamp = () => {
    const date = new Date(now());
    if (!Number.isFinite(date.getTime())) throw new TypeError('The authentication clock must return a valid time.');
    return date;
  };
  const hmac = (purpose, value) => createHmac('sha256', secret).update(`${purpose}\0${value}`).digest('hex');
  const codeDigest = (email, code) => hmac('otp', `${email}\0${code}`);
  const sourceDigest = (ip) => hmac('ip', typeof ip === 'string' && ip ? ip : 'unknown');

  // All statements in a transaction run on its leased client. Business errors can
  // be returned so attempt/event writes commit before the caller sees the error.
  async function transaction(work) {
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    if (result instanceof Error) throw result;
    return result;
  }

  async function lockSubjects(client, subjects) {
    // Sorting gives every request the same lock order. Advisory locks also cover
    // first requests, for which an email/challenge row does not exist yet.
    const keys = [...new Set(subjects.map((subject) => createHash('sha256').update(subject).digest().readBigInt64BE(0).toString()))].sort();
    for (const key of keys) await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);
  }

  async function productsFor(client, userId) {
    const products = freshProducts();
    const result = await client.query('SELECT product_id, trial_used_at, paid FROM arviva_product_entitlements WHERE user_id = $1', [userId]);
    for (const row of result.rows) {
      if (Object.hasOwn(products, row.product_id)) products[row.product_id] = { trialUsed: row.trial_used_at !== null, paid: row.paid };
    }
    return products;
  }

  async function recordEvent(client, kind, emailDigest, ipDigest, at) {
    await client.query('INSERT INTO arviva_auth_events (id, kind, email_digest, ip_digest, created_at) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), kind, emailDigest, ipDigest, at]);
  }

  async function requestCode(rawEmail, ip) {
    const email = normalizeEmail(rawEmail);
    const emailDigest = hmac('email', email);
    const ipDigest = sourceDigest(ip);
    const challengeId = randomUUID();
    let code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await transaction(async (client) => {
      await lockSubjects(client, [`send-email:${emailDigest}`, `send-ip:${ipDigest}`]);
      const at = timestamp();
      const recent = await client.query(`
        SELECT count(*) FILTER (WHERE email_digest = $1)::int AS email_count,
               count(*) FILTER (WHERE ip_digest = $2)::int AS ip_count,
               max(created_at) FILTER (WHERE email_digest = $1) AS last_email
        FROM arviva_auth_events
        WHERE kind = 'send' AND created_at > $3 AND (email_digest = $1 OR ip_digest = $2)
      `, [emailDigest, ipDigest, new Date(at.getTime() - HOUR)]);
      const limits = recent.rows[0];
      if (limits.email_count >= 5 || limits.ip_count >= 30 || (limits.last_email && at.getTime() - new Date(limits.last_email).getTime() < MINUTE)) throw rateLimited();
      const previous = (await client.query('SELECT code_digest FROM arviva_verification_challenges WHERE email = $1 FOR UPDATE', [email])).rows[0];
      // A resend must not accidentally reproduce the immediately previous code.
      while (previous?.code_digest === codeDigest(email, code)) code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      await recordEvent(client, 'send', emailDigest, ipDigest, at);
      await client.query(`
        INSERT INTO arviva_verification_challenges
          (email, challenge_id, code_digest, status, attempts, requested_at, expires_at, delivered_at)
        VALUES ($1, $2, $3, 'pending', 0, $4, $5, NULL)
        ON CONFLICT (email) DO UPDATE SET
          challenge_id = EXCLUDED.challenge_id, code_digest = EXCLUDED.code_digest,
          status = 'pending', attempts = 0, requested_at = EXCLUDED.requested_at,
          expires_at = EXCLUDED.expires_at, delivered_at = NULL
      `, [email, challengeId, codeDigest(email, code), at, new Date(at.getTime() + CODE_LIFETIME)]);
    });

    try {
      await sendCode({ email, code, expiresMinutes: 10 });
    } catch {
      // The reservation and cooldown remain committed even when SMTP fails.
      await pool.query("UPDATE arviva_verification_challenges SET status = 'failed' WHERE email = $1 AND challenge_id = $2 AND status = 'pending'", [email, challengeId]);
      throw authError(503, 'MAIL_UNAVAILABLE', 'The verification email could not be sent. Please try again later.');
    }
    const deliveredAt = timestamp();
    const activated = await pool.query(`
      UPDATE arviva_verification_challenges SET status = 'sent', delivered_at = $3, expires_at = $4
      WHERE email = $1 AND challenge_id = $2 AND status = 'pending'
    `, [email, challengeId, deliveredAt, new Date(deliveredAt.getTime() + CODE_LIFETIME)]);
    if (activated.rowCount !== 1) throw authError(409, 'CODE_SUPERSEDED', 'A newer verification code was requested. Use the code from that request.');
    return { message: 'A verification code has been sent. Check your inbox.', retryAfterSeconds: 60 };
  }

  async function verifyCode(rawEmail, rawCode, ip) {
    const email = normalizeEmail(rawEmail);
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    const emailDigest = hmac('email', email);
    const ipDigest = sourceDigest(ip);
    return transaction(async (client) => {
      await lockSubjects(client, [`verify-ip:${ipDigest}`]);
      const requestedAt = timestamp();
      const recent = await client.query("SELECT count(*)::int AS count FROM arviva_auth_events WHERE kind = 'verify' AND ip_digest = $1 AND created_at > $2", [ipDigest, new Date(requestedAt.getTime() - HOUR)]);
      if (recent.rows[0].count >= 60) return rateLimited();
      await recordEvent(client, 'verify', emailDigest, ipDigest, requestedAt);
      const challenge = (await client.query('SELECT * FROM arviva_verification_challenges WHERE email = $1 FOR UPDATE', [email])).rows[0];
      const at = timestamp();
      if (!challenge || challenge.status !== 'sent' || new Date(challenge.expires_at).getTime() <= at.getTime() || challenge.attempts >= 5) return invalidCode();
      const supplied = Buffer.from(codeDigest(email, code), 'hex');
      const expected = Buffer.from(challenge.code_digest, 'hex');
      if (!/^\d{6}$/.test(code) || !timingSafeEqual(supplied, expected)) {
        await client.query("UPDATE arviva_verification_challenges SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'consumed' ELSE status END WHERE email = $1", [email]);
        return invalidCode();
      }
      await client.query("UPDATE arviva_verification_challenges SET status = 'consumed' WHERE email = $1", [email]);
      const user = (await client.query(`
        INSERT INTO arviva_users (id, email, created_at) VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id, email
      `, [randomUUID(), email, at])).rows[0];
      for (const productId of PRODUCT_IDS) {
        await client.query('INSERT INTO arviva_product_entitlements (user_id, product_id) VALUES ($1, $2) ON CONFLICT (user_id, product_id) DO NOTHING', [user.id, productId]);
      }
      const token = randomBytes(32).toString('hex');
      await client.query('INSERT INTO arviva_sessions (token_digest, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [sessionDigest(token), user.id, at, new Date(at.getTime() + SESSION_LIFETIME)]);
      return { token, email: user.email, products: await productsFor(client, user.id) };
    });
  }

  async function getSession(token) {
    const digest = sessionDigest(token);
    if (!digest) return signedOut();
    const session = (await pool.query(`
      SELECT s.user_id, u.email FROM arviva_sessions s JOIN arviva_users u ON u.id = s.user_id
      WHERE s.token_digest = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
    `, [digest, timestamp()])).rows[0];
    return session ? { authenticated: true, email: session.email, products: await productsFor(pool, session.user_id) } : signedOut();
  }

  async function logout(token) {
    const digest = sessionDigest(token);
    if (digest) await pool.query('UPDATE arviva_sessions SET revoked_at = $2 WHERE token_digest = $1 AND revoked_at IS NULL', [digest, timestamp()]);
    return { ok: true };
  }

  async function enterProduct(token, productId) {
    const product = PRODUCTS.find(({ id }) => id === productId);
    if (!product) throw authError(404, 'PRODUCT_NOT_FOUND', 'This product does not exist.');
    const digest = sessionDigest(token);
    if (!digest) throw authError(401, 'AUTH_REQUIRED', 'Sign in to access this product.');
    return transaction(async (client) => {
      const session = (await client.query(`
        SELECT user_id, expires_at FROM arviva_sessions
        WHERE token_digest = $1 AND revoked_at IS NULL FOR UPDATE
      `, [digest])).rows[0];
      if (!session) return authError(401, 'AUTH_REQUIRED', 'Sign in to access this product.');
      const entitlement = (await client.query('SELECT trial_used_at, paid FROM arviva_product_entitlements WHERE user_id = $1 AND product_id = $2 FOR UPDATE', [session.user_id, productId])).rows[0];
      const at = timestamp();
      if (new Date(session.expires_at).getTime() <= at.getTime()) return authError(401, 'AUTH_REQUIRED', 'Sign in to access this product.');
      if (!entitlement) return authError(403, 'ACCESS_DENIED', 'This product is not available for this account.');
      if (entitlement.paid) return { url: product.url };
      if (entitlement.trial_used_at !== null) return authError(403, 'TRIAL_USED', 'Your free trial for this product has already been used.');
      await client.query('UPDATE arviva_product_entitlements SET trial_used_at = $3 WHERE user_id = $1 AND product_id = $2', [session.user_id, productId, at]);
      await client.query(`
        INSERT INTO arviva_product_grants (token_digest, product_id, created_at, expires_at) VALUES ($1, $2, $3, $4)
        ON CONFLICT (token_digest, product_id) DO UPDATE SET created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at
      `, [digest, productId, at, new Date(at.getTime() + GRANT_LIFETIME)]);
      return { url: product.url };
    });
  }

  async function canViewProduct(token, productId) {
    const digest = sessionDigest(token);
    if (!digest || !PRODUCT_IDS.includes(productId)) return false;
    const result = await pool.query(`
      SELECT 1 FROM arviva_sessions s
      JOIN arviva_product_entitlements e ON e.user_id = s.user_id AND e.product_id = $2
      LEFT JOIN arviva_product_grants g ON g.token_digest = s.token_digest AND g.product_id = e.product_id
      WHERE s.token_digest = $1 AND s.revoked_at IS NULL AND s.expires_at > $3
        AND (e.paid = true OR g.expires_at > $3)
    `, [digest, productId, timestamp()]);
    return result.rowCount > 0;
  }

  return { requestCode, verifyCode, getSession, logout, enterProduct, canViewProduct };
}
