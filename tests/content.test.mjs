import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const module = await import('../src/content.mjs').catch(() => ({}));
const backup = path.resolve('backup/2026-10-10');

test('content exports its public API', () => {
  for (const name of ['loadArticles', 'renderArticleBody', 'escapeHtml']) assert.equal(typeof module[name], 'function');
});
test('all five backup articles retain complete original bodies and local image order', async () => {
  const articles = await module.loadArticles(backup);
  assert.equal(articles.length, 5);
  const covers = {'3099692':'173066242.jpg','7224':'33303291.png','7114':'33302710.png','7062':'33302463.png','7050':'33302416.png'};
  for (const article of articles) {
    const source = JSON.parse((await readFile(path.join(backup, 'pages/articles', `${article.id}.json`), 'utf8')).replace(/^\uFEFF/, ''));
    assert.equal(article.body, source.body_text);
    assert.equal(article.title, source.title);
    assert.equal(article.href, `/newsinfo/${article.id}.html`);
    assert.equal(article.cover, `/assets/images/${covers[article.id]}`);
    assert.ok(article.body.includes(article.excerpt));
    assert.deepEqual(article.images, source.article_images.map(image => ({src:`/assets/images/${path.basename(image.local_path)}`,alt:image.alt})));
  }
});
test('BOM JSON is supported and unsafe image paths are rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'content-test-'));
  try {
    await mkdir(path.join(root, 'pages/articles'), {recursive:true});
    await mkdir(path.join(root, 'images'));
    await writeFile(path.join(root, 'images/photo.png'), 'image');
    const file = path.join(root, 'pages/articles/123.json');
    await writeFile(file, '\uFEFF'+JSON.stringify({title:'Original',body_text:' First line\n\nLast line. ',article_images:[{local_path:'../../images/photo.png',alt:'Photo'}]}));
    const [article] = await module.loadArticles(root);
    assert.equal(article.body, ' First line\n\nLast line. ');
    assert.equal(article.images[0].src, '/assets/images/photo.png');
    for (const local_path of ['../../../secret.png','../../images/../../secret.png','C:\\secret.png','../../images/%2e%2e/secret.png']) {
      await writeFile(file, JSON.stringify({body_text:'Body',article_images:[{local_path}]}));
      await assert.rejects(() => module.loadArticles(root), /image|path/i);
    }
  } finally { await rm(root, {recursive:true,force:true}); }
});
test('rendering escapes text and attributes and places figures after complete paragraphs', () => {
  assert.equal(module.escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
  const html = module.renderArticleBody({body:' Start <script>alert(1)</script> &\n\nEnd "quoted" ',images:[{src:'/assets/images/photo.png',alt:'" onerror="bad'}]});
  assert.ok(html.includes(' Start &lt;script&gt;alert(1)&lt;/script&gt; &amp;'));
  assert.ok(html.includes('End &quot;quoted&quot; '));
  assert.ok(html.indexOf('<figure>') > html.indexOf('End &quot;quoted&quot; '));
  assert.ok(html.includes('alt="&quot; onerror=&quot;bad"'));
  assert.ok(!html.includes('<script>'));
});
test('verified original DOM image positions interleave with every unchanged paragraph', async () => {
  const expected = {'7224':[5,7,10,14,20],'7114':[3,5,7,9,11],'7062':[1,5,19],'7050':[2,5,7],'3099692':[]};
  const articles=await module.loadArticles(backup);
  for(const article of articles) {
    const html=module.renderArticleBody(article);
    const paragraphs=article.body.split(/\r?\n\r?\n/);
    const rendered=[...html.matchAll(/<(p|h2)(?: class="[^"]*")?>(.*?)<\/\1>/gs)].map(match=>match[2]);
    assert.deepEqual(rendered,paragraphs.map(module.escapeHtml),`Every paragraph, including whitespace, survives for ${article.id}`);
    article.images.forEach((image,i)=>{
      const position=html.indexOf(`src="${image.src}"`);
      const before=expected[article.id][i];
      assert.ok(position<html.indexOf(module.escapeHtml(paragraphs[before])),`${article.id} image ${i} is before paragraph ${before}`);
      if(before>0) assert.ok(position>html.indexOf(module.escapeHtml(paragraphs[before-1])));
    });
    assert.equal((html.match(/<figure>/g)||[]).length,article.images.length);
  }
});
test('excerpts skip the original repeated title and figure captions',async()=>{
  const articles=await module.loadArticles(backup);
  const excerptParagraph={'7224':1,'7114':1,'7062':2,'7050':1,'3099692':0};
  for(const article of articles) assert.equal(article.excerpt,article.body.split(/\r?\n\r?\n/)[excerptParagraph[article.id]].trim().slice(0,180));
});
test('verified article layout refuses to guess positions when original body changes',async()=>{
  const [article]=await module.loadArticles(backup);
  assert.throws(()=>module.renderArticleBody({...article,body:article.body+' changed'}),/layout|original/i);
});
