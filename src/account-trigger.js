// Use the existing display label, which already masks phone numbers.
export function accountInitial(label) {
  return String(label ?? '').match(/[a-z0-9]/i)?.[0].toUpperCase() ?? '';
}

export function updateAccountTrigger(root, accountLabel = '') {
  const initial = accountInitial(accountLabel);
  const label = accountLabel ? `Account: ${accountLabel}` : 'Log in';
  root.querySelectorAll('[data-login-open]').forEach(button => {
    const avatar = button.querySelector('[data-account-initial]');
    const icon = button.querySelector('[data-account-icon]');
    const accessibleLabel = button.querySelector('[data-login-label]');
    if (avatar) { avatar.textContent = initial; avatar.hidden = !initial; }
    if (icon) icon.toggleAttribute('hidden', Boolean(initial));
    if (accessibleLabel) accessibleLabel.textContent = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  });
}
