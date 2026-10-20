import { readFile } from 'node:fs/promises';

// Product hosts currently serve only index.html. Embed media so the built demo
// remains self-contained and does not require new Nginx asset routes.
export async function renderResearchDemo() {
  let html = await readFile(new URL('../src/research-demo.html', import.meta.url), 'utf8');
  const references = new Set(html.match(/\/assets\/research\/[a-z0-9-]+\.(?:png|jpg)/g) || []);
  for (const reference of references) {
    const bytes = await readFile(new URL(`../src${reference}`, import.meta.url));
    const mime = reference.endsWith('.png') ? 'image/png' : 'image/jpeg';
    html = html.replaceAll(reference, `data:${mime};base64,${bytes.toString('base64')}`);
  }
  return html;
}
