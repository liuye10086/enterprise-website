import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'website-server-'));
  const root = path.join(base, 'dist');
  await mkdir(path.join(root, 'home'), {recursive: true});
  await mkdir(path.join(root, 'newsinfo'));
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'home/index.html'), '<h1>Home</h1>');
  await writeFile(path.join(root, 'newsinfo/123.html'), '<p>Article</p>');
  await writeFile(path.join(root, 'assets/movie.mp4'), '0123456789');
  await writeFile(path.join(base, 'secret.txt'), 'private');
  await symlink(base, path.join(root, 'escape'), 'junction');
  const {createStaticServer} = await import('../scripts/server.mjs');
  const server = createStaticServer({root});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(base, {recursive: true, force: true}); });
  const request = (url, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port: server.address().port, path: url, ...options}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()}));
    });
    req.on('error', reject); req.end();
  });
  return request;
}

test('serves extensionless pages, article URLs and HEAD with correct MIME', async t => {
  const request = await fixture(t);
  const home = await request('/home?from=nav');
  assert.equal(home.status, 200); assert.equal(home.body, '<h1>Home</h1>');
  assert.match(home.headers['content-type'], /^text\/html/);
  assert.equal((await request('/newsinfo/123.html')).body, '<p>Article</p>');
  const head = await request('/assets/movie.mp4', {method: 'HEAD'});
  assert.equal(head.status, 200); assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], '10'); assert.equal(head.headers['content-type'], 'video/mp4');
});

test('returns real 404 and rejects traversal, directory listing and symlink escape', async t => {
  const request = await fixture(t);
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await request('/assets/')).status, 404);
  for (const url of ['/../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%5csecret.txt', '/..%20/secret.txt', '/escape/secret.txt', '/assets/movie.mp4:secret']) {
    const response = await request(url);
    assert.ok([400, 403, 404].includes(response.status), url);
    assert.notEqual(response.body, 'private');
  }
  assert.equal((await request('/%ZZ')).status, 400);
  assert.equal((await request('/home', {method: 'POST'})).status, 405);
  assert.equal((await request('/home')).status, 200);
});

test('streams bounded, open-ended and suffix byte ranges and rejects invalid ranges', async t => {
  const request = await fixture(t);
  for (const [range, body, contentRange] of [['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=7-', '789', 'bytes 7-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-99', '89', 'bytes 8-9/10']]) {
    const response = await request('/assets/movie.mp4', {headers: {Range: range}});
    assert.equal(response.status, 206); assert.equal(response.body, body);
    assert.equal(response.headers['content-range'], contentRange);
    assert.equal(response.headers['content-length'], String(body.length));
  }
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=wat']) {
    const response = await request('/assets/movie.mp4', {headers: {Range: range}});
    assert.equal(response.status, 416); assert.equal(response.headers['content-range'], 'bytes */10');
  }
  const head = await request('/assets/movie.mp4', {method: 'HEAD', headers: {Range: 'bytes=2-5'}});
  assert.equal(head.status, 206); assert.equal(head.body, ''); assert.equal(head.headers['content-length'], '4');
});
