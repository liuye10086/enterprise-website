import { SITE_ZH } from './locale-site-zh.mjs';
import { ACCESS_ZH, ACCESS_PATTERNS } from './locale-access-zh.mjs';
import { ARTICLES_ZH } from './locale-articles-zh.mjs';
import { DRUG_DESIGN_ZH } from './locale-drug-design-zh.mjs';
import { CHECKOUT_ZH } from './locale-checkout-zh.mjs';
import { PROFILE_ZH } from './locale-profile-zh.mjs';

export const LANGUAGE_KEY = 'arviva.language';
const normalize = value => String(value).replace(/\s+/g, ' ').trim();
const chinese = new Map(Object.entries({ ...SITE_ZH, ...ACCESS_ZH, ...ARTICLES_ZH, ...DRUG_DESIGN_ZH, ...CHECKOUT_ZH, ...PROFILE_ZH }).map(([key, value]) => [normalize(key), value]));
const supportedLocale = value => value === 'zh-CN' ? 'zh-CN' : 'en';

export function readPreferredLocale(storage) {
  try { return supportedLocale(storage?.getItem(LANGUAGE_KEY)); } catch { return 'en'; }
}

export function writePreferredLocale(storage, locale) {
  try {
    if (!storage) return false;
    storage.setItem(LANGUAGE_KEY, supportedLocale(locale));
    return true;
  } catch { return false; }
}

export function translateText(value, locale) {
  if (locale !== 'zh-CN' || !value.trim()) return value;
  const source = normalize(value);
  let result = chinese.get(source);
  if (result === undefined && source.endsWith(' | Arviva Therapeutics')) {
    const title = source.slice(0, -' | Arviva Therapeutics'.length);
    if (chinese.has(title)) result = `${chinese.get(title)} | Arviva Therapeutics`;
  }
  if (result === undefined && source.startsWith(': ') && chinese.has(source.slice(2))) {
    result = `：${chinese.get(source.slice(2))}`;
  }
  if (result === undefined) {
    for (const { pattern, format } of ACCESS_PATTERNS) {
      const match = source.match(pattern);
      if (match) { result = format(...match.slice(1)); break; }
    }
  }
  if (result === undefined) return value;
  return value.match(/^\s*/)[0] + result + value.match(/\s*$/)[0];
}

// Keep original text separate from its translation. A later application update
// becomes the new source; translating our own output never loses the English.
export function createTranslationCache(translate = translateText) {
  const owners = new WeakMap();
  return (owner, field, current, locale) => {
    let fields = owners.get(owner);
    if (!fields) { fields = new Map(); owners.set(owner, fields); }
    const previous = fields.get(field);
    const source = previous && current === previous.rendered ? previous.source : current;
    const rendered = translate(source, locale);
    fields.set(field, { source, rendered });
    return rendered;
  };
}

export function initializeLanguage(root = document) {
  let storage;
  try { storage = root.defaultView.localStorage; } catch { /* Private browsing may block storage. */ }
  let locale = readPreferredLocale(storage);
  const resolve = createTranslationCache();
  const excluded = 'script,style,noscript,input,textarea,code,pre,[translate="no"],[data-no-translate]';
  const attributes = ['aria-label', 'aria-roledescription', 'title', 'alt', 'placeholder'];
  const toggles = [...root.querySelectorAll('[data-language-toggle]')];
  let observer;

  const apply = () => {
    observer?.disconnect();
    root.documentElement.lang = locale;
    const walker = root.createTreeWalker(root.documentElement, 4); // SHOW_TEXT
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest(excluded)) continue;
      const value = resolve(node, 'text', node.nodeValue, locale);
      if (node.nodeValue !== value) node.nodeValue = value;
    }
    for (const element of root.querySelectorAll('[aria-label],[aria-roledescription],[title],[alt],[placeholder],meta[name="description"]')) {
      if (element.closest('[translate="no"],[data-no-translate]')) continue;
      const names = element.matches('meta[name="description"]') ? ['content'] : attributes;
      for (const name of names) {
        const current = element.getAttribute(name);
        if (current === null) continue;
        const value = resolve(element, name, current, locale);
        if (current !== value) element.setAttribute(name, value);
      }
    }
    for (const element of root.querySelectorAll('h2[lang]')) element.lang = locale;
    toggles.forEach(toggle => toggle.setAttribute('aria-checked', String(locale === 'zh-CN')));
    observer?.observe(root.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...attributes, 'content'] });
  };
  const setLocale = value => {
    locale = supportedLocale(value);
    writePreferredLocale(storage, locale);
    apply();
  };
  toggles.forEach(toggle => toggle.addEventListener('click', () => setLocale(locale === 'en' ? 'zh-CN' : 'en')));
  apply();
  observer = new root.defaultView.MutationObserver(apply);
  observer.observe(root.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...attributes, 'content'] });
  return { get locale() { return locale; }, setLocale, disconnect: () => observer.disconnect() };
}
