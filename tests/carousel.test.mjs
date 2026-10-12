import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/main.js';

function fixture({ count = 2, reducedMotion = false } = {}) {
  function element() {
    const listeners = new Map(), attributes = new Map();
    return {
      hidden: false,
      addEventListener(name, handler) { listeners.set(name, handler); },
      removeEventListener(name) { listeners.delete(name); },
      dispatch(name) { listeners.get(name)?.(); },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
    };
  }
  const slides = Array.from({ length: count }, (_, i) => ({ hidden: i !== 0 }));
  const dots = slides.map(element);
  const previous = element(), next = element();
  const hero = {
    querySelectorAll: selector => selector === '[data-slide]' ? slides : dots,
    querySelector: selector => ({ '[data-carousel-prev]': previous, '[data-carousel-next]': next })[selector],
  };
  const root = Object.assign(element(), { querySelector: () => count ? hero : null });
  const motion = Object.assign(element(), { matches: reducedMotion });
  let now = 0, nextId = 0;
  const timers = new Map();
  const browser = {
    matchMedia: () => motion,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const advance = milliseconds => {
    const target = now + milliseconds;
    for (;;) {
      const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > target) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].callback();
    }
    now = target;
  };
  assert.equal(typeof client.initializeCarousel, 'function', 'carousel must have an autoplay initializer');
  const dispose = client.initializeCarousel(root, browser);
  const selected = () => slides.findIndex(slide => !slide.hidden);
  return { slides, dots, previous, next, root, motion, timers, advance, selected, dispose };
}

test('carousel automatically advances every five seconds and wraps to the first slide', () => {
  const f = fixture();
  f.advance(4999);
  assert.equal(f.selected(), 0);
  f.advance(1);
  assert.equal(f.selected(), 1);
  assert.deepEqual(f.dots.map(dot => dot.getAttribute('aria-pressed')), ['false', 'true']);
  f.advance(5000);
  assert.equal(f.selected(), 0);
  assert.deepEqual(f.dots.map(dot => dot.getAttribute('aria-pressed')), ['true', 'false']);
  assert.equal(f.timers.size, 1);
});

test('manual arrows and dots still work and restart the full countdown', () => {
  const f = fixture();
  f.advance(4900);
  f.next.dispatch('click');
  assert.equal(f.selected(), 1);
  f.advance(4999);
  assert.equal(f.selected(), 1);
  f.advance(1);
  assert.equal(f.selected(), 0);
  f.previous.dispatch('click');
  assert.equal(f.selected(), 1);
  f.dots[0].dispatch('click');
  assert.equal(f.selected(), 0);
  assert.equal(f.timers.size, 1);
  f.advance(5000);
  assert.equal(f.selected(), 1);
});

test('hidden pages pause and resume with a fresh countdown, without skipping slides', () => {
  const f = fixture();
  f.advance(4900);
  f.root.hidden = true;
  f.root.dispatch('visibilitychange');
  assert.equal(f.timers.size, 0);
  f.advance(30000);
  assert.equal(f.selected(), 0);
  f.root.hidden = false;
  f.root.dispatch('visibilitychange');
  f.advance(4999);
  assert.equal(f.selected(), 0);
  f.advance(1);
  assert.equal(f.selected(), 1);
});

test('reduced motion disables autoplay, retains manual controls, and responds to preference changes', () => {
  const f = fixture({ reducedMotion: true });
  f.advance(5000);
  assert.equal(f.selected(), 0);
  f.next.dispatch('click');
  f.advance(5000);
  assert.equal(f.selected(), 1);
  f.motion.matches = false;
  f.motion.dispatch('change');
  f.advance(5000);
  assert.equal(f.selected(), 0);
  f.motion.matches = true;
  f.motion.dispatch('change');
  f.advance(5000);
  assert.equal(f.selected(), 0);
  assert.equal(f.timers.size, 0);
});

test('pages without a carousel or with only one slide do not start a timer', () => {
  for (const count of [0, 1]) {
    const f = fixture({ count });
    f.advance(10000);
    assert.equal(f.timers.size, 0);
  }
});

test('disposing the carousel cancels playback and removes control listeners', () => {
  const f = fixture();
  f.dispose();
  f.advance(10000);
  f.next.dispatch('click');
  f.root.dispatch('visibilitychange');
  assert.equal(f.selected(), 0);
  assert.equal(f.timers.size, 0);
});
