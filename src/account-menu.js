export function initializeAccountMenu(root = document) {
  const wrapper = root.querySelector('[data-account-menu-root]');
  const trigger = wrapper?.querySelector('[data-account-trigger]');
  const menu = wrapper?.querySelector('[data-account-menu]');
  if (!trigger || !menu) return null;

  const logout = menu.querySelector('[data-account-logout]');
  const status = menu.querySelector('[data-account-status]');
  let authenticated = false;
  const isOpen = () => !menu.hidden;
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter(item => !item.disabled && !item.hidden);
  function close({ restoreFocus = false } = {}) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger.isConnected && !trigger.disabled) trigger.focus();
  }
  function setError(message) {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }
  function open(last = false) {
    if (!authenticated || trigger.disabled) return;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const available = items();
    (last ? available.at(-1) : available[0])?.focus();
  }
  function setAuthenticated(value) {
    const next = Boolean(value);
    if (next !== authenticated) setError('');
    authenticated = next;
    trigger.setAttribute('aria-haspopup', next ? 'menu' : 'dialog');
    trigger.setAttribute('aria-controls', next ? menu.getAttribute('id') : 'login-dialog');
    if (!next) close();
  }
  function setBusy(waiting, loggingOut = false) {
    menu.setAttribute('aria-busy', String(Boolean(waiting)));
    if (logout) {
      logout.disabled = Boolean(waiting) || !authenticated;
      logout.textContent = loggingOut ? 'Logging out…' : 'Log out';
    }
  }

  trigger.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (!authenticated || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    open(event.key === 'ArrowUp');
  });
  menu.addEventListener('keydown', event => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const available = items();
    if (!available.length) return;
    event.preventDefault();
    const current = available.indexOf(root.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length;
    available[index].focus();
  });
  root.addEventListener('click', event => { if (isOpen() && !wrapper.contains(event.target)) close(); });
  root.addEventListener('focusin', event => { if (isOpen() && !wrapper.contains(event.target)) close(); });
  menu.querySelector('[data-account-profile]')?.addEventListener('click', () => close());
  close();
  return { trigger, owns: element => element === trigger, isOpen, close, setAuthenticated, setBusy, setError,
    toggle: () => { if (isOpen()) close({ restoreFocus: true }); else { setError(''); open(); } },
  };
}
