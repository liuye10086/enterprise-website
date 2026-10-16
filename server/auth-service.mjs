import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PRODUCTS, getProductProductionUrl } from '../src/access-state.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CODE_LIFETIME = 10 * MINUTE;
const SESSION_LIFETIME = 7 * 24 * HOUR;
const PRODUCT_IDS = PRODUCTS.map(({ id }) => id);
// SQL identifiers below come only from this internal, fixed channel map.
const CHANNELS = {
  email: { identity: 'email', digest: 'email_digest', table: 'arviva_verification_challenges' },
  phone: { identity: 'phone', digest: 'phone_digest', table: 'arviva_phone_verification_challenges' },
};

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

export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^[+0-9 \u00a0]+$/.test(value)) {
    throw authError(400, 'INVALID_PHONE', 'Enter a valid mainland China mobile number.');
  }
  const match = /^(?:\+86|0086)?(1[3-9]\d{9})$/.exec(value.replace(/[ \u00a0]/g, ''));
  if (!match) throw authError(400, 'INVALID_PHONE', 'Enter a valid mainland China mobile number.');
  return `+86${match[1]}`;
}

function freshProducts() {
  return Object.fromEntries(PRODUCT_IDS.map((id) => [id, { trialUsed: false, paid: false }]));
}

function signedOut() {
  return { authenticated: false, email: null, phone: null, profileComplete: null, products: freshProducts() };
}

function normalizeProfile(raw) {
  const editable = ['fullName', 'contactPhone', 'organization', 'researchArea'];
  const allowed = [...editable, 'expectedEmail'];
  const invalid = () => authError(400, 'invalid_profile', 'Enter your name and a valid contact phone number. Check the length of each field.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !allowed.includes(key))) throw invalid();
  const result = {};
  for (const field of editable) {
    const value = raw[field] ?? '';
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) throw invalid();
    result[field] = value.trim();
    const limit = field === 'fullName' ? 100 : field === 'contactPhone' ? 32 : 200;
    if ([...result[field]].length > limit) throw invalid();
  }
  const digits = result.contactPhone.replace(/\D/g, '').length;
  if (!result.fullName || !/^\+?[0-9 ()-]+$/.test(result.contactPhone) || digits < 7 || digits > 15) throw invalid();
  return result;
}

