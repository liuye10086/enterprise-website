export const PRODUCTS = Object.freeze([
  Object.freeze({
    id: 'module-01',
    number: '01',
    name: 'Research Platform',
    destination: 'Research Platform',
    url: '/research-platform',
  }),
  Object.freeze({
    id: 'module-02',
    number: '02',
    name: 'Prediction Platform',
    destination: 'Prediction Platform',
    url: '/prediction-platform',
  }),
]);

export function createDemoState() {
  return {
    version: 1,
    signedIn: false,
    products: Object.fromEntries(
      PRODUCTS.map(({ id }) => [id, { trialUsed: false, paid: false }]),
    ),
  };
}

function ownValue(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

export function normalizeDemoState(raw) {
  const state = createDemoState();
  if (ownValue(raw, 'version') !== state.version) return state;

  state.signedIn = ownValue(raw, 'signedIn') === true;
  const products = ownValue(raw, 'products');
  for (const { id } of PRODUCTS) {
    const product = ownValue(products, id);
    state.products[id].trialUsed = ownValue(product, 'trialUsed') === true;
    state.products[id].paid = ownValue(product, 'paid') === true;
  }
  return state;
}

function requireProduct(id) {
  if (!PRODUCTS.some((product) => product.id === id)) {
    throw new Error('Unknown product.');
  }
}

export function getProductAccess(state, id) {
  requireProduct(id);
  const normalized = normalizeDemoState(state);
  if (!normalized.signedIn) return 'signed-out';
  if (normalized.products[id].paid) return 'paid';
  return normalized.products[id].trialUsed ? 'trial-used' : 'trial-available';
}

export function signInDemo(state) {
  const next = normalizeDemoState(state);
  next.signedIn = true;
  return next;
}

export function signOutDemo(state) {
  const next = normalizeDemoState(state);
  next.signedIn = false;
  return next;
}

export function consumeTrial(state, id) {
  if (getProductAccess(state, id) !== 'trial-available') {
    throw new Error('A signed-in account with an unused trial is required.');
  }
  const next = normalizeDemoState(state);
  next.products[id].trialUsed = true;
  return next;
}

export function activateDemoProduct(state, id) {
  requireProduct(id);
  const next = normalizeDemoState(state);
  if (!next.signedIn) throw new Error('Sign in before activating a demo product.');
  next.products[id].paid = true;
  return next;
}
