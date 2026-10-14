import { PRODUCTS } from './access-state.js';
import { updateAccountTrigger } from './account-trigger.js';

const productById = new Map(PRODUCTS.map(product => [product.id, product]));

export function readLiveSession(raw) {
  const phone = raw?.phone === undefined ? null : raw.phone;
  const smsReady = raw?.smsReady === undefined ? false : raw.smsReady;
  const developmentSms = raw?.developmentSms === undefined ? false : raw.developmentSms;
  const emailIdentity = typeof raw?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email) && phone === null;
  const phoneIdentity = raw?.email === null && typeof phone === 'string' && /^\+861[3-9][0-9]{9}$/.test(phone);
  if (!raw || typeof raw.authenticated !== 'boolean' || typeof raw.mailReady !== 'boolean' ||
    typeof raw.developmentMail !== 'boolean' || typeof smsReady !== 'boolean' || typeof developmentSms !== 'boolean' ||
    (raw.authenticated ? !emailIdentity && !phoneIdentity : raw.email !== null || phone !== null) ||
    PRODUCTS.some(({ id }) => typeof raw.products?.[id]?.trialUsed !== 'boolean' || typeof raw.products?.[id]?.paid !== 'boolean')) {
    throw new Error('The server returned an invalid session. Please try again.');
  }
  return {
    authenticated: raw.authenticated,
    email: raw.email,
    phone,
    products: Object.fromEntries(PRODUCTS.map(({ id }) => [id, {
      trialUsed: raw.products[id].trialUsed, paid: raw.products[id].paid,
    }])),
    mailReady: raw.mailReady,
    developmentMail: raw.developmentMail,
    smsReady,
    developmentSms,
  };
}

export function liveAccountLabel(session) {
  return session.email || `${session.phone.slice(3, 6)}****${session.phone.slice(-4)}`;
}

export function normalizeLoginTarget(channel, value) {
  const trimmed = value.trim();
  return channel === 'email' ? trimmed.toLowerCase() : /^1[3-9][0-9]{9}$/.test(trimmed) ? `+86${trimmed}` : '';
}

export function createLoginFlow({ now = () => Date.now() } = {}) {
  const deadlines = new Map();
  let channel = 'email';
  let destination = '';
  let revision = 0;
  const key = target => `${target.channel}:${target.destination}`;
  return {
    get channel() { return channel; },
    setTarget(nextChannel, value) {
      const nextDestination = normalizeLoginTarget(nextChannel, value);
      if (channel !== nextChannel || destination !== nextDestination) ++revision;
      channel = nextChannel;
      destination = nextDestination;
    },
    attempt() { return { channel, destination, revision }; },
    isCurrent(attempt) { return attempt.revision === revision; },
    delayResend(attempt, seconds) { deadlines.set(key(attempt), now() + seconds * 1000); },
    remainingSeconds() { return Math.max(0, Math.ceil(((deadlines.get(key({ channel, destination })) || 0) - now()) / 1000)); },
    reset() { channel = 'email'; destination = ''; ++revision; },
  };
}

