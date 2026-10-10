// Public paths are independent of the original backup filenames and product IDs.
export const SECTIONS = Object.freeze([
  {key:'home', path:'/home', label:'Home Page', legacy:'/sy'},
  {key:'about', path:'/about', label:'About Us', legacy:'/gywm'},
  {key:'intelligent', path:'/intelligent', label:'Super Intelligent Medicine', legacy:'/kyfw'},
  {key:'drugDesign', path:'/drug-design', label:'Innovative Drug Design', legacy:'/ythpt'},
  {key:'investors', path:'/investors', label:'Investor Zone', legacy:'/tzzzq'},
  {key:'news', path:'/news', label:'News information', legacy:'/xwzx'},
  {key:'contact', path:'/contact', label:'Contact Us', legacy:'/lxwm'},
].map(Object.freeze));

export const ROUTES = Object.freeze(Object.fromEntries(SECTIONS.map(section => [section.key, section.path])));

// Keep these slugs stable when an article's display title changes.
export const ARTICLE_ROUTES = Object.freeze([
  {id:'3099692', path:'/news/recruitment-join-us-to-redefine-medicine'},
  {id:'7224', path:'/news/glp-1-the-key-behind-weight-loss'},
  {id:'7114', path:'/news/gut-microbiota-and-feeding-behavior'},
  {id:'7062', path:'/news/alzheimers-disease-pathogenesis'},
  {id:'7050', path:'/news/alzheimers-drug-development-pipeline-2025'},
].map(Object.freeze));

const redirects = new Map();
for (const section of SECTIONS) {
  for (const alias of [section.legacy, section.legacy+'/', section.legacy+'/index.html', section.path+'/', section.path+'/index.html']) {
    redirects.set(alias, section.path);
  }
}
for (const article of ARTICLE_ROUTES) {
  for (const alias of [`/newsinfo/${article.id}.html`, article.path+'/', article.path+'/index.html']) {
    redirects.set(alias, article.path);
  }
}

// Exact allowlist only: never interpret a requested destination or normalize unknown paths.
export function publicRedirect(pathname) {
  return redirects.get(pathname) ?? null;
}
