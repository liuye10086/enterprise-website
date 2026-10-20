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

function fixture({ hostname = 'localhost', search = '', lang = 'en', hovering = false, autoOpen = true, readyState = 'complete' } = {}) {
  const nodes = new Map();
  const timers = new Map();
  let now = 0, timerId = 0;
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const pending = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending || pending[1].at > end) break;
      now = pending[1].at;
      timers.delete(pending[0]);
      pending[1].fn();
    }
    now = end;
  }
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
        if (name === 'pointerenter' && properties.pointerType !== 'touch') this.hovered = true;
        if (name === 'pointerleave' && properties.pointerType !== 'touch') this.hovered = false;
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
      matches(selector) { return selector === ':focus-visible' ? this.focusVisible !== false : selector === ':hover' && !!this.hovered; },
      getBoundingClientRect() { return { left: 20, top: 30, right: 880, bottom: 730 }; },
    };
    nodes.set(id, node);
    return node;
  }
  const initialFocus = element('initial-focus');
  const dialog = element('project-tour', { hovered: hovering });
  const viewport = element('tour-slides');
  const previous = element('tour-prev', { textContent: 'Previous' });
  const next = element('tour-next', { textContent: 'Next' });
  const close = element('tour-close', { textContent: 'Close' });
  const reopen = element('tour-open', { textContent: 'Introduction', hidden: true });
  const entryMarkup = html.match(/<div\b[^>]*\bid="research-entry"[^>]*>/)?.[0];
  const startMarkup = html.match(/<button\b[^>]*\bid="research-start"[^>]*>/)?.[0];
  assert.ok(entryMarkup && startMarkup, 'the real document includes the research entry and button');
  const entry = element('research-entry', { hidden: /\bhidden(?:\s|>)/.test(entryMarkup) });
  const start = element('research-start', { href: startMarkup.match(/\bhref="([^"]+)"/)?.[1] });
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
  document.hidden = false;
  document.readyState = readyState;
  document.activeElement = initialFocus;
  document.getElementById = id => nodes.get(id) || null;
  const location = { hostname, search, href: `https://${hostname}/research-demo.html${search}` };
  const browser = element('window');
  Object.assign(browser, { document, location, matchMedia: () => ({ matches: true }) });
  runInNewContext(tourController(), {
    document, location, window: browser, URLSearchParams, Event,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  }, { filename: 'research-demo.html#research-tour-script', timeout: 1000 });
  if (autoOpen) advance(1000);
  return { document, browser, initialFocus, dialog, viewport, previous, next, close, reopen, entry, start, counter, slides, dots, timers, advance };
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

test('Research advances every three seconds and loops from slide six back to one', () => {
  for (const hostname of ['localhost', 'research.arvivatherap.com']) {
    const ui = fixture({ hostname });
    assert.equal(ui.dialog.open, true);
    assert.equal(ui.reopen.hidden, false);
    assertSlide(ui, 0);
    assert.equal(ui.document.body.style.overflow, 'hidden');
    ui.advance(2999); assertSlide(ui, 0);
    for (let index = 1; index < 6; index++) {
      ui.advance(index === 1 ? 1 : 3000); assertSlide(ui, index);
      assert.equal(ui.timers.size, 1);
    }
    ui.advance(2999); assert.equal(ui.dialog.open, true);
    ui.advance(1);
    assert.equal(ui.dialog.open, true);
    assertSlide(ui, 0);
    assert.equal(ui.entry.hidden, true);
    assert.equal(ui.timers.size, 1);
    ui.advance(36000);
    assert.equal(ui.dialog.open, true);
    assertSlide(ui, 0);
  }
});

test('the final Next returns to slide one; only a user dismissal closes the tour', () => {
  const ui = fixture();
  for (let index = 0; index < 6; index++) {
    assert.equal(ui.dialog.open, true);
    assertSlide(ui, index);
    ui.next.click();
  }
  assert.equal(ui.dialog.open, true);
  assertSlide(ui, 0);
  ui.close.click();
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
    assert.equal(ui.entry.hidden, true);
    assert.equal(ui.document.body.style.overflow, 'scroll');
    assert.equal(ui.document.activeElement, ui.initialFocus);
  }
});

