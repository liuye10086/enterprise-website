import assert from 'node:assert/strict';
import test from 'node:test';
import * as access from '../src/access-state.js';

const freshState = () => ({
  version: 1,
  signedIn: false,
  products: {
    'module-01': { trialUsed: false, paid: false },
    'module-02': { trialUsed: false, paid: false },
  },
});

function deepFreeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') deepFreeze(child);
  });
  return Object.freeze(value);
}

test('catalog preserves the two exact destinations and is immutable', () => {
  assert.deepEqual(access.PRODUCTS, [
    { id: 'module-01', number: '01', name: 'Research Platform', destination: 'Research Platform', url: '/research-platform' },
    { id: 'module-02', number: '02', name: 'Prediction Platform', destination: 'Prediction Platform', url: '/prediction-platform' },
  ]);
  assert.ok(Object.isFrozen(access.PRODUCTS));
  for (const product of access.PRODUCTS) assert.ok(Object.isFrozen(product));
});

test('new demo states begin signed out with fresh independent product records', () => {
  const first = access.createDemoState();
  const second = access.createDemoState();
  assert.deepEqual(first, freshState());
  first.products['module-01'].trialUsed = true;
  assert.deepEqual(second, freshState());
  assert.equal(first.products['module-02'].trialUsed, false);
});

test('normalization preserves only current-version literal true flags', () => {
  const raw = deepFreeze({
    version: 1,
    signedIn: true,
    email: 'private@example.com',
    code: '123456',
    products: {
      'module-01': { trialUsed: true, paid: 'true', email: 'private@example.com' },
      'module-02': { trialUsed: 1, paid: true, price: 100 },
      unknown: { trialUsed: true, paid: true },
    },
  });
  const normalized = access.normalizeDemoState(raw);
  assert.deepEqual(normalized, {
    version: 1,
    signedIn: true,
    products: {
      'module-01': { trialUsed: true, paid: false },
      'module-02': { trialUsed: false, paid: true },
    },
  });
  assert.notEqual(normalized, raw);
  assert.notEqual(normalized.products, raw.products);
  assert.notEqual(normalized.products['module-01'], raw.products['module-01']);
});

test('bad storage and unsupported versions recover to the initial state', () => {
  for (const raw of [null, undefined, false, 1, 'invalid JSON', [], {}, { version: 2, signedIn: true }, { version: '1', signedIn: true }]) {
    assert.deepEqual(access.normalizeDemoState(raw), freshState());
  }
});

test('partial current-version storage defaults missing and malformed flags safely', () => {
  for (const raw of [
    { version: 1, signedIn: 'true', products: null },
    { version: 1, signedIn: 1, products: [] },
    { version: 1, products: { 'module-01': true, 'module-02': { paid: 'yes' } } },
  ]) {
    assert.deepEqual(access.normalizeDemoState(raw), freshState());
  }
});

test('unknown or inherited stored properties cannot grant access', () => {
  const inherited = Object.create({ version: 1, signedIn: true, products: { 'module-01': { paid: true } } });
  assert.deepEqual(access.normalizeDemoState(inherited), freshState());
  const productFlags = Object.create({ paid: true, trialUsed: true });
  const raw = { version: 1, products: { 'module-01': productFlags } };
  assert.deepEqual(access.normalizeDemoState(raw), freshState());
});

test('signed-out access takes priority over retained paid eligibility', () => {
  const state = freshState();
  state.products['module-01'].paid = true;
  assert.equal(access.getProductAccess(state, 'module-01'), 'signed-out');
  assert.equal(access.getProductAccess(state, 'module-02'), 'signed-out');
});

test('signing in makes both unused trials available', () => {
  const state = access.signInDemo(freshState());
  assert.deepEqual(state, { ...freshState(), signedIn: true });
  assert.equal(access.getProductAccess(state, 'module-01'), 'trial-available');
  assert.equal(access.getProductAccess(state, 'module-02'), 'trial-available');
});

