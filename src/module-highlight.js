export function initializeModuleHighlight(root = document, browser = root.defaultView) {
  const modules = [...root.querySelectorAll('.medicine-module[id]')];
  if (!modules.length) return () => {};
  let active = null;
  let timer = null;
  const clear = () => {
    browser.clearTimeout(timer);
    timer = null;
    active?.classList.remove('is-highlighted');
    active = null;
  };
  const highlight = () => {
    clear();
    active = modules.find(module => `#${module.id}` === browser.location.hash);
    if (!active) return;
    // Language is applied before this runs, so the card's final position is known.
    active.scrollIntoView({ behavior: 'instant', block: 'start' });
    active.classList.add('is-highlighted');
    timer = browser.setTimeout(clear, 3000);
  };
  const restore = event => { if (event.persisted) highlight(); };
  browser.addEventListener('hashchange', highlight);
  browser.addEventListener('pageshow', restore);
  browser.addEventListener('pagehide', clear);
  highlight();
  return () => {
    clear();
    browser.removeEventListener('hashchange', highlight);
    browser.removeEventListener('pageshow', restore);
    browser.removeEventListener('pagehide', clear);
  };
}
