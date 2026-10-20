import { initializeAccess } from './access.js';
import { initializeLiveAccess } from './access-live.js';
import { initializeLanguage } from './i18n.js';
import { initializeResearchAccess } from './research-access.js';
import { mode as runtimeMode } from './runtime-config.js';

const destinations = new Set(['/plans?product=module-01', '/research-workspace']);
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

function parentOrigin(root, browser) {
  if (browser.parent === browser || !root.referrer) return null;
  try {
    const parent = new URL(root.referrer);
    if (parent.origin === 'https://research.arvivatherap.com') return parent.origin;
    if (loopback.has(browser.location.hostname) && ['http:', 'https:'].includes(parent.protocol) && parent.origin === browser.location.origin) return parent.origin;
  } catch { /* Missing or malformed referrers cannot authorize parent messages. */ }
  return null;
}

export function initializeResearchEntry(root = document, browser = root.defaultView, { mode = runtimeMode } = {}) {
  const language = initializeLanguage(root);
  const locale = new URLSearchParams(browser.location.search).get('lang');
  language.setLocale(locale === 'zh-CN' ? 'zh-CN' : 'en');
  const targetOrigin = parentOrigin(root, browser);
  let destroyed = false;
  const send = (action, path) => {
    if (destroyed || !targetOrigin) return false;
    browser.parent.postMessage({ type: 'arviva-research', action, ...(path ? { path } : {}) }, targetOrigin);
    return true;
  };
  const navigate = path => {
    if (destroyed || !destinations.has(path)) return;
    if (!send('navigate', path)) browser.location.assign(path);
  };
  const login = root.querySelector('[data-login-dialog]');
  const trigger = root.querySelector('[data-login-open]');
  let research;
  let session = null;
  let guest = false;
  let openedLogin = false;
  const openGuestLogin = () => {
    if (destroyed || openedLogin || !guest || session?.authenticated !== false || !trigger || trigger.disabled) return;
    openedLogin = true;
    if (!login?.open) trigger.click();
  };
  (mode === 'live' ? initializeLiveAccess : initializeAccess)(() => {}, {
    onSession(next, metadata) {
      session = next;
      if (session?.authenticated) guest = false;
      research?.onSession(next, metadata);
      openGuestLogin();
    },
  });
  research = initializeResearchAccess(root, browser, {
    mode, navigate, onGuest() { guest = true; openGuestLogin(); },
  });
  const upgrade = root.querySelector('.research-upgrade');
  const onUpgrade = event => { event.preventDefault(); navigate('/plans?product=module-01'); };
  const onEscape = event => {
    if (event.key !== 'Escape' || event.defaultPrevented || login?.open) return;
    if (send('close')) event.preventDefault();
  };
  upgrade?.addEventListener('click', onUpgrade);
  root.addEventListener('keydown', onEscape);
  send('ready');
  return {
    destroy() {
      destroyed = true;
      research.destroy(); language.disconnect();
      upgrade?.removeEventListener('click', onUpgrade);
      root.removeEventListener('keydown', onEscape);
    },
  };
}

if (typeof document !== 'undefined' && document.querySelector('[data-research-entry]')) initializeResearchEntry();
