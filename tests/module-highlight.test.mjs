import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/main.js';

function fixture(hash = '#research-platform') {
  const classes = new Set();
  const events = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const card = { id: 'research-platform', scrolls: [],
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    scrollIntoView: options => card.scrolls.push(options),
  };
  const root = { querySelectorAll: () => [card] };
  const browser = {
    location: { hash },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: name => events.delete(name),
  };
  assert.equal(typeof client.initializeModuleHighlight, 'function');
  const stop = client.initializeModuleHighlight(root, browser);
  return { classes, card, timers, browser, stop, dispatch: (name, event = {}) => events.get(name)?.(event) };
}

test('research anchor scrolls to its module and clears the highlight after three seconds', () => {
  const ui = fixture();
  assert.equal(ui.classes.has('is-highlighted'), true);
  assert.deepEqual(ui.card.scrolls, [{ behavior: 'instant', block: 'start' }]);
  assert.equal(ui.timers.size, 1);
  const timer = [...ui.timers.values()][0];
  assert.equal(timer.delay, 3000);
  timer.callback();
  assert.equal(ui.classes.has('is-highlighted'), false);
});

test('ordinary visits and unknown fragments do not scroll or highlight a product', () => {
  for (const hash of ['', '#unknown', '#module-01-title']) {
    const ui = fixture(hash);
    assert.equal(ui.classes.size, 0);
    assert.equal(ui.card.scrolls.length, 0);
    assert.equal(ui.timers.size, 0);
  }
});

test('changing anchors and restoring a cached page restart a single highlight timer', () => {
  const ui = fixture('');
  ui.browser.location.hash = '#research-platform';
  ui.dispatch('hashchange');
  assert.equal(ui.classes.has('is-highlighted'), true);
  ui.dispatch('pageshow', { persisted: false });
  assert.equal(ui.card.scrolls.length, 1);
  ui.dispatch('pagehide');
  assert.equal(ui.classes.size, 0);
  assert.equal(ui.timers.size, 0);
  ui.dispatch('pageshow', { persisted: true });
  assert.equal(ui.classes.has('is-highlighted'), true);
  assert.equal(ui.timers.size, 1);
  ui.browser.location.hash = '';
  ui.dispatch('hashchange');
  assert.equal(ui.classes.size, 0);
  assert.equal(ui.timers.size, 0);
  ui.stop();
  ui.browser.location.hash = '#research-platform';
  ui.dispatch('hashchange');
  assert.equal(ui.timers.size, 0);
});
