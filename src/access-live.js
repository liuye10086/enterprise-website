import { PRODUCTS, getProductProductionUrl, getProductDestination } from './access-state.js';
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
  // Accept only the fixed destination; API data never becomes an arbitrary URL.
  const expected = getProductProductionUrl(productId);
  if (value !== expected && value !== `${expected}/`) {
    throw new Error('The server returned an invalid product destination. Please try again.');
  }
  return getProductDestination(productId, baseUrl);
}

export async function openLiveProduct({ productId, baseUrl, navigate = url => window.location.assign(url),
  request = requestAccessApi, isCurrent = () => true }) {
  if (!productById.has(productId)) throw new Error('Unknown product.');
  if (!isCurrent()) return false;
  const result = await request(`/api/products/${productId}/enter`, { method: 'POST', body: {} });
  if (!isCurrent()) return false;
  navigate(validateProductUrl(result?.url, baseUrl, productId));
  return true;
}

export function initializeLiveAccess(onOpen = () => {}) {
  const loginDialog = document.querySelector('[data-login-dialog]');
  const form = loginDialog?.querySelector('[data-login-form]');
  const email = form?.querySelector('input[name="email"]');
  const phone = form?.querySelector('input[name="phone"]');
  const code = form?.querySelector('input[name="code"]');
  const sendCode = form?.querySelector('[data-login-send-code]');
  if (!loginDialog || !form || !email || !phone || !code || !sendCode) return;

  const ignoredCloseEvents = new Map();
  const entryErrors = new Map();
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
  let resendTimer = null;

  const signedIn = () => session?.authenticated === true;
  const targetInput = () => loginFlow.channel === 'sms' ? phone : email;
  const channelReady = () => loginFlow.channel === 'sms' ? session?.smsReady : session?.mailReady;
  const syncLoginTarget = () => loginFlow.setTarget(loginFlow.channel, targetInput().value);
  const isCurrent = sequence => sequence === flowSequence;
  const setText = (selector, value, root = document) => root.querySelectorAll(selector).forEach(element => { element.textContent = value; });
  const setHidden = (selector, hidden, root = document) => root.querySelectorAll(selector).forEach(element => { element.hidden = hidden; });
  const announce = message => {
    setText('[data-access-announcement]', message);
    setHidden('[data-access-announcement]', !message);
  };
  const loginMessage = message => setText('[data-login-status], [data-session-status]', message, loginDialog);

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
    document.querySelectorAll('[data-login-open], [data-product-open]').forEach(button => { button.disabled = waiting; });
    loginDialog.querySelectorAll('[data-live-logout]').forEach(button => { button.disabled = waiting || !signedIn(); });
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
      ? 'You are signed in. Open either platform to continue.'
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

  function refreshPage() {
    setHidden('[data-demo-panel], [data-demo-notice], [data-storage-note]', true);
    updateAccountTrigger(document, signedIn() ? liveAccountLabel(session) : '');
    const access = signedIn() ? 'ready' : session ? 'signed-out' : 'unavailable';
    const label = signedIn() ? 'Signed in' : session ? 'Sign in required' : sessionError ? 'Access unavailable' : 'Checking access…';
    for (const { id } of PRODUCTS) {
      setText(`[data-product-status="${id}"]`, label);
      document.querySelectorAll(`[data-product-status="${id}"]`).forEach(element => { element.dataset.state = access; });
      setText(`[data-product-cta="${id}"]`, signedIn() ? 'Open product' : 'Log in to continue');
      setText(`[data-product-error="${id}"]`, entryErrors.get(id) || '');
      setHidden(`[data-product-error="${id}"]`, !entryErrors.has(id));
    }
    renderLogin();
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
    closeDialog(dialog);
    restoreFocusTarget = trigger;
    resetLogin();
  }

  function finishSignIn() {
    dismissFlow();
    announce('Signed in successfully. Choose a platform to continue.');
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
  document.querySelectorAll('[data-login-open]').forEach(trigger => trigger.addEventListener('click', () => {
    if (busy) return;
    announce('');
    ++flowSequence;
    pendingProduct = null;
    returnTarget = trigger;
    resetLogin();
    renderLogin();
    showDialog(loginDialog);
    void refreshSession();
  }));
  document.querySelectorAll('[data-product-open]').forEach(trigger => trigger.addEventListener('click', async () => {
    if (busy || refreshing || !productById.has(trigger.dataset.productOpen)) return;
    announce('');
    ++flowSequence;
    pendingProduct = trigger.dataset.productOpen;
    entryErrors.delete(pendingProduct);
    returnTarget = trigger;
    if (signedIn()) { await enterProduct(); return; }
    resetLogin();
    renderLogin();
    showDialog(loginDialog);
    await refreshSession();
    // Another tab may have signed in. Stay here and require a fresh module click.
    if (pendingProduct && signedIn() && currentDialog === loginDialog) finishSignIn();
  }));

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
      finishSignIn();
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
    if (!id || !signedIn() || !beginOperation('enter')) return;
    const sequence = flowSequence;
    announce('Opening your product…');
    try {
      const opened = await openLiveProduct({
        productId: id, baseUrl: window.location.href, isCurrent: () => isCurrent(sequence),
      });
      if (opened && isCurrent(sequence)) dismissFlow();
    } catch (error) {
      if (!isCurrent(sequence)) return;
      if (error.status === 401) {
        session = { ...session, authenticated: false, email: null, phone: null };
        resetLogin();
        showDialog(loginDialog);
        loginMessage('Your session expired. Please sign in to continue.');
      } else {
        if (currentDialog === loginDialog) loginMessage(error.message);
        entryErrors.set(id, error.message);
        announce(error.message);
      }
    } finally {
      busy = null;
      refreshPage();
    }
  }

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
