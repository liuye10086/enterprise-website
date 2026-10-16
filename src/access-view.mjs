import { PRODUCTS } from './access-state.js';
import { SITE_COPY as copy } from './site-copy.mjs';
import { escapeHtml as e } from './content.mjs';

const arrow = '<span aria-hidden="true">→</span>';

export function renderAccessAnnouncement() {
  return '<p class="access-announcement" data-access-announcement role="status" aria-live="polite" hidden></p>';
}

export function renderAccessDialogs() {
  return `<dialog id="login-dialog" class="login-dialog" data-login-dialog aria-labelledby="login-title" aria-describedby="login-description login-availability">
    <button class="login-close" type="button" data-login-close aria-label="Close login">×</button>
    <p class="login-brand">ARVIVA THERAPEUTICS</p>
    <div class="login-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg></div>
    <h2 id="login-title">Welcome back</h2><p id="login-description" class="login-description">Log in with your email. No password needed.</p>
    <p class="login-demo" data-login-demo hidden>Interactive preview. No email will be sent.</p>
    <form class="login-form" data-login-form>
      <div class="login-channels" data-login-channels role="group" aria-label="Sign-in method" hidden><button type="button" data-login-channel="email" aria-pressed="true">Email</button><button type="button" data-login-channel="sms" aria-pressed="false">Phone / SMS</button></div>
      <div class="login-field" data-login-email-field><label for="login-email">Email address</label><input id="login-email" name="email" type="email" autocomplete="email" placeholder="you@qq.com or other email" required maxlength="254" autofocus></div>
      <div class="login-field" data-login-phone-field hidden><label for="login-phone">Mobile number</label><div class="login-phone-row"><span id="login-phone-country" class="login-phone-country">+86</span><input id="login-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="11-digit mobile number" pattern="1[3-9][0-9]{9}" maxlength="11" title="Enter an 11-digit mainland China mobile number" aria-describedby="login-phone-country login-identity-note" disabled></div></div>
      <p id="login-identity-note" class="login-identity-note" data-login-identity-note>QQ and other email providers are supported.</p>
      <label for="login-code">Verification code</label><div class="login-code-row"><input id="login-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required pattern="[0-9]{6}" maxlength="6" title="Enter a 6-digit verification code"><button class="send-code-button" data-login-send-code type="button">Send code</button></div>
      <p class="login-status" data-login-status role="status" aria-live="polite"></p>
      <button class="primary-button login-submit" type="submit">Log in ${arrow}</button>
    </form>
    <div class="login-session" data-login-session hidden><p data-login-email>You are signed in to the demo account.</p><p class="login-status" data-session-status role="status" aria-live="polite"></p><a class="primary-button" href="/profile" data-profile-link hidden>Personal profile</a><button class="secondary-button" type="button" data-demo-logout data-live-logout>Log out</button></div>
    <p id="login-availability" class="login-availability">Email sign-in is coming soon.<br>Verification emails are not available yet.</p>
  </dialog>`;
}

export function medicineModules() {
  return `<section class="medicine-page"><div class="medicine-intro"><p class="medicine-eyebrow">${e(copy.platforms.eyebrow)}</p><h2>Super Intelligent Medicine</h2><p class="medicine-description">${e(copy.platforms.description)}</p></div>
    <div class="demo-notice" data-demo-notice hidden><span class="demo-badge">INTERACTIVE PREVIEW</span><p>Local sign-in preview. No email is sent.</p></div>
    <div class="medicine-modules">${PRODUCTS.map(product=>`<article class="medicine-module" id="${product.url.slice(1)}" aria-labelledby="${product.id}-title"><div class="module-topline"><span class="module-number">${product.number}</span><span class="product-status" data-product-status="${product.id}">Sign in required</span></div><h3 id="${product.id}-title">${product.name}</h3>${product.id === 'module-01' ? `<ul class="module-destination module-features">${copy.platforms.research.map(feature=>`<li>${e(feature)}</li>`).join('')}</ul>` : `<p class="module-destination">${e(copy.platforms.prediction)}</p>`}<p class="module-trial-note"><span aria-hidden="true">✓</span> Sign in to open the platform</p><button type="button" class="module-open" data-product-open="${product.id}" aria-labelledby="${product.id}-title ${product.id}-action"><span id="${product.id}-action" data-product-cta="${product.id}">Open product</span>${arrow}</button><p class="login-status" data-product-error="${product.id}" role="status" hidden></p></article>`).join('')}</div>
    <p class="module-note">${e(copy.platforms.note)}</p>
    <p class="storage-note" data-storage-note hidden></p>
    <noscript><p class="storage-note">Enable JavaScript to use the product access preview.</p></noscript>
  </section>`;
}
