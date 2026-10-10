import { PRODUCTS } from './access-state.js';
import { ROUTES } from './routes.mjs';

const arrow = '<span aria-hidden="true">→</span>';

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
    <div class="login-session" data-login-session hidden><p data-login-email>You are signed in to the demo account.</p><p class="login-status" data-session-status role="status" aria-live="polite"></p><button class="secondary-button" type="button" data-demo-logout data-live-logout>Log out</button></div>
    <p id="login-availability" class="login-availability">Email sign-in is coming soon.<br>Verification emails are not available yet.</p>
  </dialog>
  <dialog id="access-dialog" class="login-dialog access-dialog" data-access-dialog aria-labelledby="access-title" aria-describedby="access-description">
    <button class="login-close" type="button" data-access-close aria-label="Close product access">×</button>
    <p class="login-brand" data-access-eyebrow>PRODUCT ACCESS</p>
    <div class="login-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg></div>
    <h2 id="access-title">Log in to continue</h2><p id="access-description" class="login-description">Sign in to see your free trial and product access.</p>
    <section data-access-signed-out hidden><button class="primary-button access-primary" type="button" data-access-login>Go to login ${arrow}</button><p class="access-smallprint">Your free trial will remain available until you start it.</p></section>
    <section data-access-options hidden><div class="access-plan-grid">
      <article class="access-plan trial-plan"><span class="plan-label" data-trial-label>TRY IT FIRST</span><h3>Free trial</h3><p class="plan-allowance" data-trial-allowance>1 use <span>per product</span></p><p class="plan-description" data-trial-description>Explore this product once, free of charge.</p><button class="primary-button" type="button" data-access-trial>Start free trial ${arrow}</button></article>
      <article class="access-plan full-plan"><span class="plan-label">CONTINUE EXPLORING</span><h3>Full access</h3><p class="plan-allowance">Product access</p><p class="plan-description">Continue using this product after your free trial.</p><button class="secondary-button" type="button" data-access-upgrade>Upgrade access ${arrow}</button></article>
    </div><p class="access-smallprint">Each product has its own trial and access plan.</p></section>
    <section data-access-payment hidden><div class="payment-summary"><span class="plan-label">FULL ACCESS</span><h3 data-payment-product>${PRODUCTS[0].name}</h3><div class="payment-line"><span>Product access</span><strong>Price to be confirmed</strong></div></div><p class="payment-note">This is a purchase preview. No payment will be collected.</p><button class="primary-button access-primary" type="button" data-access-purchase>Simulate purchase ${arrow}</button><a class="secondary-button access-primary" href="${ROUTES.contact}" data-access-contact hidden>Contact Arviva Therapeutics ${arrow}</a><button class="access-back" type="button" data-access-back>← Back to access options</button></section>
    <section data-access-ready hidden><div class="access-success"><span aria-hidden="true">✓</span><p>Access is active for this product in the preview.</p></div><button class="primary-button access-primary" type="button" data-access-continue>Continue to product ${arrow}</button></section>
    <p class="login-status" data-access-status role="status" aria-live="polite"></p>
    <p class="login-availability" data-access-demo-note hidden>Interactive preview · No real charges</p>
  </dialog>
  <p class="access-announcement sr-only" data-access-announcement role="status" aria-live="polite"></p>`;
}

export function medicineModules() {
  return `<section class="medicine-page"><div class="medicine-intro"><p class="medicine-eyebrow">EXPLORE OUR PLATFORMS</p><h2>Super Intelligent Medicine</h2><p class="medicine-description">Choose a product to view your trial and access.</p></div>
    <div class="demo-notice" data-demo-notice hidden><span class="demo-badge">INTERACTIVE PREVIEW</span><p>Demo sign-in and purchases. No emails or charges.</p><a href="#preview-controls">Preview controls ↓</a></div>
    <div class="medicine-modules">${PRODUCTS.map(product=>`<article class="medicine-module"><div class="module-topline"><span class="module-number">${product.number}</span><span class="product-status" data-product-status="${product.id}">Sign in required</span></div><h3 id="${product.id}-title">${product.name}</h3><p class="module-destination">This feature is coming soon</p><p class="module-trial-note"><span aria-hidden="true">✓</span> 1 free trial · Separate product access</p><button type="button" class="module-open" data-product-open="${product.id}" aria-labelledby="${product.id}-title ${product.id}-action"><span id="${product.id}-action" data-product-cta="${product.id}">Open product</span>${arrow}</button></article>`).join('')}</div>
    <p class="module-note">Each product includes one free trial. Continued use requires access to that product.</p>
    <section id="preview-controls" class="demo-panel" data-demo-panel hidden><details><summary>Preview controls <span>Try different access states</span></summary><div class="demo-panel-content"><p data-demo-session>Signed out</p><div class="demo-actions">${PRODUCTS.map(product=>`<button type="button" class="secondary-button" data-demo-grant="${product.id}" disabled>Simulate ${product.name} access</button>`).join('')}<button type="button" class="reset-demo-button" data-demo-reset>Reset demo</button></div><p class="access-smallprint">These controls only affect this local preview. Reset restores both free trials.</p></div></details></section>
    <p class="storage-note" data-storage-note hidden></p>
    <noscript><p class="storage-note">Enable JavaScript to use the product access preview.</p></noscript>
  </section>`;
}
