import { initializeAccess } from './access.js';
import { initializeLiveAccess } from './access-live.js';
import { mode } from './runtime-config.js';
import { initializeLanguage } from './i18n.js';

export function createEmailDraft(values) {
  const fields = Object.fromEntries(['name','email','subject','message'].map(key=>[key,String(values[key] ?? '').trim()]));
  if (Object.values(fields).some(value=>!value)) throw new Error('Please complete all fields.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw new Error('Please enter a valid email address.');
  const subject = fields.subject.replace(/[\r\n]+/g,' ');
  const body = `Name: ${fields.name}\nEmail: ${fields.email}\n\n${fields.message}`;
  return `mailto:BD@arvivatherap.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function initializeNavigation(root = document, desktop = window.matchMedia('(min-width: 1181px)')) {
  const menu = root.querySelector('.menu-toggle');
  const nav = root.querySelector('#primary-navigation');
  const setMenu = open => {
    menu?.setAttribute('aria-expanded',String(open));
    menu?.setAttribute('aria-label',open ? 'Hide more pages' : 'Show more pages');
    nav?.classList.toggle('is-open',open);
  };
  menu?.addEventListener('click',event=>{
    const opening = menu.getAttribute('aria-expanded') !== 'true';
    setMenu(opening);
    // Keyboard activation reaches the dropdown, which precedes its trigger in the DOM.
    if (opening && event.detail === 0) nav?.querySelector('a:not([data-mobile-primary])')?.focus();
  });
  root.addEventListener('keydown',event=>{
    if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {setMenu(false);menu.focus();}
  });
  nav?.addEventListener('click',event=>{if(event.target.closest('a')) setMenu(false);});
  root.addEventListener('click', event => {
    if (menu?.getAttribute('aria-expanded') === 'true' && !menu.contains(event.target) && !nav?.contains(event.target)) setMenu(false);
  });
  desktop.addEventListener('change', event => { if (event.matches) setMenu(false); });
  return setMenu;
}

export function initializeCarousel(root = document, browser = root.defaultView) {
  const hero = root.querySelector('.hero');
  if (!hero) return () => {};
  const slides = [...hero.querySelectorAll('[data-slide]')];
  const dots = [...hero.querySelectorAll('[data-carousel-dot]')];
  if (slides.length < 2) return () => {};

  const motion = browser.matchMedia('(prefers-reduced-motion: reduce)');
  let current = Math.max(0, slides.findIndex(slide => !slide.hidden));
  let timer = null;
  const listeners = [];
  const listen = (target, name, handler) => {
    if (!target) return;
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  };
  const showSlide = index => {
    current=(index+slides.length)%slides.length;
    slides.forEach((slide,i)=>{slide.hidden=i!==current;});
    dots.forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===current)));
  };
  const schedule = () => {
    browser.clearTimeout(timer);
    timer = null;
    // Always start a fresh interval after manual navigation or returning to the tab.
    if (!motion.matches && !root.hidden) timer = browser.setTimeout(() => {
      showSlide(current + 1);
      schedule();
    }, 5000);
  };
  const navigate = index => { showSlide(index); schedule(); };
  listen(hero.querySelector('[data-carousel-prev]'), 'click', () => navigate(current - 1));
  listen(hero.querySelector('[data-carousel-next]'), 'click', () => navigate(current + 1));
  dots.forEach((dot, i) => listen(dot, 'click', () => navigate(i)));
  listen(root, 'visibilitychange', schedule);
  listen(motion, 'change', schedule);
  showSlide(current);
  schedule();
  return () => {
    browser.clearTimeout(timer);
    listeners.forEach(remove => remove());
  };
}

function initialize() {
  initializeLanguage();
  const setMenu = initializeNavigation();
  document.querySelector('[data-language-select]')?.addEventListener('change',()=>setMenu(false));
  (mode === 'live' ? initializeLiveAccess : initializeAccess)(()=>setMenu(false));
  initializeCarousel();

  const videos = [...document.querySelectorAll('video')];
  videos.forEach(video=>video.addEventListener('play',()=>videos.forEach(other=>{if(other!==video) other.pause();})));

  document.querySelectorAll('[data-contact-form]').forEach(form=>{
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const status = form.querySelector('.form-status');
      try {
        const draft=createEmailDraft(Object.fromEntries(new FormData(form)));
        status.textContent='Your email draft is ready. Review it in your email app before sending. If no app opens, use the email link below.';
        window.location.href=draft;
      } catch(error) {
        status.textContent=error.message;
      }
    });
  });
}
if (typeof document !== 'undefined') initialize();
