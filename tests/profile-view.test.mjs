import test from 'node:test';
import assert from 'node:assert/strict';

const view = await import('../src/profile-view.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});

function page() {
  assert.equal(typeof view.renderProfilePage, 'function', 'provide the profile page renderer');
  return view.renderProfilePage();
}

function input(html, name) {
  const field = html.match(new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`, 'i'))?.[0];
  assert.ok(field, `provide the ${name} field`);
  const id = field.match(/\bid="([^"]+)"/)?.[1];
  assert.ok(id, `${name} has a stable id`);
  assert.match(html, new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>`), `${name} has an associated label`);
  return field;
}

test('profile page requires name, verified email and a separate contact number', () => {
  const html = page();
  const name = input(html, 'fullName');
  const email = input(html, 'email');
  const phone = input(html, 'contactPhone');
  for (const field of [name, email, phone]) assert.match(field, /\brequired(?:\s|>)/);
  assert.match(name, /\bmaxlength="100"/);
  assert.match(name, /\bautocomplete="name"/);
  assert.match(email, /\btype="email"/);
  assert.match(email, /\breadonly(?:\s|>)/, 'account email cannot be edited as contact information');
  assert.match(phone, /\btype="tel"/);
  assert.match(phone, /\bautocomplete="tel"/);
  assert.match(phone, /\bmaxlength="32"/);
});

test('organization and research area are optional and the filing date is read-only', () => {
  const html = page();
  for (const name of ['organization', 'researchArea']) {
    const field = input(html, name);
    assert.doesNotMatch(field, /\brequired(?:\s|>)/);
    assert.match(field, /\bmaxlength="200"/);
  }
  assert.match(html, /data-profile-date[^>]*>Recorded when you save</);
  assert.doesNotMatch(html, /<input\b[^>]*\btype="date"/);
});

test('profile page provides accessible loading, guest, retry and save states', () => {
  const html = page();
  assert.match(html, /<section\b[^>]*data-profile-page/);
  assert.match(html, /data-profile-guest[\s\S]*?data-login-open/);
  assert.match(html, /data-profile-loading/);
  assert.match(html, /data-profile-load-error[\s\S]*?data-profile-retry/);
  assert.match(html, /<form\b[^>]*data-profile-form[^>]*\bhidden(?:\s|>)/);
  assert.match(html, /<[^>]+data-profile-status[^>]*role="status"/);
  assert.match(html, /<button\b[^>]*data-profile-save[^>]*type="submit"/);
  assert.match(html, /data-profile-complete[^>]*\bhidden(?:\s|>)/);
  assert.match(html, /data-profile-email-only[^>]*\bhidden(?:\s|>)/);
  assert.match(html, /href="\/intelligent"/);
});

test('profile reminder is a labelled native dialog that can be postponed', () => {
  assert.equal(typeof view.renderProfilePrompt, 'function', 'provide the profile reminder renderer');
  const html = view.renderProfilePrompt();
  assert.match(html, /<dialog\b[^>]*id="profile-prompt"[^>]*data-profile-prompt[^>]*aria-labelledby="profile-prompt-title"/);
  assert.match(html, /id="profile-prompt-title"[^>]*>Complete your profile</);
  assert.match(html, /<a\b[^>]*href="\/profile"[^>]*data-profile-go[^>]*>Complete profile<\/a>/);
  assert.match(html, /<button\b[^>]*data-profile-dismiss[^>]*>Maybe later<\/button>/);
  assert.match(html, /<button\b[^>]*data-profile-dismiss[^>]*aria-label="Close profile reminder"/);
  assert.doesNotMatch(html, /<dialog\b[^>]*\bopen(?:\s|>)/, 'initially closed until the login check decides to remind');
});
