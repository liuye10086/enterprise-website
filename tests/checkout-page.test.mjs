import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

test('the generated checkout preview is independently reachable with both plans and payment methods', async () => {
  const html = await readFile('dist/plans/index.html', 'utf8');
  assert.match(html, /<title>Plans &amp; payment \| Arviva Therapeutics/);
  for (const value of ['standard', 'pro']) assert.match(html, new RegExp(`name="plan"[^>]*value="${value}"`));
  for (const value of ['alipay', 'wechat']) assert.match(html, new RegExp(`name="payment-method"[^>]*value="${value}"`));
  assert.match(html, /data-checkout-step="payment"[^>]*hidden/);
  assert.match(html, /data-checkout-error[^>]*hidden/);
  assert.match(html, /DEMO/);
  assert.doesNotMatch(html, /data-access-purchase|Simulate purchase|Payment successful/);
  for (const ref of [...html.matchAll(/(?:src|href)="(\/[^"#?]*)[^" ]*"/g)].map(match => match[1])) {
    await assert.doesNotReject(access(path.extname(ref) ? path.join('dist', ref) : path.join('dist', ref, 'index.html')));
  }
});
