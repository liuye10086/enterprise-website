import { initializeAccess } from './access.js';
import { initializeLiveAccess } from './access-live.js';
import { mode } from './runtime-config.js';

export function createEmailDraft(values) {
  const fields = Object.fromEntries(['name','email','subject','message'].map(key=>[key,String(values[key] ?? '').trim()]));
  if (Object.values(fields).some(value=>!value)) throw new Error('Please complete all fields.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw new Error('Please enter a valid email address.');
  const subject = fields.subject.replace(/[\r\n]+/g,' ');
  const body = `Name: ${fields.name}\nEmail: ${fields.email}\n\n${fields.message}`;
  return `mailto:BD@arvivatherap.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function initialize() {
  const menu = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#primary-navigation');
  const setMenu = open => {
    menu?.setAttribute('aria-expanded',String(open));
    menu?.setAttribute('aria-label',open ? 'Close navigation' : 'Open navigation');
    nav?.classList.toggle('is-open',open);
  };
  menu?.addEventListener('click',()=>setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown',event=>{
    if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {setMenu(false);menu.focus();}
  });
  nav?.addEventListener('click',event=>{if(event.target.closest('a')) setMenu(false);});
  (mode === 'live' ? initializeLiveAccess : initializeAccess)(()=>setMenu(false));

  const slides = [...document.querySelectorAll('[data-slide]')];
  const dots = [...document.querySelectorAll('[data-carousel-dot]')];
  let current = 0;
  const showSlide = index => {
    current=(index+slides.length)%slides.length;
    slides.forEach((slide,i)=>{slide.hidden=i!==current;});
    dots.forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===current)));
  };
  document.querySelector('[data-carousel-prev]')?.addEventListener('click',()=>showSlide(current-1));
  document.querySelector('[data-carousel-next]')?.addEventListener('click',()=>showSlide(current+1));
  dots.forEach((dot,i)=>dot.addEventListener('click',()=>showSlide(i)));

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
