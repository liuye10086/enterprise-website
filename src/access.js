import {
  PRODUCTS,
  createDemoState,
  normalizeDemoState,
  getProductAccess,
  signInDemo,
  signOutDemo,
  getProductDestination,
} from './access-state.js';
import { updateAccountTrigger } from './account-trigger.js';

const STORAGE_KEY = 'arviva-access-preview-v1';
const DEMO_CODE = '123456';
const DEMO_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function initializeAccess(onOpen = () => {}) {
  const loginDialog = document.querySelector('[data-login-dialog]');
  const form = loginDialog?.querySelector('[data-login-form]');
  const email = form?.querySelector('input[name="email"]');
  const code = form?.querySelector('input[name="code"]');
  const loginStatus = loginDialog?.querySelector('[data-login-status]');
  if (!loginDialog || !form || !email || !code || !loginStatus) return;

  const demoEnabled = DEMO_HOSTS.has(window.location.hostname);
  const productById = new Map(PRODUCTS.map(product => [product.id, product]));
  const ignoredCloseEvents = new Map();
  let state = createDemoState();
  let storage = null;
  let storageAvailable = demoEnabled;
  let currentDialog = null;
  let returnTarget = null;
  let pendingProduct = null;
  let issuedEmail = null;

  if (demoEnabled) {
    restoreState();
    persistState();
  }

  function restoreState() {
    state = createDemoState();
    storage = null;
    storageAvailable = demoEnabled;
    if (!demoEnabled) return;
    let storedValue = null;
    try {
      storage = window.sessionStorage;
      storedValue = storage.getItem(STORAGE_KEY);
    } catch {
      storageAvailable = false;
    }
    if (storedValue) {
      try {
        state = normalizeDemoState(JSON.parse(storedValue));
      } catch {
        state = createDemoState();
      }
    }
  }

  function signedIn() {
    return demoEnabled && getProductAccess(state, PRODUCTS[0].id) !== 'signed-out';
  }

  function setText(selector, value, root = document) {
    root.querySelectorAll(selector).forEach(element => { element.textContent = value; });
  }

  function setHidden(selector, hidden, root = document) {
    root.querySelectorAll(selector).forEach(element => { element.hidden = hidden; });
  }

  function announce(message) {
    setText('[data-access-announcement]', message);
    setHidden('[data-access-announcement]', !message);
  }

  function persistState() {
    if (!demoEnabled || !storageAvailable) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      storageAvailable = false;
    }
  }

  function updateState(nextState) {
    state = nextState;
    persistState();
    refreshPage();
  }

  function refreshPage() {
    const authenticated = signedIn();
    updateAccountTrigger(document, authenticated ? 'Demo account' : '');
    setHidden('[data-demo-panel]', true);
    setHidden('[data-demo-notice]', !demoEnabled);
    setHidden('[data-storage-note]', !demoEnabled || storageAvailable);
    if (demoEnabled && !storageAvailable) {
      setText('[data-storage-note]', 'Preview storage is unavailable. This page will keep your demo progress in memory; refreshing or changing pages will reset it.');
    }
    setText('[data-demo-session]', authenticated ? 'Signed in to the demo account.' : 'Signed out. Log in to simulate product access.');
    for (const product of PRODUCTS) {
      const access = !demoEnabled ? 'unavailable' : authenticated ? 'ready' : 'signed-out';
      setText(`[data-product-status="${product.id}"]`, authenticated ? 'Signed in' : demoEnabled ? 'Sign in required' : 'Access unavailable');
      document.querySelectorAll(`[data-product-status="${product.id}"]`).forEach(element => { element.dataset.state = access; });
      setText(`[data-product-cta="${product.id}"]`, authenticated ? 'Open product' : 'Log in to continue');
    }
    renderLogin();
  }

  function resetLogin() {
    form.reset();
    issuedEmail = null;
    loginStatus.textContent = '';
    setText('[data-login-demo]', 'Local preview only. Select Send code to get a demo code. No verification email is sent.', loginDialog);
  }

  function renderLogin() {
    const authenticated = signedIn();
    form.hidden = authenticated;
    setHidden('[data-login-session]', !authenticated, loginDialog);
    setHidden('[data-login-demo]', !demoEnabled || authenticated, loginDialog);
    setText('#login-title', authenticated ? 'Demo account' : demoEnabled ? 'Preview sign-in' : 'Welcome back', loginDialog);
    setText('#login-description', authenticated
      ? 'You are signed in to the local preview. Open either platform to continue.'
      : demoEnabled ? 'Use your email and the demo code to preview the product access flow.'
        : 'Log in with your email. No password needed.', loginDialog);
    setText('#login-availability', demoEnabled
      ? `Demo only. No real account, verification email or payment is created.${storageAvailable ? '' : ' Preview storage is unavailable; refreshing or changing pages resets this session.'}`
      : 'Email sign-in is not available yet. No verification emails can be sent.', loginDialog);
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    ignoredCloseEvents.set(dialog, (ignoredCloseEvents.get(dialog) || 0) + 1);
    dialog.close();
  }

  function focusDialog(dialog) {
    const target = dialog === loginDialog
      ? signedIn() ? dialog.querySelector('[data-demo-logout]') : email
      : dialog.querySelector('section:not([hidden]) button:not([hidden]):not(:disabled)');
    (target || dialog.querySelector('button:not(:disabled)') || dialog).focus();
  }

  function showDialog(dialog) {
    onOpen();
    if (currentDialog && currentDialog !== dialog) closeDialog(currentDialog);
    currentDialog = dialog;
    if (!dialog.open) dialog.showModal();
    focusDialog(dialog);
  }

  function dismissFlow() {
    const trigger = returnTarget;
    const closingDialog = currentDialog;
    currentDialog = null;
    pendingProduct = null;
    returnTarget = null;
    closeDialog(closingDialog);
    resetLogin();
    if (trigger?.isConnected) trigger.focus();
  }

  function openProduct(product) {
    if (!demoEnabled || !signedIn()) return;
    const destination = getProductDestination(product.id, window.location.href);
    dismissFlow();
    window.location.assign(destination);
  }

  function openAccess(productId, trigger) {
    const product = productById.get(productId);
    if (!product) return;
    announce('');
    pendingProduct = productId;
    returnTarget = trigger;
    if (signedIn()) { openProduct(product); return; }
    resetLogin();
    renderLogin();
    showDialog(loginDialog);
  }

  function wireDialog(dialog, closeSelector) {
    if (!dialog) return;
    let pointerStartedOutside = false;
    let pointerStart = null;
    const isOutside = event => {
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    };
    dialog.querySelector(closeSelector)?.addEventListener('click', dismissFlow);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      dismissFlow();
    });
    dialog.addEventListener('close', () => {
      pointerStartedOutside = false;
      pointerStart = null;
      // A queued close from the previous dialog must not dismiss a new flow.
      const ignored = ignoredCloseEvents.get(dialog) || 0;
      if (ignored) { ignoredCloseEvents.set(dialog, ignored - 1); return; }
      if (currentDialog === dialog && !dialog.open) dismissFlow();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || !dialog.open) return;
      const focusable = [...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
          !element.closest('[hidden],[inert]') && element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility === 'visible');
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener('pointerdown', event => {
      pointerStartedOutside = event.button === 0 && event.target === dialog && isOutside(event);
      pointerStart = { x: event.clientX, y: event.clientY };
    });
    dialog.addEventListener('pointermove', event => {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerStartedOutside = false;
    });
    dialog.addEventListener('pointercancel', () => { pointerStartedOutside = false; pointerStart = null; });
    dialog.addEventListener('click', event => {
      const closeFromBackdrop = pointerStartedOutside && event.target === dialog && isOutside(event);
      pointerStartedOutside = false;
      pointerStart = null;
      if (closeFromBackdrop) dismissFlow();
    });
  }

  wireDialog(loginDialog, '[data-login-close]');
  document.querySelectorAll('[data-login-open]').forEach(trigger => trigger.addEventListener('click', () => {
    announce('');
    pendingProduct = null;
    returnTarget = trigger;
    resetLogin();
    renderLogin();
    showDialog(loginDialog);
  }));
  document.querySelectorAll('[data-product-open]').forEach(trigger => trigger.addEventListener('click', () => {
    openAccess(trigger.dataset.productOpen, trigger);
  }));
  email.addEventListener('input', () => {
    loginStatus.textContent = '';
    if (issuedEmail !== null && email.value.trim() !== issuedEmail) {
      issuedEmail = null;
      code.value = '';
      loginStatus.textContent = 'Your email changed. Select Send code again before signing in.';
      setText('[data-login-demo]', 'Select Send code again to get a demo code for the updated email. No email is sent.', loginDialog);
    }
  });
  code.addEventListener('input', () => { loginStatus.textContent = ''; });
  form.querySelector('[data-login-send-code]')?.addEventListener('click', () => {
    loginStatus.textContent = '';
    if (!email.reportValidity()) return;
    if (!demoEnabled) {
      loginStatus.textContent = 'Email sign-in is not available yet. No code has been sent.';
      return;
    }
    issuedEmail = email.value.trim();
    code.value = '';
    loginStatus.textContent = 'Demo code: 123456. No email has been sent.';
    setText('[data-login-demo]', 'Demo code: 123456. This code only works in the local preview; no email has been sent.', loginDialog);
    code.focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    loginStatus.textContent = '';
    if (!form.reportValidity()) return;
    if (!demoEnabled) {
      loginStatus.textContent = 'Email sign-in is not available yet. You have not been signed in.';
      return;
    }
    if (!issuedEmail || issuedEmail !== email.value.trim()) {
      loginStatus.textContent = 'Select Send code for this email before signing in.';
      return;
    }
    if (code.value !== DEMO_CODE) {
      loginStatus.textContent = 'Enter the demo code shown after selecting Send code.';
      return;
    }
    updateState(signInDemo(state));
    dismissFlow();
    announce('Signed in successfully. Choose a platform to continue.');
  });

  document.querySelectorAll('[data-demo-logout]').forEach(button => button.addEventListener('click', () => {
    if (!demoEnabled) return;
    updateState(signOutDemo(state));
    dismissFlow();
    announce('Signed out of the demo account.');
  }));
  window.addEventListener('pagehide', () => { dismissFlow(); });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    dismissFlow();
    // BFCache retains the old closure; another page may have changed this session.
    // Read the current stored state before allowing any new access actions.
    restoreState();
    refreshPage();
    announce('');
  });

  resetLogin();
  refreshPage();
}
