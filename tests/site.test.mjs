import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const routes = ['/home','/about','/intelligent','/drug-design','/investors','/news','/contact','/research-platform','/prediction-platform'];
const articleIds = ['3099692','7224','7114','7062','7050'];
const articleRoutes = ['recruitment-join-us-to-redefine-medicine','glp-1-the-key-behind-weight-loss','gut-microbiota-and-feeding-behavior','alzheimers-disease-pathogenesis','alzheimers-drug-development-pipeline-2025'].map(slug => '/news/'+slug);
const pageFile = route => path.join(root, route.endsWith('.html') ? route : route + '/index.html');

test('all site routes are independently generated with navigation', async () => {
  for (const route of ['/', '/404.html', ...routes, ...articleRoutes]) {
    const html = await readFile(pageFile(route), 'utf8');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<nav/);
    assert.match(html, /<main id="main-content"/);
    assert.match(html, /Arviva Therapeutics/);
    assert.match(html, /href="\/home"[^>]*>Home Page<\/a>/);
    assert.doesNotMatch(html, /href="\/(?:sy|gywm|kyfw|ythpt|tzzzq|xwzx|lxwm|newsinfo)(?:[/?#"])/);
    for (const section of routes.slice(0,7)) assert.ok(html.includes(`href="${section}"`), `${route} links to ${section}`);
    if (route.startsWith('/news/')) assert.match(html, /href="\/news" aria-current="page"/);
    else if (routes.slice(0,7).includes(route)) assert.ok(html.includes(`href="${route}" aria-current="page"`));
  }
});

test('home is also available at root and legacy content pages are not generated', async () => {
  const home = await readFile(pageFile('/home'), 'utf8');
  assert.equal(await readFile(pageFile('/'), 'utf8'), home);
  for (const legacy of ['/sy','/gywm','/kyfw','/ythpt','/tzzzq','/xwzx','/lxwm',...articleIds.map(id => `/newsinfo/${id}.html`)]) {
    await assert.rejects(access(pageFile(legacy)), {code: 'ENOENT'});
  }
});

test('medicine product entries require access checks and drug design restores archived platform content', async () => {
  const medicine = await readFile(pageFile('/intelligent'), 'utf8');
  assert.match(medicine, /<title>Super Intelligent Medicine \|/);
  assert.doesNotMatch(medicine, /功能开发中/);
  assert.match(medicine, /<button[^>]*data-product-open="module-01"/);
  assert.match(medicine, /<button[^>]*data-product-open="module-02"/);
  for (const [route, name] of [['/research-platform', 'Research Platform'], ['/prediction-platform', 'Prediction Platform']]) {
    assert.ok(medicine.includes(`<h3 id="${route === '/research-platform' ? 'module-01' : 'module-02'}-title">${name}</h3>`));
    const platform = await readFile(pageFile(route), 'utf8');
    assert.ok(platform.includes(`<title>${name} |`));
    assert.match(platform, /<h2>Platform in development<\/h2>/);
    assert.match(platform, /href="\/intelligent">Back to platforms/);
  }
  assert.doesNotMatch(medicine, /href="https:\/\/www\.(?:google|baidu)\.com/);
  await assert.doesNotReject(access(path.join(root,'access.js')));
  await assert.doesNotReject(access(path.join(root,'access-state.js')));
  const design = await readFile(pageFile('/drug-design'), 'utf8');
  assert.match(design, /<title>Innovative Drug Design \|/);
  const archive = JSON.parse(await readFile('backup/2026-10-10/pages/ythpt.json', 'utf8'));
  const visibleDesign = design.replace(/<[^>]*>/g, ' ').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
  assert.ok(visibleDesign.includes(archive.text.split('\n\n')[0]), 'preserves the archived R&D introduction');
  const platforms = archive.text.split('\n\n').find(block => block.startsWith('Compound Discovery')).split('\n');
  assert.equal(platforms.length, 12);
  for (const platform of platforms) assert.ok(visibleDesign.includes(platform), `restores ${platform}`);
  for (const heading of ['Headquarters Overview', 'Strategic Focus', 'Production Management']) assert.ok(visibleDesign.includes(heading));
  assert.doesNotMatch(design, /class="development-page"|<h2[^>]*>In development<\/h2>/);
  const all = await Promise.all(routes.map(route => readFile(pageFile(route), 'utf8')));
  assert.doesNotMatch(all.join(''), /-52791|2000000663|website\.xin|wezhan\.cn|video\.wanwang/);
  assert.doesNotMatch(all.join(''), /R &amp; D Innovation|Integration platform/);
});

test('every rendered internal link and media reference resolves locally', async () => {
  for (const route of [...routes, ...articleRoutes]) {
    const html = await readFile(pageFile(route), 'utf8');
    const refs = [...html.matchAll(/(?:src|href|poster)="(\/[^"#?]*)[^" ]*"/g)].map(match => match[1]);
    for (const ref of refs) {
      const filename = path.extname(ref) ? path.join(root, ref) : pageFile(ref);
      await assert.doesNotReject(access(filename), `${route} refers to missing ${ref}`);
    }
  }
});

test('home includes local playable videos and contact action explains the email draft', async () => {
  const home = await readFile(pageFile('/home'), 'utf8');
  assert.equal((home.match(/<video\b/g) || []).length, 3);
  assert.match(home, /preload="metadata"/);
  const contact = await readFile(pageFile('/contact'), 'utf8');
  assert.match(contact, /Open email draft/);
  assert.match(contact, /Nothing is sent automatically/);
});
