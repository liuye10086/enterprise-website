import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadArticles } from '../src/content.mjs';
import { renderPages } from '../src/render.mjs';
import {outputPath,completeOutputBuild} from './output-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function build() {
  const backupRoot = path.join(root,'backup','2026-10-10');
  const dist = path.join(root,'dist');
  const pages = await renderPages({articles:await loadArticles(backupRoot),backupRoot});
  await mkdir(dist,{recursive:true});
  const owned = [];
  const texts = [...pages.values()];
  for (const [route,html] of pages) {
    const relative = route === '/' ? 'index.html' : route.endsWith('.html') ? route.slice(1) : `${route.slice(1)}/index.html`;
    const target = await outputPath(dist,relative);
    await writeFile(target,html,'utf8');
    owned.push(relative);
  }
  for (const name of ['research-demo.html','styles.css','brand-theme.css','checkout.css','main.js','access.js','access-state.js','access-live.js','account-trigger.js','module-highlight.js','checkout.js','runtime-config.js','i18n.js','locale-site-zh.mjs','locale-access-zh.mjs','locale-articles-zh.mjs','locale-drug-design-zh.mjs','locale-checkout-zh.mjs']) {
    const text = await readFile(path.join(root,'src',name),'utf8');
    texts.push(text);
    await writeFile(await outputPath(dist,name),text,'utf8');
    owned.push(name);
  }
  const assets = new Set(texts.join('\n').match(/\/assets\/(?:images|videos)\/[a-zA-Z0-9._/-]+/g) || []);
  for (const asset of assets) {
    const relative = asset.slice('/assets/'.length);
    if (relative.split('/').includes('..')) throw new Error(`Unsafe asset path: ${asset}`);
    const target = await outputPath(dist,`assets/${relative}`);
    await copyFile(path.join(backupRoot,relative),target);
    owned.push(`assets/${relative}`);
  }
  await writeFile(await outputPath(dist,'robots.txt'),'User-agent: *\nAllow: /\n','utf8');
  owned.push('robots.txt');
  await completeOutputBuild(dist,owned);
  console.log(`Built ${pages.size} pages and ${assets.size} local media assets in dist/`);
  return {pageCount:pages.size,assetCount:assets.size};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await build();
}
