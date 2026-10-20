import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../src/research-demo.html', import.meta.url), 'utf8');
function fixture({ origin = 'http://127.0.0.1:4173', search = '', lang = 'en' } = {}) {
  const script = html.match(/<script id="research-popup-script">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'the standalone page must implement the actual popup controller');
  const timers = new Map(); const navigations = []; let timerId = 0;
  const nodes = new Map(); let document;
  function node(id) {
    const listeners = new Map(); const attributes = new Map();
    const element = { id, open: false, hidden: false, style: {}, contentWindow: {},
      addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
      dispatch(type, extra = {}) { const event = { target: element, preventDefault() {}, ...extra }; for (const fn of listeners.get(type) || []) fn(event); },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); if (name === 'src') element.src = ''; },
      focus() { document.activeElement = element; },
      showModal() { element.open = true; },
      close() { element.open = false; element.dispatch('close'); },
    };
    nodes.set(id, element); return element;
  }
  for (const id of ['research-start', 'research-access-dialog', 'research-access-close', 'research-access-frame', 'research-access-loading', 'research-access-error', 'research-access-retry']) node(id);
  document = node('document');
  document.documentElement = { lang }; document.body = { style: { overflow: 'auto' } };
  document.getElementById = id => nodes.get(id);
  const browser = node('window');
  const location = { origin, hostname: new URL(origin).hostname, search, assign(path) { navigations.push(path); } };
  Object.assign(browser, { location });
  runInNewContext(script, { document, window: browser, location, URLSearchParams,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const frame = nodes.get('research-access-frame');
  const message = (data, overrides = {}) => browser.dispatch('message', { origin: new URL(frame.src || origin).origin, source: frame.contentWindow, data, ...overrides });
  return { nodes, document, browser, frame, timers, navigations, message, start: nodes.get('research-start'), dialog: nodes.get('research-access-dialog') };
}

test('Start research belongs inside the research card and is a dialog button, not a navigation link', () => {
  const card = html.match(/<article class="platform research">([\s\S]*?)<\/article>/)?.[1];
  assert.match(card, /<button[^>]*id="research-start"[^>]*aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /<a[^>]*id="research-start"/);
});

test('opening stays on the page and loads only the fixed origin with a supported language', () => {
  for (const origin of ['http://127.0.0.1:4173', 'https://research.arvivatherap.com']) {
    const ui = fixture({ origin, lang: 'zh-CN', search: '?next=https://attacker.example&paid=true' });
    ui.start.dispatch('click');
    assert.equal(ui.dialog.open, true);
    assert.deepEqual(ui.navigations, []);
    assert.equal(ui.document.body.style.overflow, 'hidden');
    assert.equal(ui.frame.src, `${origin.startsWith('http:') ? origin : 'https://new.arvivatherap.com'}/research-entry?lang=zh-CN`);
    assert.equal(ui.frame.hidden, true);
    ui.message({ type: 'arviva-research', action: 'ready' });
    assert.equal(ui.frame.hidden, false);
    assert.equal(ui.nodes.get('research-access-loading').hidden, true);
    assert.equal(ui.timers.size, 0);
  }
});

test('messages require matching source and origin; navigation is restricted to two exact destinations', () => {
  const ui = fixture({ origin: 'https://research.arvivatherap.com' }); ui.start.dispatch('click');
  const upgrade = { type: 'arviva-research', action: 'navigate', path: '/plans?product=module-01' };
  ui.message(upgrade, { origin: 'https://attacker.example' });
  ui.message(upgrade, { source: {} });
  ui.message({ ...upgrade, path: 'https://attacker.example' });
  ui.message({ ...upgrade, path: '//attacker.example' });
  ui.message({ ...upgrade, path: '/plans?product=module-02' });
  assert.deepEqual(ui.navigations, []);
  ui.message(upgrade);
  assert.deepEqual(ui.navigations, ['https://new.arvivatherap.com/plans?product=module-01']);
  ui.message({ ...upgrade, path: '/research-workspace' });
  assert.equal(ui.navigations[1], 'https://new.arvivatherap.com/research-workspace');
});

test('close restores scrolling/focus and ignores late messages; reopening reloads access', () => {
  const ui = fixture(); ui.start.dispatch('click');
  ui.nodes.get('research-access-close').dispatch('click');
  assert.equal(ui.dialog.open, false); assert.equal(ui.frame.src, '');
  assert.equal(ui.document.body.style.overflow, 'auto'); assert.equal(ui.document.activeElement, ui.start);
  assert.equal(ui.timers.size, 0);
  ui.message({ type: 'arviva-research', action: 'navigate', path: '/research-workspace' });
  assert.deepEqual(ui.navigations, []);
  ui.start.dispatch('click'); assert.match(ui.frame.src, /\/research-entry\?lang=en$/);
  ui.message({ type: 'arviva-research', action: 'close' });
  assert.equal(ui.dialog.open, false);
});

test('a blocked or failed frame offers retry without consuming trial or navigating away', () => {
  const ui = fixture(); ui.start.dispatch('click');
  for (const fn of [...ui.timers.values()]) fn();
  assert.equal(ui.nodes.get('research-access-error').hidden, false);
  assert.equal(ui.frame.hidden, true); assert.deepEqual(ui.navigations, []);
  ui.nodes.get('research-access-retry').dispatch('click');
  assert.equal(ui.nodes.get('research-access-error').hidden, true);
  ui.message({ type: 'arviva-research', action: 'ready' });
  assert.equal(ui.frame.hidden, false);
});

test('Prediction does not attach a research popup action', () => {
  for (const options of [{ origin: 'https://thesis.arvivatherap.com' }, { search: '?platform=prediction' }]) {
    const ui = fixture(options); ui.start.dispatch('click');
    assert.equal(ui.dialog.open, false); assert.equal(ui.frame.src, undefined); assert.deepEqual(ui.navigations, []);
  }
});