test('signed-out users cannot consume trials or activate products', () => {
  const state = deepFreeze(freshState());
  for (const id of ['module-01', 'module-02']) {
    assert.throws(() => access.consumeTrial(state, id), Error);
    assert.throws(() => access.activateDemoProduct(state, id), Error);
  }
  assert.deepEqual(state, freshState());
});

test('each product has exactly one trial independent of the other product', () => {
  const original = { ...freshState(), signedIn: true };
  const firstUsed = access.consumeTrial(original, 'module-01');
  assert.deepEqual(firstUsed, {
    ...original,
    products: {
      'module-01': { trialUsed: true, paid: false },
      'module-02': { trialUsed: false, paid: false },
    },
  });
  assert.equal(access.getProductAccess(firstUsed, 'module-01'), 'trial-used');
  assert.equal(access.getProductAccess(firstUsed, 'module-02'), 'trial-available');
  assert.throws(() => access.consumeTrial(firstUsed, 'module-01'), Error);
  const bothUsed = access.consumeTrial(firstUsed, 'module-02');
  assert.equal(access.getProductAccess(bothUsed, 'module-02'), 'trial-used');
  assert.throws(() => access.consumeTrial(bothUsed, 'module-02'), Error);
});

test('activating one product grants paid access without using either trial', () => {
  const state = { ...freshState(), signedIn: true };
  const paid = access.activateDemoProduct(state, 'module-01');
  assert.deepEqual(paid, {
    ...state,
    products: {
      'module-01': { trialUsed: false, paid: true },
      'module-02': { trialUsed: false, paid: false },
    },
  });
  assert.equal(access.getProductAccess(paid, 'module-01'), 'paid');
  assert.equal(access.getProductAccess(paid, 'module-02'), 'trial-available');
  assert.throws(() => access.consumeTrial(paid, 'module-01'), Error);
});

test('paid access supersedes an already-used trial without resetting it', () => {
  const state = { ...freshState(), signedIn: true };
  state.products['module-02'].trialUsed = true;
  const paid = access.activateDemoProduct(state, 'module-02');
  assert.equal(access.getProductAccess(paid, 'module-02'), 'paid');
  assert.equal(paid.products['module-02'].trialUsed, true);
});

test('logout and later login preserve used trials and paid products', () => {
  const state = { ...freshState(), signedIn: true };
  state.products['module-01'].trialUsed = true;
  state.products['module-02'].paid = true;
  const signedOut = access.signOutDemo(state);
  assert.deepEqual(signedOut, { ...state, signedIn: false });
  assert.equal(access.getProductAccess(signedOut, 'module-01'), 'signed-out');
  assert.equal(access.getProductAccess(signedOut, 'module-02'), 'signed-out');
  const signedIn = access.signInDemo(signedOut);
  assert.equal(access.getProductAccess(signedIn, 'module-01'), 'trial-used');
  assert.equal(access.getProductAccess(signedIn, 'module-02'), 'paid');
});

test('all product operations reject unknown IDs, including prototype names', () => {
  const state = { ...freshState(), signedIn: true };
  for (const id of ['module-03', '', '__proto__', 'constructor', undefined, null, 1]) {
    for (const operation of [access.getProductAccess, access.consumeTrial, access.activateDemoProduct]) {
      assert.throws(() => operation(state, id), Error);
    }
  }
});

test('every state transition leaves frozen input intact and returns independent records', () => {
  const state = deepFreeze({ ...freshState(), signedIn: true });
  const snapshot = structuredClone(state);
  const transitions = [
    access.signInDemo(state),
    access.signOutDemo(state),
    access.consumeTrial(state, 'module-01'),
    access.activateDemoProduct(state, 'module-02'),
  ];
  assert.ok(transitions.every(Boolean));
  for (const result of transitions) {
    assert.notEqual(result, state);
    assert.notEqual(result.products, state.products);
    for (const id of ['module-01', 'module-02']) {
      assert.notEqual(result.products[id], state.products[id]);
    }
  }
  assert.deepEqual(state, snapshot);
});
