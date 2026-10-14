import test from 'node:test';
import assert from 'node:assert/strict';

import * as account from '../src/account-trigger.js';

test('account initials use the first letter or digit of the account label', () => {
  assert.equal(typeof account.accountInitial, 'function');
  for (const [label, initial] of [['alice@example.com', 'A'], ['2454205038@qq.com', '2'], ['138****8000', '1'], ['_john@example.com', 'J'], ['Demo account', 'D'], ['', '']]) {
    assert.equal(account.accountInitial(label), initial);
  }
});

test('account entry keeps an accessible identity and clears the initial on sign-out', () => {
  assert.equal(typeof account.updateAccountTrigger, 'function');
  const initial = { textContent: '', hidden: true };
  const iconAttributes = new Set();
  const icon = { toggleAttribute: (name, enabled) => enabled ? iconAttributes.add(name) : iconAttributes.delete(name) };
  const label = { textContent: 'Log in' };
  const attributes = new Map();
  const button = {
    querySelector: selector => ({ '[data-account-initial]': initial, '[data-account-icon]': icon, '[data-login-label]': label })[selector],
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const root = { querySelectorAll: () => [button] };
  account.updateAccountTrigger(root, '2454205038@qq.com');
  assert.equal(initial.textContent, '2');
  assert.equal(initial.hidden, false);
  assert.equal(iconAttributes.has('hidden'), true);
  assert.equal(label.textContent, 'Account: 2454205038@qq.com');
  assert.equal(attributes.get('aria-label'), label.textContent);
  account.updateAccountTrigger(root, '138****8000');
  assert.equal(initial.textContent, '1');
  assert.equal(attributes.get('title'), 'Account: 138****8000');
  account.updateAccountTrigger(root);
  assert.equal(initial.textContent, '');
  assert.equal(initial.hidden, true);
  assert.equal(iconAttributes.has('hidden'), false);
  assert.equal(attributes.get('aria-label'), 'Log in');
  assert.equal(label.textContent, 'Log in');
});
