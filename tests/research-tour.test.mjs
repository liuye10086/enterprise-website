import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../src/research-demo.html', import.meta.url), 'utf8');

function tourController() {
  const source = html.match(/<script\b[^>]*\bid=["']research-tour-script["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(source?.trim(), 'research demo must provide the actual inline #research-tour-script controller');
  return source;
}

function fixture({ hostname = 'localhost', search = '', lang = 'en' } = {}) {
  const nodes = new Map();
  const scheduled = [];
  let document;
  function element(id, initial = {}) {
    const listeners = new Map();
    const attributes = new Map();
    const node = { id, hidden: false, disabled: false, open: false, isConnected: true, dataset: {}, style: {}, textContent: '',
      ...initial,
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      removeAttribute(name) { attributes.delete(name); },
      hasAttribute(name) { return attributes.has(name); },
      toggleAttribute(name, enabled) { if (enabled) attributes.set(name, ''); else attributes.delete(name); },
      addEventListener(name, listener) { listeners.set(name, [...(listeners.get(name) || []), listener]); },
      removeEventListener(name, listener) { listeners.set(name, (listeners.get(name) || []).filter(fn => fn !== listener)); },
      dispatch(name, properties = {}) {
        const event = { type: name, target: node, currentTarget: node, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; }, ...properties };
        for (const listener of listeners.get(name) || []) listener(event);
        return event;
      },
      dispatchEvent(event) { return !this.dispatch(event.type, event).defaultPrevented; },
      focus() { document.activeElement = this; },
      click() { if (!this.disabled && !this.hidden) { this.focus(); this.dispatch('click'); } },
      showModal() { this.open = true; this.showCount = (this.showCount || 0) + 1; document.activeElement = nodes.get('tour-close'); },
      close() { if (!this.open) return; this.open = false; this.dispatch('close'); },
      escape() { const event = this.dispatch('cancel', { key: 'Escape' }); if (!event.defaultPrevented) this.close(); },
      querySelectorAll(selector) { return select(selector); },
      querySelector(selector) { return select(selector)[0] || null; },
    };
    nodes.set(id, node);
    return node;
  }
  const initialFocus = element('initial-focus');
  const dialog = element('project-tour');
  const previous = element('tour-prev', { textContent: 'Previous' });
  const next = element('tour-next', { textContent: 'Next' });
  const close = element('tour-close', { textContent: 'Close' });
  const reopen = element('tour-open', { textContent: 'Introduction', hidden: true });
  const counter = element('tour-counter');
  const slides = Array.from({ length: 6 }, (_, index) => element(`slide-${index}`, { dataset: { tourSlide: String(index) }, hidden: index !== 0 }));
  const dots = Array.from({ length: 6 }, (_, index) => element(`dot-${index}`, { dataset: { tourGo: String(index) } }));
  function select(selector) {
    if (selector === '[data-tour-slide]') return slides;
    if (selector === '[data-tour-go]') return dots;
    if (selector === 'button') return [previous, next, close, reopen, ...dots];
    if (selector === '[autofocus]') return [close];
    if (selector.startsWith('#')) return [nodes.get(selector.slice(1))].filter(Boolean);
    return [];
  }
  document = element('document');
  document.documentElement = { lang, style: {} };
  document.body = { style: { overflow: 'scroll' } };
  document.activeElement = initialFocus;
  document.getElementById = id => nodes.get(id) || null;
  const location = { hostname, search, href: `https://${hostname}/research-demo.html${search}` };
  const browser = element('window');
  Object.assign(browser, { document, location });
  runInNewContext(tourController(), {
    document, location, window: browser, URLSearchParams, Event,
    setTimeout: (...args) => scheduled.push(['timeout', ...args]),
    setInterval: (...args) => scheduled.push(['interval', ...args]),
    clearTimeout() {}, clearInterval() {},
  }, { filename: 'research-demo.html#research-tour-script', timeout: 1000 });
  return { document, initialFocus, dialog, previous, next, close, reopen, counter, slides, dots, scheduled };
}

function assertSlide(ui, index) {
  assert.deepEqual(ui.slides.map(slide => !slide.hidden), ui.slides.map((_, current) => current === index));
  assert.equal(ui.previous.disabled, index === 0);
  assert.match(ui.counter.textContent, new RegExp(`(?:^|\\D)${index + 1}\\s*(?:/|of|／|共)\\s*6(?:\\D|$)`));
  assert.deepEqual(ui.dots.map(dot => ['step', 'true'].includes(dot.getAttribute('aria-current')) || dot.getAttribute('aria-pressed') === 'true'), ui.dots.map((_, current) => current === index));
}

test('the standalone document includes six slides and six direct navigation buttons', () => {
  tourController();
  assert.equal((html.match(/\bdata-tour-slide(?:\s|=|>)/g) || []).length, 6);
  assert.deepEqual([...html.matchAll(/\bdata-tour-go\s*=["']([^"']*)["']/g)].map(match => match[1]), ['0', '1', '2', '3', '4', '5']);
});

test('Research opens the actual tour at the first slide on entry without autoplay', () => {
  for (const hostname of ['localhost', 'research.arvivatherap.com']) {
    const ui = fixture({ hostname });
    assert.equal(ui.dialog.open, true);
    assert.equal(ui.reopen.hidden, false);
    assertSlide(ui, 0);
    assert.equal(ui.document.body.style.overflow, 'hidden');
    assert.deepEqual(ui.scheduled, [], 'the introduction must never schedule automatic advancement');
  }
});

test('six slides advance in order and the final Next completes the tour; reopening resets to slide one', () => {
  const ui = fixture();
  for (let index = 0; index < 6; index++) {
    assert.equal(ui.dialog.open, true);
    assertSlide(ui, index);
    ui.next.click();
  }
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.document.body.style.overflow, 'scroll');
  assert.equal(ui.document.activeElement, ui.initialFocus);
  ui.reopen.click();
  assert.equal(ui.dialog.open, true);
  assertSlide(ui, 0);
  ui.close.click();
  assert.equal(ui.document.activeElement, ui.reopen);
  assert.equal(ui.document.body.style.overflow, 'scroll');
});