test('dismissing Research introduction exposes the popup entry without consuming a trial', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'research.arvivatherap.com']) {
    for (const finish of ['close', 'escape']) {
      const ui = fixture({ hostname, search: '?next=https://example.com&paid=true' });
      assert.equal(ui.entry.hidden, true);
      if (finish === 'close') ui.close.click();
      else ui.dialog.escape();
      assert.equal(ui.entry.hidden, false);
      assert.equal(ui.start.href, undefined);
      assert.equal(ui.timers.size, 0);
    }
  }
});

test('the workspace is visible first, then the introduction opens one second after page load', () => {
  const ui = fixture({ autoOpen: false, readyState: 'loading' });
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.document.body.style.overflow, 'scroll');
  ui.advance(5000);
  assert.equal(ui.dialog.open, false);
  ui.document.readyState = 'complete';
  ui.browser.dispatch('load');
  ui.advance(999);
  assert.equal(ui.dialog.open, false);
  ui.advance(1);
  assert.equal(ui.dialog.open, true);
  assertSlide(ui, 0);
  ui.advance(2999); assertSlide(ui, 0);
  ui.advance(1); assertSlide(ui, 1);
});

test('manual viewing cancels the pending introduction, so closing never reopens it', () => {
  const ui = fixture({ autoOpen: false });
  assert.equal(ui.dialog.open, false);
  ui.advance(500);
  ui.reopen.click();
  assert.equal(ui.dialog.open, true);
  ui.close.click();
  ui.advance(5000);
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.timers.size, 0);
});

test('the delayed introduction waits for a visible tab and never appears on Prediction', () => {
  const ui = fixture({ autoOpen: false });
  ui.advance(500);
  ui.document.hidden = true; ui.document.dispatch('visibilitychange');
  ui.advance(5000); assert.equal(ui.dialog.open, false);
  ui.document.hidden = false; ui.document.dispatch('visibilitychange');
  ui.advance(999); assert.equal(ui.dialog.open, false);
  ui.advance(1); assert.equal(ui.dialog.open, true);
  const prediction = fixture({ hostname: 'thesis.arvivatherap.com' });
  prediction.advance(60000);
  assert.equal(prediction.dialog.open, false);
  assert.equal(prediction.timers.size, 0);
});

test('hover pauses autoplay; leaving resumes a full three seconds without duplicate timers', () => {
  const ui = fixture();
  ui.advance(2000);
  ui.dialog.dispatch('pointerenter', { pointerType: 'mouse' });
  ui.advance(30000); assertSlide(ui, 0);
  ui.next.click(); assertSlide(ui, 1);
  ui.advance(30000); assertSlide(ui, 1);
  ui.document.documentElement.lang = 'zh-CN';
  ui.document.dispatch('research-language-change');
  assert.equal(ui.timers.size, 0);
  ui.dialog.dispatch('pointerleave', { pointerType: 'mouse' });
  ui.advance(2000);
  ui.dots[3].click();
  ui.advance(2999); assertSlide(ui, 3);
  ui.document.dispatch('research-language-change');
  assert.equal(ui.timers.size, 1);
  ui.advance(1); assertSlide(ui, 4);
});

test('background tabs suspend playback; returning gives a full three seconds', () => {
  const ui = fixture();
  ui.advance(2500);
  ui.document.hidden = true; ui.document.dispatch('visibilitychange');
  ui.advance(60000); assertSlide(ui, 0);
  assert.equal(ui.timers.size, 0);
  ui.document.hidden = false; ui.document.dispatch('visibilitychange');
  ui.advance(2999); assertSlide(ui, 0);
  ui.advance(1); assertSlide(ui, 1);
  ui.dialog.dispatch('pointerenter', { pointerType: 'mouse' });
  ui.document.hidden = true; ui.document.dispatch('visibilitychange');
  ui.document.hidden = false; ui.document.dispatch('visibilitychange');
  ui.advance(6000); assertSlide(ui, 1);
});

