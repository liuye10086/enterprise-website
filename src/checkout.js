import { PRODUCTS } from './access-state.js';

const plans = Object.freeze({
  standard: Object.freeze({ name: 'Standard', en: '$20', 'zh-CN': '¥140' }),
  pro: Object.freeze({ name: 'Pro', en: '$100', 'zh-CN': '¥698' }),
});
const methods = Object.freeze({ alipay: 'Alipay', wechat: 'WeChat Pay' });

export function getCheckoutUrl(productId) {
  return PRODUCTS.some(product => product.id === productId) ? `/plans?product=${productId}` : null;
}

export function getCheckoutProduct(search = '') {
  const id = new URLSearchParams(search).get('product') ?? PRODUCTS[0].id;
  return PRODUCTS.find(product => product.id === id) ?? null;
}

export function getPlanPrice(planId, locale = 'en') {
  if (!Object.hasOwn(plans, planId)) return null;
  // These are the supplied display prices, not a live currency conversion.
  return plans[planId][locale === 'zh-CN' ? 'zh-CN' : 'en'];
}

export function createCheckoutState(search = '') {
  const product = getCheckoutProduct(search);
  return product ? { productId: product.id, plan: 'standard', method: 'alipay', step: 'plans' } : null;
}

export function transitionCheckout(state, action) {
  if (!state) return null;
  if (action.type === 'select-plan' && state.step === 'plans' && Object.hasOwn(plans, action.value)) return { ...state, plan: action.value };
  if (action.type === 'select-method' && state.step === 'payment' && Object.hasOwn(methods, action.value)) return { ...state, method: action.value };
  if (action.type === 'continue' && state.step === 'plans') return { ...state, step: 'payment' };
  if (action.type === 'back' && state.step === 'payment') return { ...state, step: 'plans' };
  return state;
}

export function initializeCheckout(root = document, browser = root.defaultView) {
  const page = root.querySelector('[data-checkout]');
  if (!page) return () => {};
  let state = createCheckoutState(browser.location.search);
  let locale = root.documentElement.lang;
  const listeners = [];
  const listen = (element, name, handler) => {
    element?.addEventListener(name, handler);
    if (element) listeners.push(() => element.removeEventListener(name, handler));
  };
  const setText = (selector, value) => page.querySelectorAll(selector).forEach(element => {
    if (element.textContent !== value) element.textContent = value;
  });
  const render = () => {
    page.querySelector('[data-checkout-error]').hidden = Boolean(state);
    page.querySelectorAll('[data-checkout-step]').forEach(section => { section.hidden = section.dataset.checkoutStep !== state?.step; });
    if (!state) return;
    const product = PRODUCTS.find(item => item.id === state.productId);
    setText('[data-checkout-product]', product.name);
    for (const id of Object.keys(plans)) setText(`[data-plan-price="${id}"]`, getPlanPrice(id, locale));
    setText('[data-selected-plan]', plans[state.plan].name);
    setText('[data-selected-price]', getPlanPrice(state.plan, locale));
    setText('[data-payment-method-name]', methods[state.method]);
    page.querySelectorAll('input[name="plan"]').forEach(input => { input.checked = input.value === state.plan; });
    page.querySelectorAll('input[name="payment-method"]').forEach(input => { input.checked = input.value === state.method; });
    page.querySelectorAll('[data-checkout-step-label]').forEach(label => {
      if (label.dataset.checkoutStepLabel === state.step) label.setAttribute('aria-current', 'step');
      else label.removeAttribute('aria-current');
    });
  };
  const dispatch = action => {
    const previous = state;
    state = transitionCheckout(state, action);
    if (state === previous) return;
    render();
    if (state.step !== previous.step) {
      const heading = page.querySelector(`[data-checkout-heading="${state.step}"]`);
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  };
  page.querySelectorAll('input[name="plan"]').forEach(input => listen(input, 'change', () => {
    if (input.checked) dispatch({ type: 'select-plan', value: input.value });
  }));
  page.querySelectorAll('input[name="payment-method"]').forEach(input => listen(input, 'change', () => {
    if (input.checked) dispatch({ type: 'select-method', value: input.value });
  }));
  listen(page.querySelector('[data-plan-form]'), 'submit', event => {
    event.preventDefault();
    dispatch({ type: 'continue' });
  });
  listen(page.querySelector('[data-checkout-back]'), 'click', () => dispatch({ type: 'back' }));

  // Language text is handled by the shared translator. Keep monetary values
  // synchronized without interpreting this preview as a payment or entitlement.
  const observer = new browser.MutationObserver(() => {
    const nextLocale = root.documentElement.lang;
    if (nextLocale === locale) return;
    locale = nextLocale;
    render();
  });
  observer.observe(root.documentElement, { attributes: true, attributeFilter: ['lang'] });
  render();
  return () => { observer.disconnect(); listeners.forEach(remove => remove()); };
}
