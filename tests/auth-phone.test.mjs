import test from 'node:test';
import assert from 'node:assert/strict';
import * as auth from '../server/auth-service.mjs';

test('normalizes mainland mobile numbers to one +86 identity', () => {
  assert.equal(typeof auth.normalizePhone, 'function');
  for (const value of ['13800138000', '+8613800138000', '008613800138000', ' 138 0013 8000 ', '+86 138 0013 8000', '0086 13800138000', '\u00a013800138000\u00a0']) {
    assert.equal(auth.normalizePhone(value), '+8613800138000');
  }
});

test('rejects unsupported countries, landlines, control characters and malformed phones', () => {
  assert.equal(typeof auth.normalizePhone, 'function');
  for (const value of [null, undefined, 13800138000, '', '+1 13800138000', '+852 13800138000', '8613800138000', '1380013800', '138001380000', '12800138000', '01012345678', '138-0013-8000', '+86+13800138000', '138\n00138000', '138\t00138000', '13800138000\u0000', '13800138000\n', '13800138000\r', '13800138000\u2028', '１３８００１３８０００']) {
    assert.throws(() => auth.normalizePhone(value), (error) => error.status === 400 && error.code === 'INVALID_PHONE');
  }
});

test('SMS daily budget must be a positive integer', () => {
  const options = { pool: { connect() {} }, secret: 'phone-unit-test-secret-at-least-32-characters', sendCode() {} };
  for (const smsDailyLimit of [0, -1, 1.5, Infinity, '100', null]) {
    assert.throws(() => auth.createAuthService({ ...options, smsDailyLimit }), /SMS daily limit/);
  }
});
