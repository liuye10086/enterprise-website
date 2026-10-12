import test from 'node:test';
import assert from 'node:assert/strict';

import * as i18n from '../src/i18n.js';

test('English is the default and only the two supported language choices persist', () => {
  assert.equal(i18n.readPreferredLocale({ getItem: () => null }), 'en');
  assert.equal(i18n.readPreferredLocale({ getItem: () => 'zh-CN' }), 'zh-CN');
  assert.equal(i18n.readPreferredLocale({ getItem: () => 'fr' }), 'en');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(i18n.readPreferredLocale(blocked), 'en');
  assert.equal(i18n.writePreferredLocale(blocked, 'zh-CN'), false);
  const writes = [];
  assert.equal(i18n.writePreferredLocale({ setItem: (...args) => writes.push(args) }, 'zh-CN'), true);
  assert.deepEqual(writes, [['arviva.language', 'zh-CN']]);
});

test('localization preserves surrounding whitespace, unknown content and user identities', () => {
  assert.equal(i18n.translateText('  Home Page\n', 'zh-CN'), '  首页\n');
  assert.equal(i18n.translateText('Home Page', 'en'), 'Home Page');
  assert.equal(i18n.translateText('someone+tag@example.com', 'zh-CN'), 'someone+tag@example.com');
  assert.equal(i18n.translateText('+8613800138000', 'zh-CN'), '+8613800138000');
  assert.equal(i18n.translateText('A new user message', 'zh-CN'), 'A new user message');
  assert.equal(i18n.translateText('Research Platform', 'zh-CN'), '研究平台');
});

test('switching back restores exact source text and late status updates become the new source', () => {
  assert.equal(typeof i18n.createTranslationCache, 'function');
  const resolve = i18n.createTranslationCache();
  const node = {};
  const chinese = resolve(node, 'text', '\nHome Page  ', 'zh-CN');
  assert.equal(chinese, '\n首页  ');
  assert.equal(resolve(node, 'text', chinese, 'zh-CN'), chinese);
  assert.equal(resolve(node, 'text', chinese, 'en'), '\nHome Page  ');
  const next = resolve(node, 'text', 'Log in', 'zh-CN');
  assert.equal(next, '登录');
  assert.equal(resolve(node, 'text', next, 'en'), 'Log in');
  assert.equal(resolve(node, 'title', 'Home Page', 'zh-CN'), '首页');
  assert.equal(resolve(node, 'text', 'Log in', 'en'), 'Log in');
});

test('dynamic countdowns and account messages retain their variables and restore on language change', () => {
  const resolve = i18n.createTranslationCache();
  const status = {};
  assert.equal(resolve(status, 'text', 'Resend in 60s', 'zh-CN'), '60 秒后重发');
  const next = resolve(status, 'text', 'Resend in 59s', 'zh-CN');
  assert.equal(next, '59 秒后重发');
  assert.equal(resolve(status, 'text', next, 'en'), 'Resend in 59s');
  assert.equal(i18n.translateText('Account: someone+tag@example.com', 'zh-CN'), '账户：someone+tag@example.com');
  assert.equal(i18n.translateText('Signed in as 138****8000', 'zh-CN'), '已登录：138****8000');
});
