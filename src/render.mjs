import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml as e, renderArticleBody } from './content.mjs';
import { renderAccessDialogs, medicineModules } from './access-view.mjs';
import { PRODUCTS } from './access-state.js';
import { SECTIONS, ROUTES, ARTICLE_ROUTES } from './routes.mjs';

const navigation = SECTIONS.map(section => [section.label, section.path]);
const img = (name, alt, className = '', loading = 'lazy') => `<img src="/assets/images/${e(name)}" alt="${e(alt)}" class="${className}" loading="${loading}" decoding="async">`;
const arrow = '<span aria-hidden="true">↗</span>';
const link = (label, href) => `<a class="text-link" href="${href}">${label} ${arrow}</a>`;
const paragraph = (source, prefix) => {
  const found = source.text.split(/\n\s*\n/).find(p => p.startsWith(prefix));
  if (!found) throw new Error(`Missing source paragraph: ${prefix}`);
  return e(found);
};

function header(active) {
  return `<a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header wrap">
    <div class="navigation-row">
      <a class="brand" href="${ROUTES.home}" aria-label="Arviva Therapeutics home">${img('33300796.jpg','Arviva Therapeutics','logo','eager')}</a>
      <nav id="primary-navigation" aria-label="Main navigation">${navigation.map(([label,href])=>`<a href="${href}"${active === href ? ' aria-current="page"' : ''}>${e(label)}</a>`).join('')}</nav>
      <div class="header-actions"><button class="login-trigger" type="button" data-login-open aria-haspopup="dialog" aria-controls="login-dialog"><span data-login-label>Log in</span> <span aria-hidden="true">↗</span></button><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" aria-label="Open navigation"><span></span><span></span><span></span></button></div>
    </div>
    <h1 class="company-name">Arviva Therapeutics Inc.</h1>
  </header>`;
}

function footer() {
  return `<footer class="site-footer wrap"><p>Copyright© Arviva Therapeutics Inc.</p><a href="mailto:BD@arvivatherap.com">BD@arvivatherap.com</a><a class="back-top" href="#top">Back to top ↑</a></footer>`;
}

