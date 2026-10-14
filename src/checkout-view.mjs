const arrow = '<span aria-hidden="true">→</span>';

function planCard(plan, name, price, selected = false) {
  return `<label class="checkout-plan-card checkout-plan-card--${plan}">
    <span class="checkout-plan-topline"><span class="checkout-plan-name" id="checkout-plan-${plan}" role="heading" aria-level="3" translate="no">${name}</span><span class="checkout-plan-period">Monthly plan</span></span>
    <span class="checkout-price"><strong data-plan-price="${plan}" translate="no">${price}</strong><span>/ month</span></span>
    <span class="checkout-plan-divider" aria-hidden="true"></span>
    <span class="checkout-plan-choice"><input class="checkout-plan-radio" type="radio" name="plan" value="${plan}" aria-labelledby="checkout-plan-${plan}"${selected ? ' checked' : ''}><span>Select plan</span><span class="checkout-plan-choice-arrow" aria-hidden="true">↗</span></span>
  </label>`;
}

function demoQr() {
  // Decorative, deliberately incomplete geometry. This contains no QR payload.
  return `<div class="checkout-qr" role="img" aria-label="Non-scannable demo QR placeholder">
    <svg class="checkout-qr-pattern" viewBox="0 0 200 200" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" stroke-width="7" stroke-linecap="square">
        <path d="M18 52V18h34M148 18h34v34M18 148v34h34M148 182h34v-34"/>
      </g>
      <g fill="currentColor">
        <path d="M30 30h14v14H30zM156 30h14v14h-14zM30 156h14v14H30zM156 156h14v14h-14z"/>
        <path d="M66 18h10v10H66zM86 18h10v20H86zM106 18h20v10h-20zM116 38h10v10h-10zM66 38h10v10H66zM46 62h10v10H46zM18 76h20v10H18zM28 96h10v20H28zM18 128h10v10H18zM46 118h10v20H46zM154 62h10v10h-10zM174 76h10v20h-10zM154 106h10v10h-10zM174 118h10v20h-10zM66 154h10v10H66zM86 164h10v20H86zM108 174h20v10h-20zM118 154h10v10h-10zM138 136h10v10h-10zM58 136h10v10H58zM136 42h10v10h-10z"/>
      </g>
    </svg>
    <div class="checkout-qr-label"><strong translate="no">DEMO</strong><span>Preview only</span></div>
  </div>`;
}

export function renderCheckoutPage() {
  return `<div class="checkout-page" data-checkout>
    <div class="checkout-topbar"><a class="checkout-platform-link" href="/intelligent"><span aria-hidden="true">←</span><span>Back to platforms</span></a><span class="checkout-preview-badge"><span aria-hidden="true"></span><span>Checkout preview</span></span></div>

    <ol class="checkout-steps" aria-label="Checkout steps">
      <li data-checkout-step-label="plans" aria-current="step"><span class="checkout-step-number" aria-hidden="true">1</span><span>Choose a plan</span></li>
      <li data-checkout-step-label="payment"><span class="checkout-step-number" aria-hidden="true">2</span><span>Payment method</span></li>
    </ol>

    <section class="checkout-error" data-checkout-error hidden role="alert">
      <h2>Platform unavailable</h2><p>The selected platform could not be found. Return to the platforms page to choose a product.</p><a class="checkout-primary-button" href="/intelligent">Back to platforms ${arrow}</a>
    </section>

    <section class="checkout-plans" data-checkout-step="plans" aria-labelledby="checkout-plans-heading">
      <div class="checkout-heading-block"><p class="checkout-product" data-checkout-product>Research Platform</p><h2 class="checkout-heading" id="checkout-plans-heading" data-checkout-heading="plans" tabindex="-1">Choose your plan</h2><p class="checkout-introduction">Monthly plans for your selected platform.</p></div>
      <form class="checkout-plan-form" data-plan-form>
        <fieldset class="checkout-plan-fieldset"><legend class="checkout-sr-only">Choose a monthly plan</legend><div class="checkout-plan-grid">${planCard('standard', 'Standard', '$20', true)}${planCard('pro', 'Pro', '$100')}</div></fieldset>
        <div class="checkout-plan-footer"><p class="checkout-plan-note">Plan details will be confirmed before payment is enabled.</p><button class="checkout-primary-button" type="submit"><span>Choose payment method</span>${arrow}</button></div>
      </form>
      <p class="checkout-preview-note">Preview only. No payment will be taken.</p>
    </section>

    <section class="checkout-payment" data-checkout-step="payment" hidden aria-labelledby="checkout-payment-heading">
      <div class="checkout-heading-block"><p class="checkout-product" data-checkout-product>Research Platform</p><h2 class="checkout-heading" id="checkout-payment-heading" data-checkout-heading="payment" tabindex="-1">Choose a payment method</h2><p class="checkout-introduction">Review your selection and preview the payment layout.</p></div>
      <div class="checkout-payment-grid">
        <div class="checkout-payment-panel">
          <fieldset class="checkout-method-fieldset"><legend>Payment method</legend><div class="checkout-method-grid">
            <label class="checkout-method"><input type="radio" name="payment-method" value="alipay" checked><span class="checkout-method-icon checkout-method-icon--alipay" aria-hidden="true">支</span><span>Alipay</span></label>
            <label class="checkout-method"><input type="radio" name="payment-method" value="wechat"><span class="checkout-method-icon checkout-method-icon--wechat" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M14.5 10.5c0 3-2.8 5.5-6.3 5.5-.8 0-1.5-.1-2.2-.3L3.5 17l.7-2.2C2.8 13.8 2 12.2 2 10.5 2 7.5 4.8 5 8.2 5s6.3 2.5 6.3 5.5Z" fill="currentColor"/><path d="M22 15c0 2.5-2.4 4.5-5.3 4.5-.7 0-1.3-.1-1.9-.3l-2.1 1 .6-1.8a4.3 4.3 0 0 1-1.9-3.4c0-2.5 2.4-4.5 5.3-4.5S22 12.5 22 15Z" fill="currentColor" stroke="white" stroke-width="1"/></svg></span><span>WeChat Pay</span></label>
          </div></fieldset>
          <div class="checkout-qr-area"><p class="checkout-qr-method" data-payment-method-name>Alipay</p>${demoQr()}<p class="checkout-qr-caption">Payment QR preview</p><p class="checkout-qr-note">This placeholder cannot be scanned. No payment will be taken.</p></div>
        </div>

        <aside class="checkout-order" aria-labelledby="checkout-order-heading"><div class="checkout-order-heading"><h3 id="checkout-order-heading">Order summary</h3><span class="checkout-order-dot" aria-hidden="true"></span></div>
          <dl class="checkout-order-details">
            <div><dt>Platform</dt><dd data-checkout-product>Research Platform</dd></div>
            <div><dt>Plan</dt><dd data-selected-plan translate="no">Standard</dd></div>
            <div><dt>Billing period</dt><dd>Monthly</dd></div>
            <div><dt>Payment method</dt><dd data-payment-method-name>Alipay</dd></div>
          </dl>
          <div class="checkout-order-total"><span>Display total</span><p><strong data-selected-price translate="no">$20</strong><span>/ month</span></p></div>
          <p class="checkout-order-note">This preview does not create an order or activate access.</p>
          <button class="checkout-back-button" type="button" data-checkout-back><span aria-hidden="true">←</span><span>Change plan</span></button>
        </aside>
      </div>
    </section>
  </div>`;
}
