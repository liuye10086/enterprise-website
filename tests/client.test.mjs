import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailDraft } from '../src/main.js';
import * as client from '../src/main.js';

test('email draft preserves a message without injecting URL parameters', () => {
  const draft = createEmailDraft({name:'Jane & Co',email:'jane@example.com',subject:'R&D? next=1',message:'Hello\nA + B & C'});
  const url = new URL(draft);
  assert.equal(url.pathname,'BD@arvivatherap.com');
  assert.equal(url.searchParams.get('subject'),'R&D? next=1');
  assert.equal(url.searchParams.get('body'),'Name: Jane & Co\nEmail: jane@example.com\n\nHello\nA + B & C');
  assert.equal([...url.searchParams].length,2);
});
test('blank values and malformed emails never create an email draft', () => {
  const valid={name:'Jane',email:'jane@example.com',subject:'Hello',message:'Message'};
  for(const key of Object.keys(valid)) assert.throws(()=>createEmailDraft({...valid,[key]:'  '}));
  assert.throws(()=>createEmailDraft({...valid,email:'broken@'}));
  assert.throws(()=>createEmailDraft({...valid,email:'jane@example.com\nBcc:evil@example.com'}));
});

function navigationFixture() {
  const listeners = new Map();
  const element = () => {
    const attributes = new Map([['aria-expanded', 'false']]);
    const classes = new Set();
    const events = new Map();
    return {
      addEventListener: (name, handler) => events.set(name, handler),
      dispatch: (name, event = {}) => events.get(name)?.(event),
      getAttribute: name => attributes.get(name),
      setAttribute: (name, value) => attributes.set(name, value),
      classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) },
      contains(target) { return target === this; },
      focus() { this.focused = true; },
    };
  };
  const menu = element();
  const nav = element();
  const firstMoreLink = element();
  nav.querySelector = () => firstMoreLink;
  const desktop = element();
  const root = {
    querySelector: selector => selector === '.menu-toggle' ? menu : nav,
    addEventListener: (name, handler) => listeners.set(name, handler),
    dispatch: (name, event) => listeners.get(name)?.(event),
  };
  client.initializeNavigation(root, desktop);
  return { menu, nav, root, desktop, firstMoreLink };
}

test('navigation closes after an outside click but stays open for clicks within the menu', () => {
  const { menu, nav, root } = navigationFixture();
  menu.dispatch('click');
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  root.dispatch('click', { target: nav });
  assert.equal(nav.classList.contains('is-open'), true);
  root.dispatch('click', { target: {} });
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.getAttribute('aria-label'), 'Show more pages');
  assert.equal(nav.classList.contains('is-open'), false);
});

test('navigation resets on the desktop breakpoint without unexpectedly moving focus', () => {
  const { menu, nav, desktop } = navigationFixture();
  menu.dispatch('click');
  desktop.dispatch('change', { matches: false });
  assert.equal(nav.classList.contains('is-open'), true);
  desktop.dispatch('change', { matches: true });
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(nav.classList.contains('is-open'), false);
  assert.equal(menu.focused, undefined);
});

test('Escape returns focus to the menu and following a navigation link closes it', () => {
  const { menu, nav, root } = navigationFixture();
  menu.dispatch('click');
  root.dispatch('keydown', { key: 'Escape' });
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.focused, true);
  menu.dispatch('click');
  nav.dispatch('click', { target: { closest: () => ({}) } });
  assert.equal(nav.classList.contains('is-open'), false);
});

test('keyboard opening More reaches the first additional page, while pointer opening keeps focus', () => {
  const { menu, nav, firstMoreLink, root } = navigationFixture();
  menu.dispatch('click', { detail: 1 });
  assert.equal(firstMoreLink.focused, undefined);
  root.dispatch('keydown', { key: 'Escape' });
  menu.dispatch('click', { detail: 0 });
  assert.equal(nav.classList.contains('is-open'), true);
  assert.equal(menu.getAttribute('aria-label'), 'Hide more pages');
  assert.equal(firstMoreLink.focused, true);
  root.dispatch('keydown', { key: 'Escape' });
  assert.equal(menu.focused, true);
});