test('Previous stops at the first slide and direct dots select only their own slide', () => {
  const ui = fixture();
  ui.previous.click(); assertSlide(ui, 0);
  ui.dots[4].click(); assertSlide(ui, 4);
  ui.previous.click(); assertSlide(ui, 3);
  ui.dots[5].click(); assertSlide(ui, 5);
  ui.dots[0].click(); assertSlide(ui, 0);
});

test('Escape and native close events release the scroll lock and restore the original focus', () => {
  const ui = fixture();
  ui.next.click(); ui.dialog.escape();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.document.body.style.overflow, 'scroll');
  assert.equal(ui.document.activeElement, ui.initialFocus);
  ui.reopen.click(); assertSlide(ui, 0);
  ui.dialog.close();
  assert.equal(ui.document.body.style.overflow, 'scroll');
  assert.equal(ui.document.activeElement, ui.reopen);
});

test('Prediction never opens a tour or exposes its reopen entry by hostname or query', () => {
  for (const options of [{ hostname: 'thesis.arvivatherap.com' }, { search: '?platform=prediction' }, { hostname: 'thesis.arvivatherap.com', search: '?platform=research' }]) {
    const ui = fixture(options);
    assert.equal(ui.dialog.open, false);
    assert.equal(ui.dialog.showCount || 0, 0);
    assert.equal(ui.reopen.hidden, true);
    assert.equal(ui.document.body.style.overflow, 'scroll');
    assert.equal(ui.document.activeElement, ui.initialFocus);
  }
});

test('language changes preserve the current slide while updating pagination and accessible labels', () => {
  const chinese = fixture({ lang: 'zh-CN' });
  assertSlide(chinese, 0);
  assert.match(chinese.previous.textContent, /[\u3400-\u9fff]/);
  assert.match(chinese.next.getAttribute('aria-label'), /[\u3400-\u9fff]/);
  const ui = fixture();
  const label = element => element.getAttribute('aria-label') || element.textContent;
  const english = [ui.previous, ui.next, ui.close, ui.reopen, ui.dots[3]].map(label);
  assert.ok(english.every(value => value.trim()));
  ui.dots[3].click(); assertSlide(ui, 3);
  ui.document.documentElement.lang = 'zh-CN';
  ui.document.dispatch('research-language-change');
  assertSlide(ui, 3);
  [ui.previous, ui.next, ui.close, ui.reopen, ui.dots[3]].map(label).forEach((value, index) => {
    assert.notEqual(value, english[index]);
    assert.match(value, /[\u3400-\u9fff]/);
  });
  ui.document.documentElement.lang = 'en';
  ui.document.dispatch('research-language-change');
  assertSlide(ui, 3);
  assert.deepEqual([ui.previous, ui.next, ui.close, ui.reopen, ui.dots[3]].map(label), english);
});
