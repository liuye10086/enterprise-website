import { renderAccessAnnouncement, renderAccessDialogs } from './access-view.mjs';

const arrow = '<span aria-hidden="true">→</span>';
const lock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>';

function sharedStates() {
  return `<p class="research-preview-note" data-research-preview hidden>Local preview only. Trial progress is stored in this browser tab.</p>
    <div class="research-state" data-research-loading role="status"><p>Checking your Research Platform access…</p></div>
    <div class="research-state" data-research-error role="alert" hidden><h2>We could not check your access</h2><p>Please check your connection and try again. Your trial has not been restarted.</p><button type="button" class="secondary-button" data-research-retry>Try again</button></div>`;
}

export function renderResearchAccessPage({ embedded = false } = {}) {
  return `<section class="research-access-page" data-research-access aria-labelledby="research-access-title">
    ${embedded ? '' : '<a class="research-back" href="/intelligent"><span aria-hidden="true">←</span> <span>Back to Super Intelligent Medicine</span></a>'}
    <div class="research-access-panel"><p class="research-eyebrow">PLATFORM 01 · PRODUCT ACCESS</p><div class="research-lock">${lock}</div>
      <h1 id="research-access-title">Research Platform</h1><p class="research-intro">Choose how you would like to start your research.</p>
      ${sharedStates()}
      <div class="research-state" data-research-guest hidden><h2>Sign in to start your research</h2><p>Sign in to see your free trial and product access.</p><button class="primary-button" type="button" data-login-open>Sign in ${arrow}</button><p class="access-smallprint">Signing in does not start your free trial.</p></div>
      <div data-research-options hidden><div class="access-plan-grid">
        <article class="access-plan trial-plan"><span class="plan-label" data-research-trial-label>TRY IT FIRST</span><h2>Free trial</h2><p class="plan-allowance">15 minutes <span>One trial per account</span></p><p class="plan-description" data-research-trial-description>Start a 15-minute trial of the Research Platform. One trial per account.</p><button class="primary-button" type="button" data-research-trial-button>Start free trial →</button></article>
        <article class="access-plan full-plan"><span class="plan-label">CONTINUE EXPLORING</span><h2>Full access</h2><p class="plan-allowance">Product access</p><p class="plan-description">Continue using this product after your free trial.</p><a class="secondary-button research-upgrade" href="/plans?product=module-01">Upgrade access ${arrow}</a></article>
      </div><p class="access-smallprint">Your trial starts only when you select Start free trial.</p></div>
    </div>
  </section>`;
}

export function renderResearchEntryPage() {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Start research | Arviva Therapeutics</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/brand-theme.css"><link rel="stylesheet" href="/research-access.css"><script type="module" src="/research-entry.js"></script></head><body class="brand-theme research-entry-page" data-research-entry><main>${renderAccessAnnouncement()}${renderResearchAccessPage({ embedded: true })}</main>${renderAccessDialogs()}</body></html>`;
}

export function renderResearchWorkspacePage() {
  return `<section class="research-workspace" data-research-workspace aria-labelledby="research-workspace-title">
    <a class="research-back" href="/intelligent"><span aria-hidden="true">←</span> <span>Back to Super Intelligent Medicine</span></a>
    <header class="research-workspace-heading"><p class="research-eyebrow">ARVIVA RESEARCH PLATFORM</p><h1 id="research-workspace-title">Research workspace</h1><p>From research data to scientific writing.</p></header>
    ${sharedStates()}
    <div data-research-content hidden><div class="research-access-banner"><span class="research-access-badge" data-research-access-label>Free trial active</span><p data-research-timer hidden><span>Trial time remaining</span> <strong data-research-remaining>15:00</strong></p><a href="/plans?product=module-01">View plans ${arrow}</a></div>
      <p class="research-placeholder-note">This is a preview of the research workspace. Research tools are not available yet.</p>
      <div class="research-tool-grid">
        <article class="research-tool-card"><span class="research-tool-number">01</span><h2>Research data analysis</h2><p>Analyze biomedical and pharmaceutical research data and prepare figures and charts.</p><span class="research-coming-soon">Coming soon</span></article>
        <article class="research-tool-card"><span class="research-tool-number">02</span><h2>SCI manuscript drafting</h2><p>Prepare a manuscript draft from research results, explore suitable journals and address review feedback.</p><span class="research-coming-soon">Coming soon</span></article>
        <article class="research-tool-card"><span class="research-tool-number">03</span><h2>Thesis drafting</h2><p>Develop a thesis draft from research results using your university's formatting requirements.</p><span class="research-coming-soon">Coming soon</span></article>
      </div>
    </div>
  </section>`;
}
