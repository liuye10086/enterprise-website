import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const routes = ['/sy','/gywm','/kyfw','/ythpt','/tzzzq','/xwzx','/lxwm','/research-platform','/prediction-platform'];
const articleIds = ['3099692','7224','7114','7062','7050'];
const pageFile = route => path.join(root, route.endsWith('.html') ? route : route + '/index.html');

test('all site routes are independently generated with navigation', async () => {
  for (const route of [...routes, ...articleIds.map(id => `/newsinfo/${id}.html`)]) {
    const html = await readFile(pageFile(route), 'utf8');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<nav/);
    assert.match(html, /<main id="main-content"/);
    assert.match(html, /Arviva Therapeutics/);
  }
});

test('medicine product entries require access checks and drug design remains under development', async () => {
  const medicine = await readFile(pageFile('/kyfw'), 'utf8');
  assert.match(medicine, /<title>Super Intelligent Medicine \|/);
  assert.doesNotMatch(medicine, /功能开发中/);
  assert.match(medicine, /<button[^>]*data-product-open="module-01"/);
  assert.match(medicine, /<button[^>]*data-product-open="module-02"/);
  for (const [route, name] of [['/research-platform', 'Research Platform'], ['/prediction-platform', 'Prediction Platform']]) {
    assert.ok(medicine.includes(`<h3 id="${route === '/research-platform' ? 'module-01' : 'module-02'}-title">${name}</h3>`));
    const platform = await readFile(pageFile(route), 'utf8');
    assert.ok(platform.includes(`<title>${name} |`));
    assert.match(platform, /<h2>This feature is coming soon<\/h2>/);
    assert.match(platform, /href="\/kyfw">Back to platforms/);
  }
  assert.doesNotMatch(medicine, /href="https:\/\/www\.(?:google|baidu)\.com/);
  await assert.doesNotReject(access(path.join(root,'access.js')));
  await assert.doesNotReject(access(path.join(root,'access-state.js')));
  const design = await readFile(pageFile('/ythpt'), 'utf8');
  assert.match(design, /<title>Innovative Drug Design \|/);
  assert.match(design, /功能开发中/);
  const all = await Promise.all(routes.map(route => readFile(pageFile(route), 'utf8')));
  assert.doesNotMatch(all.join(''), /-52791|2000000663|website\.xin|wezhan\.cn|video\.wanwang/);
  assert.doesNotMatch(all.join(''), /R &amp; D Innovation|Integration platform/);
});

test('every rendered internal link and media reference resolves locally', async () => {
  for (const route of [...routes, ...articleIds.map(id => `/newsinfo/${id}.html`)]) {
    const html = await readFile(pageFile(route), 'utf8');
    const refs = [...html.matchAll(/(?:src|href|poster)="(\/[^"#?]*)[^" ]*"/g)].map(match => match[1]);
    for (const ref of refs) {
      const filename = path.extname(ref) ? path.join(root, ref) : pageFile(ref);
      await assert.doesNotReject(access(filename), `${route} refers to missing ${ref}`);
    }
  }
});

test('home includes local playable videos and contact action explains the email draft', async () => {
  const home = await readFile(pageFile('/sy'), 'utf8');
  assert.equal((home.match(/<video\b/g) || []).length, 3);
  assert.match(home, /preload="metadata"/);
  const contact = await readFile(pageFile('/lxwm'), 'utf8');
  assert.match(contact, /Open email draft/);
  assert.match(contact, /Nothing is sent automatically/);
});