test('closing clears playback, and reopening starts one fresh timer', () => {
  const ui = fixture();
  ui.advance(2500); ui.dialog.escape();
  assert.equal(ui.timers.size, 0);
  ui.advance(30000); assertSlide(ui, 0);
  ui.reopen.click();
  assert.equal(ui.timers.size, 1);
  ui.advance(2999); assertSlide(ui, 0);
  ui.advance(1); assertSlide(ui, 1);
  ui.dialog.close();
  assert.equal(ui.timers.size, 0);
});

test('source link focus pauses playback and leaving the content resumes it', () => {
  const ui = fixture();
  ui.advance(2500);
  ui.slides[0].dispatch('focusin');
  ui.advance(6000); assertSlide(ui, 0);
  assert.equal(ui.timers.size, 0);
  ui.document.hidden = true; ui.document.dispatch('visibilitychange');
  ui.document.hidden = false; ui.document.dispatch('visibilitychange');
  assert.equal(ui.timers.size, 0);
  ui.slides[0].dispatch('focusout');
  ui.advance(3000); assertSlide(ui, 1);
});

test('language changes preserve the current slide while updating pagination and accessible labels', () => {
  const chinese = fixture({ lang: 'zh-CN' });
  assertSlide(chinese, 0);
  assert.match(chinese.previous.getAttribute('aria-label'), /[\u3400-\u9fff]/);
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

test('opening under the pointer pauses immediately; touch events do not leave autoplay stuck', () => {
  const ui = fixture({ hovering: true });
  ui.advance(9000); assertSlide(ui, 0);
  assert.equal(ui.timers.size, 0);
  ui.dialog.dispatch('pointerleave', { pointerType: 'mouse' });
  ui.advance(3000); assertSlide(ui, 1);
  ui.dialog.dispatch('pointerenter', { pointerType: 'touch' });
  ui.advance(3000); assertSlide(ui, 2);
});

test('hover and keyboard focus both have to end before resuming; closed dialogs cannot restart', () => {
  const ui = fixture();
  ui.dialog.dispatch('pointerenter', { pointerType: 'mouse' });
  ui.slides[0].dispatch('focusin');
  ui.dialog.dispatch('pointerleave', { pointerType: 'mouse' });
  ui.advance(6000); assertSlide(ui, 0);
  ui.slides[0].dispatch('focusout');
  ui.advance(3000); assertSlide(ui, 1);
  ui.dialog.close();
  ui.dialog.dispatch('pointerleave', { pointerType: 'mouse' });
  assert.equal(ui.timers.size, 0);
});

test('mouse focus on a source link does not keep playback paused after leaving', () => {
  const ui = fixture();
  ui.dialog.dispatch('pointerenter', { pointerType: 'mouse' });
  ui.slides[0].focusVisible = false;
  ui.slides[0].dispatch('focusin');
  ui.dialog.dispatch('pointerleave', { pointerType: 'mouse' });
  ui.advance(3000); assertSlide(ui, 1);
});

test('moving onto a native dialog backdrop resumes without relying on pointerleave', () => {
  const ui = fixture({ hovering: true });
  ui.document.dispatch('pointermove', { pointerType: 'mouse', clientX: 5, clientY: 5 });
  ui.advance(3000); assertSlide(ui, 1);
  ui.document.dispatch('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 100 });
  ui.advance(9000); assertSlide(ui, 1);
  ui.document.dispatch('pointermove', { pointerType: 'mouse', clientX: 890, clientY: 100 });
  ui.advance(2999); assertSlide(ui, 1);
  ui.advance(1); assertSlide(ui, 2);
});
