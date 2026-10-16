import { escapeHtml as e, renderArticleBody } from './content.mjs';
import { renderAccessDialogs, renderAccessAnnouncement, medicineModules } from './access-view.mjs';
import { PRODUCTS } from './access-state.js';
import { SECTIONS, ROUTES, ARTICLE_ROUTES } from './routes.mjs';
import { SITE_COPY as copy } from './site-copy.mjs';
import { DRUG_DESIGN_COPY as designCopy } from './drug-design-copy.mjs';
import { renderCheckoutPage } from './checkout-view.mjs';

const navigation = SECTIONS.map(section => [section.key === 'news' ? copy.newsTitle : section.label, section.path]);
const img = (name, alt, className = '', loading = 'lazy') => `<img src="/assets/images/${e(name)}" alt="${e(alt)}" class="${className}" loading="${loading}" decoding="async">`;
const arrow = '<span aria-hidden="true">↗</span>';
const link = (label, href) => `<a class="text-link" href="${href}">${label} ${arrow}</a>`;
const lines = text => text.map(e).join('<br>');

function languageToggle() {
  return `<button class="language-toggle" type="button" role="switch" aria-checked="false" aria-label="Use Simplified Chinese" data-language-toggle><span class="language-toggle-labels" translate="no" aria-hidden="true"><span>EN</span><span>中</span></span></button>`;
}

function header(active) {
  const primaryPages = new Set([ROUTES.home, ROUTES.intelligent]);
  const row = `<div class="navigation-row">
      <a class="brand" href="${ROUTES.home}" aria-label="Arviva Therapeutics home">${img('33300796.jpg','Arviva Therapeutics','logo','eager')}</a>
      <nav id="primary-navigation" aria-label="Main navigation">${navigation.map(([label,href])=>`<a href="${href}"${primaryPages.has(href) ? ' data-mobile-primary' : ''}${active === href ? ' aria-current="page"' : ''}>${e(label)}</a>`).join('')}</nav>
      <div class="header-actions"><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" aria-label="Show more pages" data-current-section="${Boolean(active && !primaryPages.has(active))}"><span>More</span><svg class="more-chevron" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button>${languageToggle()}<button class="login-trigger" type="button" data-login-open aria-label="Log in" title="Log in" aria-haspopup="dialog" aria-controls="login-dialog"><svg data-account-icon viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/></svg><span data-account-initial translate="no" aria-hidden="true" hidden></span><span class="sr-only" data-login-label>Log in</span></button></div>
      <nav class="mobile-primary-links" aria-label="Primary pages">${navigation.filter(([,href])=>primaryPages.has(href)).map(([label,href])=>`<a href="${href}"${active === href ? ' aria-current="page"' : ''}>${e(label)}</a>`).join('')}</nav>
    </div>`;
  const title = '<h1 class="company-name">Arviva Therapeutics Inc.</h1>';
  // Keep the title in its original place while the navigation stays at the top.
  const content = `<header class="site-header${active === ROUTES.home ? ' home-header' : ''}"><div class="wrap">${row}${renderAccessAnnouncement()}</div></header><div class="wrap">${title}</div>`;
  return `<a class="skip-link" href="#main-content">Skip to content</a>${content}`;
}

function footer() {
  return `<footer class="site-footer wrap"><p>Copyright© Arviva Therapeutics Inc.</p><a href="mailto:BD@arvivatherap.com">BD@arvivatherap.com</a><a class="back-top" href="#top">Back to top ↑</a></footer>`;
}