function profileView(email, row) {
  return {
    profile: {
      fullName: row?.full_name ?? '', email, contactPhone: row?.contact_phone ?? '',
      organization: row?.organization ?? '', researchArea: row?.research_area ?? '',
      submittedAt: row?.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    },
    complete: Boolean(row?.full_name && row?.contact_phone),
  };
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

export function createAuthService({ pool, secret, sendCode, sendSmsCode, smsDailyLimit = 100, now = Date.now }) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required.');
  if (typeof secret !== 'string' || secret.length < 32) throw new TypeError('The authentication secret must contain at least 32 characters.');
  if (typeof sendCode !== 'function') throw new TypeError('A code delivery function is required.');
  if (sendSmsCode !== undefined && typeof sendSmsCode !== 'function') throw new TypeError('SMS code delivery must be a function.');
  if (!Number.isSafeInteger(smsDailyLimit) || smsDailyLimit < 1) throw new TypeError('SMS daily limit must be a positive integer.');

  const timestamp = () => {
    const date = new Date(now());
    if (!Number.isFinite(date.getTime())) throw new TypeError('The authentication clock must return a valid time.');
    return date;
  };
  const hmac = (purpose, value) => createHmac('sha256', secret).update(`${purpose}\0${value}`).digest('hex');
  // Preserve old email digests so codes delivered before migration still work.
  const codeDigest = (channel, identity, code) => hmac(channel === 'email' ? 'otp' : 'otp-phone', `${identity}\0${code}`);
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
    // first requests, for which an identity/challenge row does not exist yet.
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

  async function profileCompleteFor(client, user) {
    if (!user.email) return null;
    const result = await client.query('SELECT 1 FROM arviva_user_profiles WHERE user_id = $1', [user.id ?? user.user_id]);
    return result.rowCount > 0;
  }

  async function recordEvent(client, kind, channel, identityDigest, ipDigest, at) {
    await client.query('INSERT INTO arviva_auth_events (id, kind, email_digest, phone_digest, ip_digest, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), kind, channel === 'email' ? identityDigest : null, channel === 'phone' ? identityDigest : null, ipDigest, at]);
  }

  async function requestVerificationCode(channel, identity, ip) {
    const { identity: column, digest, table } = CHANNELS[channel];
    const deliver = channel === 'email' ? sendCode : sendSmsCode;
    const deliveryError = () => channel === 'email'
      ? authError(503, 'MAIL_UNAVAILABLE', 'The verification email could not be sent. Please try again later.')
      : authError(503, 'SMS_UNAVAILABLE', 'The verification text message could not be sent. Please try again later.');
    if (!deliver) throw deliveryError();
    const identityDigest = hmac(channel, identity);
    const ipDigest = sourceDigest(ip);
    const challengeId = randomUUID();
    let code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await transaction(async (client) => {
      const subjects = [`send-${channel}:${identityDigest}`, `send-ip:${ipDigest}`];
      if (channel === 'phone') subjects.push('send-sms-budget');
      await lockSubjects(client, subjects);
      const at = timestamp();
      const recent = await client.query(`
        SELECT count(*) FILTER (WHERE ${digest} = $1)::int AS identity_count,
               count(*) FILTER (WHERE ip_digest = $2)::int AS ip_count,
               max(created_at) FILTER (WHERE ${digest} = $1) AS last_identity
        FROM arviva_auth_events
        WHERE kind = 'send' AND created_at > $3 AND (${digest} = $1 OR ip_digest = $2)
      `, [identityDigest, ipDigest, new Date(at.getTime() - HOUR)]);
      const limits = recent.rows[0];
      if (limits.identity_count >= 5 || limits.ip_count >= 30 || (limits.last_identity && at.getTime() - new Date(limits.last_identity).getTime() < MINUTE)) throw rateLimited();
      if (channel === 'phone') {
        const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
        const dayEnd = new Date(dayStart.getTime() + 24 * HOUR);
        const budget = await client.query("SELECT count(*)::int AS count FROM arviva_auth_events WHERE kind = 'send' AND phone_digest IS NOT NULL AND created_at >= $1 AND created_at < $2", [dayStart, dayEnd]);
        if (budget.rows[0].count >= smsDailyLimit) throw rateLimited();
      }
      const previous = (await client.query(`SELECT code_digest FROM ${table} WHERE ${column} = $1 FOR UPDATE`, [identity])).rows[0];
      // A resend must not accidentally reproduce the immediately previous code.
      while (previous?.code_digest === codeDigest(channel, identity, code)) code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      await recordEvent(client, 'send', channel, identityDigest, ipDigest, at);
      await client.query(`
        INSERT INTO ${table}
          (${column}, challenge_id, code_digest, status, attempts, requested_at, expires_at, delivered_at)
        VALUES ($1, $2, $3, 'pending', 0, $4, $5, NULL)
        ON CONFLICT (${column}) DO UPDATE SET
          challenge_id = EXCLUDED.challenge_id, code_digest = EXCLUDED.code_digest,
          status = 'pending', attempts = 0, requested_at = EXCLUDED.requested_at,
          expires_at = EXCLUDED.expires_at, delivered_at = NULL
      `, [identity, challengeId, codeDigest(channel, identity, code), at, new Date(at.getTime() + CODE_LIFETIME)]);
    });

    try {
      await deliver({ [column]: identity, code, expiresMinutes: 10 });
    } catch {
      // Reservations and cooldowns remain committed when delivery fails, so
      // retries cannot bypass rate limits or the global SMS spend ceiling.
      await pool.query(`UPDATE ${table} SET status = 'failed' WHERE ${column} = $1 AND challenge_id = $2 AND status = 'pending'`, [identity, challengeId]);
      throw deliveryError();
    }
    const deliveredAt = timestamp();
    const activated = await pool.query(`
      UPDATE ${table} SET status = 'sent', delivered_at = $3, expires_at = $4
      WHERE ${column} = $1 AND challenge_id = $2 AND status = 'pending'
    `, [identity, challengeId, deliveredAt, new Date(deliveredAt.getTime() + CODE_LIFETIME)]);
    if (activated.rowCount !== 1) throw authError(409, 'CODE_SUPERSEDED', 'A newer verification code was requested. Use the code from that request.');
    return { message: channel === 'email' ? 'A verification code has been sent. Check your inbox.' : 'A verification code has been sent to your phone.', retryAfterSeconds: 60 };
  }

  async function verifyVerificationCode(channel, identity, rawCode, ip) {
    const { identity: column, table } = CHANNELS[channel];
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    const identityDigest = hmac(channel, identity);
    const ipDigest = sourceDigest(ip);
    return transaction(async (client) => {
      await lockSubjects(client, [`verify-ip:${ipDigest}`]);
      const requestedAt = timestamp();
      const recent = await client.query("SELECT count(*)::int AS count FROM arviva_auth_events WHERE kind = 'verify' AND ip_digest = $1 AND created_at > $2", [ipDigest, new Date(requestedAt.getTime() - HOUR)]);
      if (recent.rows[0].count >= 60) return rateLimited();
      await recordEvent(client, 'verify', channel, identityDigest, ipDigest, requestedAt);
      const challenge = (await client.query(`SELECT * FROM ${table} WHERE ${column} = $1 FOR UPDATE`, [identity])).rows[0];
      const at = timestamp();
      if (!challenge || challenge.status !== 'sent' || new Date(challenge.expires_at).getTime() <= at.getTime() || challenge.attempts >= 5) return invalidCode();
      const supplied = Buffer.from(codeDigest(channel, identity, code), 'hex');
      const expected = Buffer.from(challenge.code_digest, 'hex');
      if (!/^\d{6}$/.test(code) || !timingSafeEqual(supplied, expected)) {
        await client.query(`UPDATE ${table} SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'consumed' ELSE status END WHERE ${column} = $1`, [identity]);
        return invalidCode();
      }
      await client.query(`UPDATE ${table} SET status = 'consumed' WHERE ${column} = $1`, [identity]);
      const user = (await client.query(`
        INSERT INTO arviva_users (id, ${column}, created_at) VALUES ($1, $2, $3)
        ON CONFLICT (${column}) DO UPDATE SET ${column} = EXCLUDED.${column} RETURNING id, email, phone
      `, [randomUUID(), identity, at])).rows[0];
      for (const productId of PRODUCT_IDS) {
        await client.query('INSERT INTO arviva_product_entitlements (user_id, product_id) VALUES ($1, $2) ON CONFLICT (user_id, product_id) DO NOTHING', [user.id, productId]);
      }
      const token = randomBytes(32).toString('hex');
      await client.query('INSERT INTO arviva_sessions (token_digest, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [sessionDigest(token), user.id, at, new Date(at.getTime() + SESSION_LIFETIME)]);
      return { token, email: user.email, phone: user.phone, profileComplete: await profileCompleteFor(client, user), products: await productsFor(client, user.id) };
    });
  }

  async function requestCode(rawEmail, ip) {
    return requestVerificationCode('email', normalizeEmail(rawEmail), ip);
  }

  async function verifyCode(rawEmail, rawCode, ip) {
    return verifyVerificationCode('email', normalizeEmail(rawEmail), rawCode, ip);
  }

  async function requestPhoneCode(rawPhone, ip) {
    return requestVerificationCode('phone', normalizePhone(rawPhone), ip);
  }

  async function verifyPhoneCode(rawPhone, rawCode, ip) {
    return verifyVerificationCode('phone', normalizePhone(rawPhone), rawCode, ip);
  }

  async function getSession(token) {
    const digest = sessionDigest(token);
    if (!digest) return signedOut();
    const session = (await pool.query(`
      SELECT s.user_id, u.email, u.phone FROM arviva_sessions s JOIN arviva_users u ON u.id = s.user_id
      WHERE s.token_digest = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
    `, [digest, timestamp()])).rows[0];
    return session ? { authenticated: true, email: session.email, phone: session.phone, profileComplete: await profileCompleteFor(pool, session), products: await productsFor(pool, session.user_id) } : signedOut();
  }

  async function profileAccount(client, token, lock = false) {
    const digest = sessionDigest(token);
    if (!digest) throw authError(401, 'AUTH_REQUIRED', 'Sign in to view your personal information.');
    const account = (await client.query(`
      SELECT s.user_id, s.expires_at, u.email FROM arviva_sessions s
      JOIN arviva_users u ON u.id = s.user_id
      WHERE s.token_digest = $1 AND s.revoked_at IS NULL
      ${lock ? 'FOR UPDATE OF s' : ''}
    `, [digest])).rows[0];
    // Check after acquiring the row lock so an expired session cannot save while waiting.
    if (!account || new Date(account.expires_at).getTime() <= timestamp().getTime()) throw authError(401, 'AUTH_REQUIRED', 'Sign in to view your personal information.');
    if (!account.email) throw authError(403, 'email_account_required', 'Personal information is available for email accounts.');
    return account;
  }

  async function getProfile(token) {
    const account = await profileAccount(pool, token);
    const row = (await pool.query('SELECT * FROM arviva_user_profiles WHERE user_id = $1', [account.user_id])).rows[0];
    return profileView(account.email, row);
  }

  async function saveProfile(token, raw) {
    return transaction(async client => {
      const account = await profileAccount(client, token, true);
      if (raw?.expectedEmail !== account.email) {
        throw authError(409, 'profile_account_changed', 'Your sign-in account has changed. Reload this page before saving your profile.');
      }
      const profile = normalizeProfile(raw);
      const at = timestamp();
      const row = (await client.query(`
        INSERT INTO arviva_user_profiles (user_id, full_name, contact_phone, organization, research_area, submitted_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (user_id) DO UPDATE SET
          full_name = EXCLUDED.full_name, contact_phone = EXCLUDED.contact_phone,
          organization = EXCLUDED.organization, research_area = EXCLUDED.research_area,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `, [account.user_id, profile.fullName, profile.contactPhone, profile.organization, profile.researchArea, at])).rows[0];
      return profileView(account.email, row);
    });
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
      // Expiration is checked after the lock. Historical eligibility records
      // are never consumed, created or changed by product entry.
      if (new Date(session.expires_at).getTime() <= timestamp().getTime()) return authError(401, 'AUTH_REQUIRED', 'Sign in to access this product.');
      return { url: getProductProductionUrl(productId) };
    });
  }

  async function canViewProduct(token, productId) {
    const digest = sessionDigest(token);
    if (!digest || !PRODUCT_IDS.includes(productId)) return false;
    const result = await pool.query(`
      SELECT 1 FROM arviva_sessions s
      WHERE s.token_digest = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
    `, [digest, timestamp()]);
    return result.rowCount > 0;
  }

  return { requestCode, verifyCode, requestPhoneCode, verifyPhoneCode, getSession, getProfile, saveProfile, logout, enterProduct, canViewProduct };
}
