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

test('checkout has product navigation and account controls without the corporate navigation or footer', async () => {
  const html = await readFile('dist/plans/index.html', 'utf8');
  assert.match(html, /data-checkout-return/);
  assert.match(html, /data-language-toggle/);
  assert.match(html, /data-account-trigger/);
  assert.match(html, /data-login-dialog/);
  assert.doesNotMatch(html, /id="primary-navigation"|class="site-footer|class="company-name"/);
  const home = await readFile('dist/home/index.html', 'utf8');
  assert.match(home, /id="primary-navigation"/);
  assert.match(home, /class="site-footer/);
});

test('plan selection includes the selected price and next action alongside the plans', async () => {
  const html = await readFile('dist/plans/index.html', 'utf8');
  const planStep = html.split('data-checkout-step="plans"')[1]?.split('data-checkout-step="payment"')[0];
  assert.ok(planStep);
  assert.match(planStep, /data-selected-plan/);
  assert.match(planStep, /data-selected-price/);
  assert.match(planStep, /type="submit"/);
  assert.match(html, /This preview does not create an order or activate access/);
});
