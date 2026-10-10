import {readdir, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
const layouts = JSON.parse(await readFile(new URL('./article-layout.json', import.meta.url),'utf8'));

function articleParagraphs(body) {
  return String(body ?? '').split(/\r?\n\r?\n/);
}
function verifiedLayout(article) {
  const layout=layouts[article.id];
  if(!layout || typeof layout!=='object') return null;
  let hash=2166136261;
  for(let i=0;i<article.body.length;i++) hash=Math.imul(hash^article.body.charCodeAt(i),16777619);
  if((hash>>>0).toString(16).padStart(8,'0')!==layout.bodyHash || articleParagraphs(article.body).length!==layout.paragraphCount || article.images.length!==layout.images.length || layout.images.some((image,index)=>article.images[index].src!==`/assets/images/${image.filename}`)) {
    throw new Error(`Article ${article.id} original content no longer matches its verified layout`);
  }
  return layout;
}

const covers = {
  '3099692': '173066242.jpg',
  '7224': '33303291.png',
  '7114': '33302710.png',
  '7062': '33302463.png',
  '7050': '33302416.png',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

async function localImage(image, articleDirectory, imagesDirectory) {
  const source = image.local_path;
  if (typeof source !== 'string' || !/^\.\.\/\.\.\/images\/[^/\\%\x00-\x1f]+$/.test(source)) {
    throw new Error(`Invalid image path: ${source}`);
  }
  const target = await realpath(path.resolve(articleDirectory, source));
  const relative = path.relative(imagesDirectory, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error(`Image path leaves image directory: ${source}`);
  }
  return {src:`/assets/images/${encodeURIComponent(path.basename(target))}`, alt:String(image.alt ?? '')};
}

export async function loadArticles(backupRoot) {
  const articleDirectory = path.resolve(backupRoot, 'pages/articles');
  const imagesDirectory = await realpath(path.resolve(backupRoot, 'images'));
  const files = (await readdir(articleDirectory)).filter(file => /^\d+\.json$/.test(file)).sort();
  return Promise.all(files.map(async file => {
    const id = file.slice(0, -5);
    const source = JSON.parse((await readFile(path.join(articleDirectory, file), 'utf8')).replace(/^\uFEFF/, ''));
    if (typeof source.body_text !== 'string') throw new Error(`Article ${id} has no original body_text`);
    const images = await Promise.all((source.article_images ?? []).map(image => localImage(image, articleDirectory, imagesDirectory)));
    const article = {
      id,
      title:String(source.title ?? ''),
      body:source.body_text,
      images,
      href:`/newsinfo/${id}.html`,
      excerpt:source.body_text.trim().slice(0, 180),
      cover:covers[id] ? `/assets/images/${covers[id]}` : (images[0]?.src ?? ''),
    };
    const layout=verifiedLayout(article);
    if(layout) {
      const paragraphs=articleParagraphs(article.body);
      const excluded=new Set([...layout.headings,...layout.captions]);
      article.excerpt=(paragraphs.find((paragraph,index)=>!excluded.has(index)&&paragraph.trim())??'').trim().slice(0,180);
    }
    return article;
  }));
}

export function renderArticleBody(article) {
  const layout=verifiedLayout(article);
  const figure=image=>`<div class="article-figures"><figure><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy"></figure></div>`;
  const blocks=articleParagraphs(article.body).map((paragraph,index)=>{
    const figures=layout ? layout.images.flatMap((image,i)=>image.before===index ? [figure(article.images[i])] : []).join('\n') : '';
    const tag=layout?.headings.includes(index) ? 'h2' : 'p';
    const attributes=layout?.captions.includes(index) ? ' class="article-caption"' : '';
    return `${figures}${figures?'\n':''}<${tag}${attributes}>${escapeHtml(paragraph)}</${tag}>`;
  });
  if(!layout) blocks.push(...(article.images??[]).map(figure));
  return `<div class="article-body">${blocks.join('\n')}</div>`;
}