function shell(title, active, body, description='Arviva Therapeutics — an R&D-driven, AI-powered biopharmaceutical company.') {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)} | Arviva Therapeutics</title><meta name="description" content="${e(description)}"><link rel="icon" href="/assets/images/33300796.jpg"><link rel="stylesheet" href="/styles.css"><script type="module" src="/main.js"></script></head><body id="top">${header(active)}<main id="main-content" class="wrap">${body}</main>${footer()}${renderAccessDialogs()}</body></html>`;
}

function carousel() {
  return `<section class="hero" aria-roledescription="carousel" aria-label="Our mission">
    <div class="hero-slide" data-slide="0"><div class="hero-content"><h2>Providing better treatment<br>solutions for global patients</h2><p>Offering new treatment options<br>for chronical diseases</p></div></div>
    <div class="hero-slide hero-slide--second" data-slide="1" hidden><div class="hero-content"><h2>Innovation is driving force.</h2><p>Starting from our endless dreams<br>to improve human health.</p></div></div>
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
    <label for="${id}-message">Message<textarea id="${id}-message" name="message" rows="5" required maxlength="3000"></textarea></label>
    <p class="form-help">Opens your email app. Nothing is sent automatically.</p>
    <button class="primary-button" type="submit">Open email draft <span aria-hidden="true">↗</span></button>
    <p class="form-status" role="status" aria-live="polite"></p>
    <a class="email-fallback" href="mailto:BD@arvivatherap.com">Or email BD@arvivatherap.com directly</a>
  </form>`;
}

function newsCard(article) {
  return `<article class="news-card"><a class="news-image" href="${article.href}" tabindex="-1" aria-hidden="true">${img(article.cover.split('/').pop(),article.title)}</a><div class="news-card-content"><h3><a href="${article.href}">${e(article.title)}</a></h3><p>${e(article.excerpt)}</p><a class="read-more" href="${article.href}">Read article <span aria-hidden="true">→</span><span class="sr-only">: ${e(article.title)}</span></a></div></article>`;
}

function home(source, articles) {
  const patents = ['Our company is dedicated','With a strong portfolio','In Alzheimer’s disease','For obesity and diabetes','These innovations reflect'].map(p=>`<p>${paragraph(source,p)}</p>`).join('');
  const videos = [['parkinsons-en-sd.mp4','175297174.jpg',"A new era in Parkinson’s treatment"],['obesity-en-sd.mp4','174621906.png','Obesity and the future of treatment'],['alzheimers-en-sd.mp4','175297136.jpg',"Understanding Alzheimer’s disease"]];
  return carousel() + `<section class="section company-section"><h2 class="section-heading">Our Company</h2><p class="lead">${paragraph(source,'We are an R&D-driven')}</p></section>
  <section class="section pipeline-section"><h2 class="section-heading">Our Pipeline</h2><p class="lead">${paragraph(source,'We are advancing six')}</p><div class="section-action">${link('Super Intelligent Medicine',ROUTES.intelligent)}</div></section>
  <section class="section patent-section"><h2 class="section-heading">Our Patent</h2><div class="prose lead">${patents}</div><div class="section-action">${link('Super Intelligent Medicine',ROUTES.intelligent)}</div></section>
  <section class="section advantages-section"><h2 class="section-heading">Our Advantages</h2><div class="advantages-grid"><article class="advantage talent"><h3>Talent</h3><p>Efficient and rigorous team collaboration capabilities</p><p>Scientific staff training system</p></article><div class="advantage-image">${img('33316489.png','Talent, technology and market working together')}</div><article class="advantage market"><h3>Market</h3><p>Pioneering blue ocean drug R&D in anti-aging, appetite control, and antidepressants</p><p>Unique advantages in entering overseas markets</p></article><article class="advantage technology"><h3>Technology</h3><p>Big Data and AI to Discover Unique Drug Targets</p><p>Unique peptide modification technology</p></article></div></section>
  <section class="section news-section"><div class="section-heading-row"><h2 class="section-heading">News</h2>${link('View all news',ROUTES.news)}</div><div class="video-grid">${videos.map(([file,poster,title])=>`<figure class="video-card"><video controls playsinline preload="metadata" poster="/assets/images/${poster}" aria-label="${e(title)}"><source src="/assets/videos/${file}" type="video/mp4">Your browser does not support video. <a href="/assets/videos/${file}">Download video</a></video><figcaption>${e(title)}</figcaption></figure>`).join('')}</div><div class="news-grid">${articles.slice(0,4).map(newsCard).join('')}</div></section>
  <section class="section contact-section"><h2 class="section-heading">Contact</h2><div class="contact-grid">${contactDetails()}${contactForm('home')}</div></section>`;
}

function about(source) {
  return `<section class="section about-section"><h2 class="section-heading">Our Company</h2><div class="prose lead"><p>${paragraph(source,'We are an AI-powered')}</p></div></section><section class="section about-section"><h2 class="section-heading">Our Team</h2><div class="prose lead"><p>${paragraph(source,'Our biotech company')}</p></div></section>`;
}

function investors(source) {
  const models=[['33312303.png','Ip-driven development','Drive innovation through'],['33312301.png','Long-term: IPO or acquisition','Plan for long-term growth'],['33312302.png','Licensing-out model to pharma/biotech','Establish strategic partnerships']];
  return `<section class="section"><h2 class="section-heading">Why invest in Arviva Therapeutics?</h2><p class="lead">${paragraph(source,'We unite science')}</p></section><section class="section"><h2 class="section-heading">Investor Area</h2><div class="investor-overview">${img('33316488.jpeg','Arviva Therapeutics investment and development model')}<div><h3>Business operation model</h3><p>Licensing-out, joint development and acquisitions</p><h3>Innovate to expand our pipeline</h3><p>Mergers and acquisitions</p><p>Acquire and merge drug pipelines to quickly lead the market</p><h3>Financial strength and resilience</h3></div></div></section><section class="section"><h2 class="section-heading">Business Model</h2><p class="lead">${paragraph(source,'We offer multiple')}</p><div class="model-grid">${models.map(([image,title,prefix])=>`<article>${img(image,title)}<h3>${title}</h3><p>${paragraph(source,prefix)}</p></article>`).join('')}</div></section><section class="contact-strip"><p>Connect with Arviva Therapeutics</p>${link('Contact Us',ROUTES.contact)}</section>`;
}

function placeholder(title) {
  return `<section class="development-page"><p class="eyebrow">${title}</p><div class="development-symbol" aria-hidden="true">⋯</div><h2 lang="zh-CN">功能开发中</h2><a class="primary-button" href="${ROUTES.home}">Back to home <span aria-hidden="true">→</span></a></section>`;
}

function platformPlaceholder(product) {
  return `<section class="development-page"><p class="eyebrow">${e(product.name)}</p><div class="development-symbol" aria-hidden="true">⋯</div><h2>This feature is coming soon</h2><a class="primary-button" href="${ROUTES.intelligent}">Back to platforms <span aria-hidden="true">→</span></a></section>`;
}

export async function renderPages({articles,backupRoot}) {
  const readPage = async name => JSON.parse((await readFile(path.join(backupRoot,'pages',`${name}.json`),'utf8')).replace(/^\uFEFF/,''));
  const [homeData,aboutData,investorData] = await Promise.all(['sy','gywm','tzzzq'].map(readPage));
  const order=ARTICLE_ROUTES.map(article => article.id);
  const sorted = [...articles].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
  const pages = new Map([
    [ROUTES.home,shell('Home Page',ROUTES.home,home(homeData,sorted))],
    [ROUTES.about,shell('About Us',ROUTES.about,about(aboutData))],
    [ROUTES.intelligent,shell('Super Intelligent Medicine',ROUTES.intelligent,medicineModules())],
    [ROUTES.drugDesign,shell('Innovative Drug Design',ROUTES.drugDesign,placeholder('Innovative Drug Design'))],
    [ROUTES.investors,shell('Investor Zone',ROUTES.investors,investors(investorData))],
    [ROUTES.news,shell('News information',ROUTES.news,`<section class="news-banner"><h2>News information</h2></section><section class="section news-list">${sorted.map(newsCard).join('')}</section>`)],
    [ROUTES.contact,shell('Contact Us',ROUTES.contact,`<section class="section contact-page"><h2 class="section-heading">Contact Us</h2><div class="contact-grid">${contactDetails()}${contactForm('contact')}</div></section>`)]]);
  for (const product of PRODUCTS) {
    pages.set(product.url,shell(product.name,ROUTES.intelligent,platformPlaceholder(product)));
  }
  for (const article of sorted) {
    pages.set(article.href,shell(article.title,ROUTES.news,`<article class="article-page"><a class="article-back" href="${ROUTES.news}">← News information</a><h2 class="article-title">${e(article.title)}</h2>${renderArticleBody(article)}<div class="article-end">${link('All news',ROUTES.news)}</div></article>`,article.excerpt));
  }
  pages.set('/',pages.get(ROUTES.home));
  pages.set('/404.html',shell('Page not found','',`<section class="development-page"><p class="eyebrow">404</p><h2>Page not found</h2><a class="primary-button" href="${ROUTES.home}">Back to home →</a></section>`));
  return pages;
}