function shell(title, active, body, description=copy.description, extraHead='') {
  const isHome = active === ROUTES.home;
  const theme = '<link rel="stylesheet" href="/brand-theme.css">' + extraHead + (isHome ? '<link rel="preload" as="image" href="/assets/images/ai-biomed-hero-v1.png">' : '');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)} | Arviva Therapeutics</title><meta name="description" content="${e(description)}"><link rel="icon" href="/assets/images/33300796.jpg"><link rel="stylesheet" href="/styles.css">${theme}<script type="module" src="/main.js"></script></head><body id="top" class="brand-theme${isHome ? ' home-page' : ''}">${header(active)}<main id="main-content" class="wrap">${body}</main>${footer()}${renderAccessDialogs()}</body></html>`;
}

function carousel() {
  return `<section class="hero" aria-roledescription="carousel" aria-label="Our mission">
    <div class="hero-slide" data-slide="0"><div class="hero-content"><h2>${lines(copy.home.hero[0].title)}</h2><p>${lines(copy.home.hero[0].description)}</p></div></div>
    <div class="hero-slide hero-slide--second" data-slide="1" hidden><div class="hero-content"><h2>${lines(copy.home.hero[1].title)}</h2><p>${lines(copy.home.hero[1].description)}</p></div></div>
    <button class="hero-control previous" type="button" data-carousel-prev aria-label="Previous slide">←</button>
    <button class="hero-control next" type="button" data-carousel-next aria-label="Next slide">→</button>
    <div class="hero-dots" aria-label="Select slide"><button type="button" data-carousel-dot="0" aria-label="Show slide 1" aria-pressed="true"></button><button type="button" data-carousel-dot="1" aria-label="Show slide 2" aria-pressed="false"></button></div>
  </section>`;
}

function contactDetails() {
  return `<address class="contact-details"><div><span class="contact-icon" aria-hidden="true">⌖</span><div><strong>Address</strong><p>Irving Warehouse-207204<br>100 Circle Road, Ammann-C111<br>Stony Brook, NY 11790-3607</p></div></div><div><span class="contact-icon" aria-hidden="true">☎</span><div><strong>Phone</strong><a href="tel:6175153053">6175153053</a></div></div><div><span class="contact-icon" aria-hidden="true">✉</span><div><strong>Email</strong><a href="mailto:BD@arvivatherap.com">BD@arvivatherap.com</a></div></div><div><span class="contact-icon" aria-hidden="true">↗</span><div><strong>Website</strong><a href="${ROUTES.home}">arvivatherap.com</a></div></div></address>`;
}

function contactForm(id) {
  return `<form class="contact-form" data-contact-form>
    <div class="form-row"><label for="${id}-name">Name<input id="${id}-name" name="name" autocomplete="name" required maxlength="100"></label><label for="${id}-email">Email<input id="${id}-email" name="email" type="email" autocomplete="email" required maxlength="254"></label></div>
    <label for="${id}-subject">Subject<input id="${id}-subject" name="subject" required maxlength="160"></label>
    <label for="${id}-message">Message<textarea id="${id}-message" name="message" rows="4" required maxlength="3000"></textarea></label>
    <p class="form-help">${e(copy.contactHelp)}</p>
    <button class="primary-button" type="submit">Open email draft <span aria-hidden="true">↗</span></button>
    <p class="form-status" role="status" aria-live="polite"></p>
    <a class="email-fallback" href="mailto:BD@arvivatherap.com">Or email BD@arvivatherap.com directly</a>
  </form>`;
}

function newsCard(article) {
  return `<article class="news-card"><a class="news-image" href="${article.href}" tabindex="-1" aria-hidden="true">${img(article.cover.split('/').pop(),article.title)}</a><div class="news-card-content"><h3><a href="${article.href}">${e(article.title)}</a></h3><p>${e(article.excerpt)}</p><a class="read-more" href="${article.href}">Read article <span aria-hidden="true">→</span><span class="sr-only">: ${e(article.title)}</span></a></div></article>`;
}

function home(articles) {
  const approach = copy.home.approach.map(item=>`<p><a class="research-topic-link" href="${ROUTES.intelligent}#research-platform"><strong>${e(item.title)}</strong></a> <span>${e(item.description)}</span></p>`).join('');
  const videos = [['parkinsons-en-sd.mp4','175297174.jpg',"A new era in Parkinson’s treatment"],['obesity-en-sd.mp4','174621906.png','Obesity and the future of treatment'],['alzheimers-en-sd.mp4','175297136.jpg',"Understanding Alzheimer’s disease"]];
  return carousel() + `<section class="section company-section"><h2 class="section-heading">${e(copy.home.companyTitle)}</h2><p class="lead">${e(copy.home.company)}</p></section>
  <section class="section pipeline-section"><h2 class="section-heading">${e(copy.home.focusTitle)}</h2><p class="lead">${e(copy.home.focus)}</p><div class="section-action">${link(e(copy.home.focusLink),ROUTES.intelligent)}</div></section>
  <section class="section patent-section"><h2 class="section-heading">${e(copy.home.approachTitle)}</h2><div class="prose lead">${approach}</div><div class="section-action">${link(e(copy.home.approachLink),ROUTES.intelligent)}</div></section>
  <section class="section advantages-section"><h2 class="section-heading">${e(copy.home.strengthsTitle)}</h2><div class="advantages-grid"><article class="advantage talent"><h3>${e(copy.home.expertiseTitle)}</h3>${copy.home.expertise.map(p=>`<p>${e(p)}</p>`).join('')}</article><div class="advantage-image">${img('33316489.png','Talent, technology and market working together')}</div><article class="advantage market"><h3>${e(copy.home.purposeTitle)}</h3>${copy.home.purpose.map(p=>`<p>${e(p)}</p>`).join('')}</article><article class="advantage technology"><h3>${e(copy.home.technologyTitle)}</h3>${copy.home.technology.map(p=>`<p>${e(p)}</p>`).join('')}</article></div></section>
  <section class="section news-section"><div class="section-heading-row"><h2 class="section-heading">${e(copy.home.newsTitle)}</h2>${link('View all news',ROUTES.news)}</div><div class="video-grid">${videos.map(([file,poster,title])=>`<figure class="video-card"><video controls playsinline preload="metadata" poster="/assets/images/${poster}" aria-label="${e(title)}"><source src="/assets/videos/${file}" type="video/mp4">Your browser does not support video. <a href="/assets/videos/${file}">Download video</a></video><figcaption>${e(title)}</figcaption></figure>`).join('')}</div><div class="news-grid">${articles.slice(0,4).map(newsCard).join('')}</div></section>
  <section class="section contact-section"><h2 class="section-heading">${e(copy.home.contactTitle)}</h2><div class="contact-grid">${contactDetails()}${contactForm('home')}</div></section>`;
}

function about() {
  return `<section class="section about-section"><h2 class="section-heading">${e(copy.about.companyTitle)}</h2><div class="prose lead"><p>${e(copy.about.company)}</p></div></section><section class="section about-section"><h2 class="section-heading">${e(copy.about.teamTitle)}</h2><div class="prose lead"><p>${e(copy.about.team)}</p></div></section>`;
}

function investors() {
  const modelImages=['33312303.png','33312301.png','33312302.png'];
  return `<section class="section"><h2 class="section-heading">${e(copy.investors.title)}</h2><p class="lead">${e(copy.investors.introduction)}</p></section><section class="section"><h2 class="section-heading">${e(copy.investors.overviewTitle)}</h2><div class="investor-overview">${img('33316488.jpeg','Arviva Therapeutics investment and development model')}<div><h3>${e(copy.investors.collaborationTitle)}</h3><p>${e(copy.investors.collaboration)}</p><h3>${e(copy.investors.portfolioTitle)}</h3><p>${e(copy.investors.portfolio[0])}</p><p>${e(copy.investors.portfolio[1])}</p><h3>${e(copy.investors.valueTitle)}</h3></div></div></section><section class="section"><h2 class="section-heading">${e(copy.investors.modelTitle)}</h2><p class="lead">${e(copy.investors.modelIntroduction)}</p><div class="model-grid">${copy.investors.models.map((model,index)=>`<article>${img(modelImages[index],model.title)}<h3>${e(model.title)}</h3><p>${e(model.description)}</p></article>`).join('')}</div></section><section class="contact-strip"><p>${e(copy.investors.contact)}</p>${link(e(copy.investors.contactLink),ROUTES.contact)}</section>`;
}

function drugDesign() {
  return `<div class="drug-design-page">
    <section class="design-intro"><h2>${e(designCopy.title)}</h2><p class="lead">${e(designCopy.introduction)}</p></section>
    <section class="section"><h2 class="section-heading">${e(designCopy.platformsTitle)}</h2><div class="design-platform-grid">${designCopy.platforms.map((platform,index)=>`<article class="design-platform"><div class="design-platform-image">${img(platform.image,'')}</div><div class="design-platform-label"><span class="design-platform-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><h3>${e(platform.title)}</h3></div></article>`).join('')}</div></section>
    <section class="section"><h2 class="section-heading">${e(designCopy.headquartersTitle)}</h2><div class="design-headquarters"><div><p class="lead">${e(designCopy.headquartersDescription)}</p><h3 class="design-subheading">${e(designCopy.strategyTitle)}</h3><ol class="design-strategy">${designCopy.strategy.map(item=>`<li><h4>${e(item.title)}</h4><p>${e(item.description)}</p></li>`).join('')}</ol></div><aside class="design-contact"><h3>${e(copy.contactTitle)}</h3>${contactDetails()}</aside></div></section>
    <section class="section"><h2 class="section-heading">${e(designCopy.productionTitle)}</h2><div class="design-production">${designCopy.productionPhotos.map(photo=>`<figure>${img(photo.image,photo.alt)}</figure>`).join('')}</div></section>
    <section class="contact-strip design-mission"><p>${e(designCopy.mission)}</p>${link('Contact Us',ROUTES.contact)}</section>
  </div>`;
}

function platformPlaceholder(product) {
  return `<section class="development-page"><p class="eyebrow">${e(product.name)}</p><div class="development-symbol" aria-hidden="true">⋯</div><h2>${e(copy.platforms.status)}</h2><a class="primary-button" href="${ROUTES.intelligent}">Back to platforms <span aria-hidden="true">→</span></a></section>`;
}

export async function renderPages({articles}) {
  const order=ARTICLE_ROUTES.map(article => article.id);
  const sorted = [...articles].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
  const pages = new Map([
    [ROUTES.home,shell('Home Page',ROUTES.home,home(sorted))],
    [ROUTES.about,shell('About Us',ROUTES.about,about(),copy.descriptions.about)],
    [ROUTES.intelligent,shell('Super Intelligent Medicine',ROUTES.intelligent,medicineModules(),copy.descriptions.intelligent)],
    [ROUTES.drugDesign,shell('Innovative Drug Design',ROUTES.drugDesign,drugDesign(),designCopy.description)],
    [ROUTES.investors,shell('Investor Zone',ROUTES.investors,investors(),copy.descriptions.investors)],
    [ROUTES.news,shell(copy.newsTitle,ROUTES.news,`<section class="news-banner"><h2>${e(copy.newsTitle)}</h2></section><section class="section news-list">${sorted.map(newsCard).join('')}</section>`,copy.descriptions.news)],
    [ROUTES.contact,shell('Contact Us',ROUTES.contact,`<section class="section contact-page"><h2 class="section-heading">${e(copy.contactTitle)}</h2><div class="contact-grid">${contactDetails()}${contactForm('contact')}</div></section>`,copy.descriptions.contact)]]);
  for (const product of PRODUCTS) {
    pages.set(product.url,shell(product.name,ROUTES.intelligent,platformPlaceholder(product)));
  }
  pages.set('/plans', shell('Plans & payment', ROUTES.intelligent, renderCheckoutPage(), 'Preview monthly plans and payment options for Arviva Therapeutics platforms.', '<link rel="stylesheet" href="/checkout.css"><meta name="robots" content="noindex">'));
  for (const article of sorted) {
    pages.set(article.href,shell(article.title,ROUTES.news,`<article class="article-page"><a class="article-back" href="${ROUTES.news}">← ${e(copy.newsTitle)}</a><h2 class="article-title">${e(article.title)}</h2>${renderArticleBody(article)}<div class="article-end">${link('All news',ROUTES.news)}</div></article>`,article.excerpt));
  }
  pages.set('/',pages.get(ROUTES.home));
  pages.set('/404.html',shell('Page not found','',`<section class="development-page"><p class="eyebrow">404</p><h2>Page not found</h2><a class="primary-button" href="${ROUTES.home}">Back to home →</a></section>`));
  return pages;
}
