import test from 'node:test';
import assert from 'node:assert/strict';
import { getCheckoutUrl, getCheckoutProduct, getPlanPrice, createCheckoutState, transitionCheckout } from '../src/checkout.js';

test('upgrade URLs preserve an allowlisted product, never a caller-supplied destination', () => {
  assert.equal(getCheckoutUrl('module-01'), '/plans?product=module-01');
  assert.equal(getCheckoutUrl('module-02'), '/plans?product=module-02');
  for (const id of ['', undefined, '__proto__', 'https://example.com']) assert.equal(getCheckoutUrl(id), null);
  assert.equal(getCheckoutProduct('?product=module-02').name, 'Prediction Platform');
  assert.equal(getCheckoutProduct('').id, 'module-01');
  assert.equal(getCheckoutProduct('?product=other'), null);
  assert.equal(getCheckoutProduct('?product='), null);
});

test('monthly display prices use the four supplied prices rather than currency conversion', () => {
  assert.equal(getPlanPrice('standard', 'en'), '$20');
  assert.equal(getPlanPrice('pro', 'en'), '$100');
  assert.equal(getPlanPrice('standard', 'zh-CN'), '¥140');
  assert.equal(getPlanPrice('pro', 'zh-CN'), '¥698');
  assert.equal(getPlanPrice('pro', 'fr'), '$100');
  assert.equal(getPlanPrice('unknown', 'en'), null);
});

test('plan and method selections survive going back without creating a payment or entitlement', () => {
  const initial = createCheckoutState('?product=module-02');
  assert.deepEqual(initial, { productId: 'module-02', plan: 'standard', method: 'alipay', step: 'plans' });
  const selected = transitionCheckout(initial, { type: 'select-plan', value: 'pro' });
  assert.equal(initial.plan, 'standard', 'does not mutate previous state');
  const payment = transitionCheckout(selected, { type: 'continue' });
  assert.equal(payment.step, 'payment');
  const wechat = transitionCheckout(payment, { type: 'select-method', value: 'wechat' });
  const back = transitionCheckout(wechat, { type: 'back' });
  assert.deepEqual(back, { productId: 'module-02', plan: 'pro', method: 'wechat', step: 'plans' });
  assert.equal(transitionCheckout(back, { type: 'continue' }).method, 'wechat');
  assert.equal(transitionCheckout(wechat, { type: 'paid' }), wechat, 'no simulated paid transition');
});

test('invalid products and selections cannot enter a misleading checkout state', () => {
  assert.equal(createCheckoutState('?product=unavailable'), null);
  assert.equal(transitionCheckout(null, { type: 'continue' }), null);
  const initial = createCheckoutState('');
  assert.equal(transitionCheckout(initial, { type: 'select-plan', value: '__proto__' }), initial);
  assert.equal(transitionCheckout(initial, { type: 'select-method', value: 'wechat' }), initial);
  const payment = transitionCheckout(initial, { type: 'continue' });
  assert.equal(transitionCheckout(payment, { type: 'select-method', value: 'card' }), payment);
  assert.equal(transitionCheckout(payment, { type: 'select-plan', value: 'pro' }), payment);
});