export async function requestAccessApi(path, { method = 'GET', body, fetcher = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: controller.signal,
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('The server returned an unexpected response. Please try again.'); }
    if (!response.ok) {
      const error = new Error(typeof data?.message === 'string' ? data.message : 'This request could not be completed. Please try again.');
      error.status = response.status;
      error.retryAfterSeconds = Number(data?.retryAfterSeconds ?? data?.retryAfter ?? response.headers.get('Retry-After')) || 0;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The request timed out. Check your connection and try again.');
    if (error instanceof TypeError) throw new Error('Unable to reach the server. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function validateProductUrl(value, baseUrl, productId) {
  const product = productById.get(productId);
  const base = new URL(baseUrl);
  const url = typeof value === 'string' ? new URL(value, base) : null;
  if (!product || !url || !['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin ||
    url.username || url.password || url.pathname !== product.url || url.search || url.hash) {
    throw new Error('The server returned an invalid product destination. Please try again.');
  }
  return url.href;
}

function closeTab(target) {
  try { target?.close(); } catch { /* The user may already have closed the tab. */ }
}

export async function openLiveProduct({ productId, baseUrl, openWindow = (...args) => window.open(...args),
  request = requestAccessApi, isCurrent = () => true, onWindow = () => {} }) {
  if (!productById.has(productId)) throw new Error('Unknown product.');
  let target;
  try {
    // This happens in the click handler before any await or trial-consuming request.
    target = openWindow('about:blank', '_blank');
    if (!target) throw new Error('Allow pop-ups and try again. Your free trial has not been used.');
    target.opener = null;
    onWindow(target);
    if (!isCurrent() || target.closed) { closeTab(target); return false; }
    const result = await request(`/api/products/${productId}/enter`, { method: 'POST', body: {} });
    if (!isCurrent() || target.closed) { closeTab(target); return false; }
    target.location.replace(validateProductUrl(result?.url, baseUrl, productId));
    return true;
  } catch (error) {
    closeTab(target);
    throw error;
  }
}

export function initializeLiveAccess(onOpen = () => {}) {
  const loginDialog = document.querySelector('[data-login-dialog]');
  const accessDialog = document.querySelector('[data-access-dialog]');
  const form = loginDialog?.querySelector('[data-login-form]');
  const email = form?.querySelector('input[name="email"]');
  const phone = form?.querySelector('input[name="phone"]');
  const code = form?.querySelector('input[name="code"]');
  const sendCode = form?.querySelector('[data-login-send-code]');
  if (!loginDialog || !form || !email || !phone || !code || !sendCode) return;

  const ignoredCloseEvents = new Map();
  const loginFlow = createLoginFlow();
  let session = null;
  let sessionError = '';
  let sessionSequence = 0;
  let refreshing = false;
  let busy = null;
  let flowSequence = 0;
  let currentDialog = null;
  let returnTarget = null;
  let restoreFocusTarget = null;
  let pendingProduct = null;
  let pendingTab = null;
  let accessView = 'options';
  let resendTimer = null;

  const signedIn = () => session?.authenticated === true;
  const targetInput = () => loginFlow.channel === 'sms' ? phone : email;
  const channelReady = () => loginFlow.channel === 'sms' ? session?.smsReady : session?.mailReady;
  const syncLoginTarget = () => loginFlow.setTarget(loginFlow.channel, targetInput().value);
  const isCurrent = sequence => sequence === flowSequence && currentDialog?.open;
  const setText = (selector, value, root = document) => root.querySelectorAll(selector).forEach(element => { element.textContent = value; });
  const setHidden = (selector, hidden, root = document) => root.querySelectorAll(selector).forEach(element => { element.hidden = hidden; });
  const announce = message => setText('[data-access-announcement]', message);
  const loginMessage = message => setText('[data-login-status], [data-session-status]', message, loginDialog);
  const accessMessage = message => accessDialog && setText('[data-access-status]', message, accessDialog);

  function productAccess(id) {
    if (!session) return 'unavailable';
    if (!signedIn()) return 'signed-out';
    if (session.products[id].paid) return 'paid';
    return session.products[id].trialUsed ? 'trial-used' : 'trial-available';
  }

  function updateControls() {
    const waiting = Boolean(busy) || refreshing;
    const seconds = loginFlow.remainingSeconds();
    const sms = loginFlow.channel === 'sms';
    const targetLocked = Boolean(busy) && busy !== 'send';
    sendCode.disabled = waiting || !channelReady() || signedIn() || seconds > 0;
    sendCode.textContent = busy === 'send' ? 'Sending…' : seconds > 0 ? `Resend in ${seconds}s` : 'Send code';
    email.disabled = targetLocked || sms;
    email.required = !sms;
    phone.disabled = targetLocked || !sms;
    phone.required = sms;
    form.querySelectorAll('[data-login-channel]').forEach(button => { button.disabled = targetLocked; });
    code.disabled = Boolean(busy);
    form.querySelector('[type="submit"]').disabled = waiting || !channelReady() || signedIn();
    form.setAttribute('aria-busy', String(Boolean(busy)));
    document.querySelectorAll('[data-login-open], [data-product-open]').forEach(button => { button.disabled = Boolean(busy); });
    loginDialog.querySelectorAll('[data-live-logout]').forEach(button => { button.disabled = waiting || !signedIn(); });
    accessDialog?.querySelectorAll('section button').forEach(button => { button.disabled = waiting || !session; });
    accessDialog?.querySelectorAll('[data-access-purchase]').forEach(button => { button.disabled = true; });
    if (currentDialog && !waiting && document.activeElement?.closest('[hidden]')) focusDialog(currentDialog);
    if (restoreFocusTarget && !currentDialog && !busy) {
      if (restoreFocusTarget.isConnected && !restoreFocusTarget.disabled) restoreFocusTarget.focus();
      restoreFocusTarget = null;
    }
  }

  function renderLogin() {
    const sms = loginFlow.channel === 'sms';
    form.hidden = signedIn();
    setHidden('[data-login-session]', !signedIn(), loginDialog);
    setHidden('[data-login-demo]', true, loginDialog);
    setHidden('[data-login-channels]', false, loginDialog);
    setHidden('[data-login-email-field]', sms, loginDialog);
    setHidden('[data-login-phone-field]', !sms, loginDialog);
    form.querySelectorAll('[data-login-channel]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.loginChannel === loginFlow.channel));
    });
    setText('#login-title', signedIn() ? 'Your account' : 'Welcome back', loginDialog);
    setText('#login-description', signedIn()
      ? 'Each product has its own free trial and access status.'
      : `Log in with your ${sms ? 'mobile number' : 'email'}. Your first sign-in creates an account automatically. No password needed.`, loginDialog);
    setText('[data-login-email]', signedIn() ? `Signed in as ${liveAccountLabel(session)}` : '', loginDialog);
    setText('[data-login-identity-note]', sms
      ? 'Mainland China mobile numbers only. Email and phone accounts are separate.'
      : 'QQ and other email providers are supported. Email and phone accounts are separate.', loginDialog);
    setText('#login-availability', signedIn()
      ? 'You are signed in. Log out to use another account.'
      : !session
      ? sessionError || 'Checking sign-in availability…'
      : sms
        ? !session.smsReady
          ? 'SMS sign-in is temporarily unavailable. Please use email instead.'
          : session.developmentSms
            ? 'Local testing only: a random code is saved in tmp/dev-sms on this computer. No real SMS is sent.'
            : 'A verification code will be sent by SMS. Codes expire after 10 minutes.'
      : !session.mailReady
        ? 'Email delivery has not been configured. Verification codes cannot be sent yet.'
        : session.developmentMail
          ? 'Local testing only: verification codes are saved to a local development file. No email is sent.'
          : 'A verification code will be sent to your email. Codes expire after 10 minutes.', loginDialog);
  }

  function renderAccess() {
    const product = productById.get(pendingProduct);
    if (!accessDialog || !product) return;
    const access = productAccess(product.id);
    const section = !signedIn() ? 'signed-out' : access === 'paid' ? 'ready' : accessView;
    for (const name of ['signed-out', 'options', 'payment', 'ready']) setHidden(`[data-access-${name}]`, name !== section, accessDialog);
    setText('[data-access-eyebrow]', `PLATFORM ${product.number} · PRODUCT ACCESS`, accessDialog);
    setText('#access-title', product.name, accessDialog);
    setText('[data-payment-product]', product.name, accessDialog);
    setText('[data-access-login]', 'Go to login', accessDialog);
    const descriptions = {
      'signed-out': session ? 'Log in to check your free trial or full access for this product.' : sessionError || 'Checking your product access…',
      options: access === 'trial-used' ? 'Your free trial for this product has been used. Contact us about full access.' : 'Try this product once for free. Each product has its own trial.',
      payment: 'Online payment is not available yet. Contact us about full access for this product.',
      ready: `Your account has full access. Continue to open ${product.name} in a new tab.`,
    };
    setText('#access-description', descriptions[section], accessDialog);
    setHidden('[data-access-trial]', access !== 'trial-available', accessDialog);
    setText('[data-trial-allowance]', access === 'trial-used' ? '0 uses left' : '1 free use', accessDialog);
    setText('[data-trial-label]', access === 'trial-used' ? 'TRIAL COMPLETED' : 'TRY IT FIRST', accessDialog);
    setText('[data-trial-description]', access === 'trial-used'
      ? 'Trial used. This product has no free uses remaining.'
      : `One free use per account. Opens ${product.name} in a new tab.`, accessDialog);
    setText('.payment-line strong', 'Contact us', accessDialog);
    setText('.payment-note', 'Online payment is not available yet. Contact Arviva Therapeutics about full access.', accessDialog);
    setText('.access-success p', 'Your account has access to this product.', accessDialog);
    setHidden('[data-access-contact]', false, accessDialog);
    setHidden('[data-access-purchase], [data-access-demo-note]', true, accessDialog);
  }

  function refreshPage() {
    setHidden('[data-demo-panel], [data-demo-notice], [data-storage-note]', true);
    updateAccountTrigger(document, signedIn() ? liveAccountLabel(session) : '');
    const labels = {
      unavailable: [sessionError ? 'Access unavailable' : 'Checking access…', 'Check access'],
      'signed-out': ['Sign in required', 'Check access'],
      'trial-available': ['1 free trial', 'Try product'],
      'trial-used': ['Trial used', 'Upgrade access'],
      paid: ['Full access', 'Open product'],
    };
    for (const { id } of PRODUCTS) {
      const access = productAccess(id);
      setText(`[data-product-status="${id}"]`, labels[access][0]);
      document.querySelectorAll(`[data-product-status="${id}"]`).forEach(element => { element.dataset.state = access; });
      setText(`[data-product-cta="${id}"]`, labels[access][1]);
    }
    renderLogin();
    renderAccess();
    updateControls();
  }

  async function refreshSession() {
    if (busy) return;
    const sequence = ++sessionSequence;
    refreshing = true;
    updateControls();
    try {
      const next = readLiveSession(await requestAccessApi('/api/session'));
      if (sequence !== sessionSequence) return;
      session = next;
      sessionError = '';
    } catch (error) {
      if (sequence !== sessionSequence) return;
      session = null;
      sessionError = error.message;
    } finally {
      if (sequence === sessionSequence) {
        refreshing = false;
        refreshPage();
      }
    }
  }

  function beginOperation(name) {
    if (busy || refreshing || !session) return false;
    busy = name;
    ++sessionSequence; // An older GET must never replace a later verification or logout.
    updateControls();
    return true;
  }

  function resetLogin() {
    form.reset();
    loginFlow.reset();
    loginMessage('');
    renderLogin();
    updateControls();
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    ignoredCloseEvents.set(dialog, (ignoredCloseEvents.get(dialog) || 0) + 1);
    dialog.close();
  }

  function focusDialog(dialog) {
    const target = dialog === loginDialog
      ? signedIn() ? dialog.querySelector('[data-live-logout]:not(:disabled)') : targetInput().disabled ? null : targetInput()
      : dialog.querySelector('section:not([hidden]) button:not([hidden]):not(:disabled), section:not([hidden]) a:not([hidden])');
    (target || dialog.querySelector('.login-close') || dialog).focus();
  }

  function showDialog(dialog) {
    onOpen();
    if (currentDialog && currentDialog !== dialog) closeDialog(currentDialog);
    currentDialog = dialog;
    if (!dialog.open) dialog.showModal();
    focusDialog(dialog);
  }

  function dismissFlow() {
    ++flowSequence;
    const trigger = returnTarget;
    const dialog = currentDialog;
    currentDialog = null;
    pendingProduct = null;
    returnTarget = null;
    closeTab(pendingTab);
    pendingTab = null;
    closeDialog(dialog);
    restoreFocusTarget = trigger;
    resetLogin();
  }

  function wireDialog(dialog, closeSelector) {
    if (!dialog) return;
    let pointerStart = null;
    let pointerStartedOutside = false;
    const isOutside = event => {
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    };
    dialog.querySelector(closeSelector)?.addEventListener('click', dismissFlow);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismissFlow(); });
    dialog.addEventListener('close', () => {
      pointerStart = null;
      pointerStartedOutside = false;
      const ignored = ignoredCloseEvents.get(dialog) || 0;
      if (ignored) { ignoredCloseEvents.set(dialog, ignored - 1); return; }
      if (currentDialog === dialog && !dialog.open) dismissFlow();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || !dialog.open) return;
      const focusable = [...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden],[inert]') &&
          element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible');
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    });
    dialog.addEventListener('pointerdown', event => {
      pointerStartedOutside = event.button === 0 && event.target === dialog && isOutside(event);
      pointerStart = { x: event.clientX, y: event.clientY };
    });
    dialog.addEventListener('pointermove', event => {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerStartedOutside = false;
    });
    dialog.addEventListener('pointercancel', () => { pointerStart = null; pointerStartedOutside = false; });
    dialog.addEventListener('click', event => {
      const dismiss = pointerStartedOutside && event.target === dialog && isOutside(event);
      pointerStart = null;
      pointerStartedOutside = false;
      if (dismiss) dismissFlow();
    });
  }

  wireDialog(loginDialog, '[data-login-close]');
  wireDialog(accessDialog, '[data-access-close]');
  document.querySelectorAll('[data-login-open]').forEach(trigger => trigger.addEventListener('click', () => {
    if (busy) return;
    ++flowSequence;
    pendingProduct = null;
    returnTarget = trigger;
    resetLogin();
    renderLogin();
    showDialog(loginDialog);
    void refreshSession();
  }));
  document.querySelectorAll('[data-product-open]').forEach(trigger => trigger.addEventListener('click', () => {
    if (busy || !accessDialog || !productById.has(trigger.dataset.productOpen)) return;
    ++flowSequence;
    pendingProduct = trigger.dataset.productOpen;
    returnTarget = trigger;
    accessView = 'options';
    accessMessage('');
    renderAccess();
    showDialog(accessDialog);
    void refreshSession();
  }));
  accessDialog?.querySelector('[data-access-login]')?.addEventListener('click', () => {
    if (busy || refreshing) return;
    resetLogin();
    renderLogin();
    showDialog(loginDialog);
  });

  form.querySelectorAll('[data-login-channel]').forEach(button => button.addEventListener('click', () => {
    if (button.disabled || button.dataset.loginChannel === loginFlow.channel) return;
    const next = button.dataset.loginChannel;
    loginFlow.setTarget(next, (next === 'sms' ? phone : email).value);
    code.value = '';
    loginMessage('');
    renderLogin();
    updateControls();
    targetInput().focus();
  }));
  [email, phone].forEach(input => input.addEventListener('input', () => {
    syncLoginTarget();
    code.value = '';
    loginMessage('');
    updateControls();
  }));
  code.addEventListener('input', () => loginMessage(''));
  sendCode.addEventListener('click', async () => {
    if (sendCode.disabled || !targetInput().reportValidity()) return;
    syncLoginTarget();
    const attempt = loginFlow.attempt();
    const sms = attempt.channel === 'sms';
    if (!attempt.destination) return;
    const sequence = flowSequence;
    const currentAttempt = () => isCurrent(sequence) && loginFlow.isCurrent(attempt);
    if (!beginOperation('send')) return;
    loginMessage('');
    code.value = '';
    try {
      const result = await requestAccessApi(sms ? '/api/auth/sms/request-code' : '/api/auth/request-code', {
        method: 'POST', body: { [sms ? 'phone' : 'email']: attempt.destination },
      });
      loginFlow.delayResend(attempt, Math.max(60, Number(result.retryAfterSeconds ?? result.retryAfter) || 60));
      if (!currentAttempt()) return;
      loginMessage(sms
        ? session.developmentSms
          ? 'A random code was saved in tmp/dev-sms on this computer. No real SMS was sent.'
          : result.message || 'Check your phone for the verification code.'
        : session.developmentMail
          ? 'A random verification code was saved to the local development mail file. No email was sent.'
          : result.message || 'Check your email for the verification code.');
    } catch (error) {
      if (error.status === 429) loginFlow.delayResend(attempt, Math.max(1, error.retryAfterSeconds || 60));
      if (currentAttempt()) loginMessage(error.message);
    } finally {
      busy = null;
      updateControls();
      if (currentAttempt()) code.focus();
      void refreshSession();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || refreshing || !channelReady() || signedIn() || !form.reportValidity()) return;
    syncLoginTarget();
    const attempt = loginFlow.attempt();
    const sms = attempt.channel === 'sms';
    if (!attempt.destination) return;
    const payload = { [sms ? 'phone' : 'email']: attempt.destination, code: code.value.trim() };
    const sequence = flowSequence;
    if (!beginOperation('verify')) return;
    loginMessage('');
    try {
      session = readLiveSession(await requestAccessApi(sms ? '/api/auth/sms/verify' : '/api/auth/verify', { method: 'POST', body: payload }));
      sessionError = '';
      refreshPage();
      if (!isCurrent(sequence)) return;
      announce(`Signed in as ${liveAccountLabel(session)}.`);
      resetLogin();
      if (pendingProduct && accessDialog) {
        renderAccess();
        showDialog(accessDialog);
      } else dismissFlow();
    } catch (error) {
      if (isCurrent(sequence)) loginMessage(error.message);
    } finally {
      busy = null;
      updateControls();
      void refreshSession();
    }
  });

  loginDialog.querySelector('[data-live-logout]')?.addEventListener('click', async () => {
    if (!signedIn() || !beginOperation('logout')) return;
    const sequence = flowSequence;
    loginMessage('');
    try {
      await requestAccessApi('/api/auth/logout', { method: 'POST', body: {} });
      if (isCurrent(sequence)) {
        dismissFlow();
        announce('You have been logged out.');
      }
    } catch (error) {
      if (isCurrent(sequence)) loginMessage(error.message);
    } finally {
      busy = null;
      await refreshSession();
    }
  });

  async function enterProduct() {
    const id = pendingProduct;
    if (!id || !['trial-available', 'paid'].includes(productAccess(id)) || !beginOperation('enter')) return;
    const sequence = flowSequence;
    accessMessage('Opening your product…');
    try {
      const opened = await openLiveProduct({
        productId: id, baseUrl: window.location.href,
        isCurrent: () => isCurrent(sequence), onWindow: target => { pendingTab = target; },
      });
      pendingTab = null;
      if (!isCurrent(sequence)) return;
      if (opened) {
        dismissFlow();
        announce(`${productById.get(id).name} opened in a new tab.`);
      } else accessMessage('The product tab was closed before loading. Your access will be checked again.');
    } catch (error) {
      pendingTab = null;
      if (isCurrent(sequence)) accessMessage(error.message);
    } finally {
      busy = null;
      await refreshSession();
    }
  }

  accessDialog?.querySelector('[data-access-trial]')?.addEventListener('click', enterProduct);
  accessDialog?.querySelector('[data-access-continue]')?.addEventListener('click', enterProduct);
  accessDialog?.querySelector('[data-access-upgrade]')?.addEventListener('click', () => {
    if (busy || refreshing || !signedIn()) return;
    accessView = 'payment';
    accessMessage('');
    renderAccess();
    focusDialog(accessDialog);
  });
  accessDialog?.querySelector('[data-access-back]')?.addEventListener('click', () => {
    if (busy || refreshing) return;
    accessView = 'options';
    renderAccess();
    focusDialog(accessDialog);
  });

  const startResendTimer = () => { if (!resendTimer) resendTimer = window.setInterval(updateControls, 1000); };
  window.addEventListener('pagehide', () => {
    dismissFlow();
    ++sessionSequence;
    window.clearInterval(resendTimer);
    resendTimer = null;
  });
  window.addEventListener('pageshow', () => { startResendTimer(); void refreshSession(); });
  window.addEventListener('focus', () => { void refreshSession(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshSession(); });
  startResendTimer();
  refreshPage();
  void refreshSession();
}
