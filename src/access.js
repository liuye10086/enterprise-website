import {
  PRODUCTS,
  createDemoState,
  normalizeDemoState,
  getProductAccess,
  signInDemo,
  signOutDemo,
  consumeTrial,
  activateDemoProduct,
} from './access-state.js';

const STORAGE_KEY = 'arviva-access-preview-v1';
const DEMO_CODE = '123456';
const DEMO_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function initializeAccess(onOpen = () => {}) {
  const loginDialog = document.querySelector('[data-login-dialog]');
  const accessDialog = document.querySelector('[data-access-dialog]');
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
    setText('[data-login-label]', authenticated ? 'Demo account' : 'Log in');
    setHidden('[data-demo-panel]', !demoEnabled);
    setHidden('[data-demo-notice]', !demoEnabled);
    setHidden('[data-storage-note]', !demoEnabled || storageAvailable);
    if (demoEnabled && !storageAvailable) {
      setText('[data-storage-note]', 'Preview storage is unavailable. This page will keep your demo progress in memory; refreshing or changing pages will reset it.');
    }
    setText('[data-demo-session]', authenticated ? 'Signed in to the demo account.' : 'Signed out. Log in to simulate product access.');
    document.querySelectorAll('[data-demo-grant]').forEach(button => { button.disabled = !authenticated; });
    for (const product of PRODUCTS) {
      const access = demoEnabled ? getProductAccess(state, product.id) : 'unavailable';
      const labels = {
        'signed-out': ['Sign in required', 'Check access'],
        'trial-available': ['1 free trial', 'Try product'],
        'trial-used': ['Trial used', 'Upgrade access'],
        paid: ['Full access', 'Open product'],
        unavailable: ['Access unavailable', 'View access details'],
      };
      setText(`[data-product-status="${product.id}"]`, labels[access][0]);
      document.querySelectorAll(`[data-product-status="${product.id}"]`).forEach(element => { element.dataset.state = access; });
      setText(`[data-product-cta="${product.id}"]`, labels[access][1]);
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
      ? 'You are signed in to the local preview. Each product has its own trial and full-access status.'
      : demoEnabled ? 'Use your email and the demo code to preview the product access flow.'
        : 'Log in with your email. No password needed.', loginDialog);
    setText('#login-availability', demoEnabled
      ? `Demo only. No real account, verification email or payment is created.${storageAvailable ? '' : ' Preview storage is unavailable; refreshing or changing pages resets this session.'}`
      : 'Email sign-in is not available yet. No verification emails can be sent.', loginDialog);
  }

  function renderAccess(view = 'options') {
    const product = productById.get(pendingProduct);
    if (!accessDialog || !product) return;
    const access = demoEnabled ? getProductAccess(state, product.id) : 'signed-out';
    const section = access === 'signed-out' ? 'signed-out' : access === 'paid' ? 'ready' : view;
    for (const name of ['signed-out', 'options', 'payment', 'ready']) {
      setHidden(`[data-access-${name}]`, name !== section, accessDialog);
    }
    setHidden('[data-access-demo-note]', !demoEnabled, accessDialog);
    setText('[data-access-eyebrow]', `PLATFORM ${product.number} · ${demoEnabled ? 'ACCESS PREVIEW' : 'PRODUCT ACCESS'}`, accessDialog);
    setText('#access-title', product.name, accessDialog);
    setText('[data-access-status]', '', accessDialog);
    setText('[data-payment-product]', product.name, accessDialog);
    setText('[data-access-login]', demoEnabled ? 'Go to login' : 'View login status', accessDialog);
    if (section === 'signed-out') {
      setText('#access-description', demoEnabled
        ? 'Log in to check your free trial or full access for this product.'
        : 'Product sign-in and access are not available yet. Please check back when the service launches.', accessDialog);
    } else if (section === 'payment') {
      setText('#access-description', 'Preview full access for this product. No payment will be collected.', accessDialog);
    } else if (section === 'ready') {
      setText('#access-description', `Demo full access is active for this product. Continue to open ${product.destination} in a new tab.`, accessDialog);
    } else {
      setText('#access-description', access === 'trial-used'
        ? 'Your free trial for this product has been used. Upgrade access to continue.'
        : 'Try this product once for free, or preview full access.', accessDialog);
      setHidden('[data-access-trial]', access !== 'trial-available', accessDialog);
      setText('[data-trial-allowance]', access === 'trial-used' ? '0 uses left' : '1 free use', accessDialog);
      setText('[data-trial-label]', access === 'trial-used' ? 'TRIAL COMPLETED' : 'TRY IT FIRST', accessDialog);
      setText('[data-trial-description]', access === 'trial-used'
        ? 'Trial used. This product has no free uses remaining.'
        : `One free preview use. Opens ${product.destination} in a new tab.`, accessDialog);
    }
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
    let target = null;
    try {
      target = window.open('about:blank', '_blank');
      if (!target) return false;
      target.opener = null;
      target.location.replace(new URL(product.url, window.location.href).href);
      return true;
    } catch {
      try { target?.close(); } catch { /* The new tab may already be unavailable. */ }
      return false;
    }
  }

  function openAccess(productId, trigger) {
    const product = productById.get(productId);
    if (!product || !accessDialog) return;
    pendingProduct = productId;
    returnTarget = trigger;
    if (demoEnabled && getProductAccess(state, productId) === 'paid' && openProduct(product)) {
      pendingProduct = null;
      returnTarget = null;
      announce(`${product.name} opened in a new tab.`);
      return;
    }
    renderAccess();
    showDialog(accessDialog);
    if (demoEnabled && getProductAccess(state, productId) === 'paid') {
      setText('[data-access-status]', 'The new tab could not be opened. Allow pop-ups and select Continue to product to try again.', accessDialog);
    }
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
  wireDialog(accessDialog, '[data-access-close]');
  document.querySelectorAll('[data-login-open]').forEach(trigger => trigger.addEventListener('click', () => {
    pendingProduct = null;
    returnTarget = trigger;
    resetLogin();
    renderLogin();
    showDialog(loginDialog);
  }));
  document.querySelectorAll('[data-product-open]').forEach(trigger => trigger.addEventListener('click', () => {
    openAccess(trigger.dataset.productOpen, trigger);
  }));
  accessDialog?.querySelector('[data-access-login]')?.addEventListener('click', () => {
    resetLogin();
    renderLogin();
    showDialog(loginDialog);
  });

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
    resetLogin();
    announce('Signed in to the local demo account.');
    if (pendingProduct && accessDialog) {
      renderAccess();
      showDialog(accessDialog);
    } else {
      dismissFlow();
    }
  });

  accessDialog?.querySelector('[data-access-trial]')?.addEventListener('click', () => {
    if (!demoEnabled || !pendingProduct || getProductAccess(state, pendingProduct) !== 'trial-available') return;
    const product = productById.get(pendingProduct);
    const beforeTrial = state;
    // Same-origin tabs inherit sessionStorage when opened, so persist the used trial first.
    updateState(consumeTrial(state, product.id));
    if (!openProduct(product)) {
      updateState(beforeTrial);
      setText('[data-access-status]', 'The new tab could not be opened. Allow pop-ups and try again. Your free trial has not been used.', accessDialog);
      return;
    }
    dismissFlow();
    announce(`${product.name} opened in a new tab. Its one free trial has now been used.`);
  });
  accessDialog?.querySelector('[data-access-upgrade]')?.addEventListener('click', () => {
    if (!demoEnabled || !signedIn() || !pendingProduct) return;
    renderAccess('payment');
    focusDialog(accessDialog);
  });
  accessDialog?.querySelector('[data-access-back]')?.addEventListener('click', () => {
    renderAccess();
    focusDialog(accessDialog);
  });
  accessDialog?.querySelector('[data-access-purchase]')?.addEventListener('click', () => {
    if (!demoEnabled || !signedIn() || !pendingProduct) return;
    const product = productById.get(pendingProduct);
    updateState(activateDemoProduct(state, product.id));
    renderAccess('ready');
    focusDialog(accessDialog);
    setText('[data-access-status]', 'Demo full access is active. No payment was made.', accessDialog);
    announce(`Demo full access activated for ${product.name}. No payment was made.`);
  });
  accessDialog?.querySelector('[data-access-continue]')?.addEventListener('click', () => {
    if (!demoEnabled || !pendingProduct || getProductAccess(state, pendingProduct) !== 'paid') return;
    const product = productById.get(pendingProduct);
    if (!openProduct(product)) {
      setText('[data-access-status]', 'The new tab could not be opened. Allow pop-ups and try again.', accessDialog);
      return;
    }
    dismissFlow();
    announce(`${product.name} opened in a new tab.`);
  });

  document.querySelectorAll('[data-demo-logout]').forEach(button => button.addEventListener('click', () => {
    if (!demoEnabled) return;
    updateState(signOutDemo(state));
    dismissFlow();
    announce('Signed out of the demo account. Your product trial and full-access status have been kept.');
  }));
  document.querySelectorAll('[data-demo-grant]').forEach(button => button.addEventListener('click', () => {
    const product = productById.get(button.dataset.demoGrant);
    if (!demoEnabled || !signedIn() || !product) return;
    updateState(activateDemoProduct(state, product.id));
    announce(`Demo full access activated for ${product.name}. No payment was made.`);
  }));
  document.querySelectorAll('[data-demo-reset]').forEach(button => button.addEventListener('click', () => {
    if (!demoEnabled) return;
    dismissFlow();
    updateState(createDemoState());
    announce('Demo reset. You are signed out and both products have one free trial available after sign-in.');
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
