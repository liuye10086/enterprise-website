import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadConfig} from '../server/config.mjs';
import {createMailer} from '../server/mailer.mjs';

const base = {DATABASE_URL:'postgresql://user:secret@127.0.0.1/arviva_test',AUTH_SECRET:'s'.repeat(64)};
test('production refuses insecure origin, weak secrets and development mail', () => {
  assert.throws(()=>loadConfig({...base,NODE_ENV:'production'}), /HTTPS/);
  assert.throws(()=>loadConfig({...base,AUTH_SECRET:'short'}), /AUTH_SECRET/);
  assert.throws(()=>loadConfig({...base,AUTH_SECRET:'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS'}), /AUTH_SECRET/);
  assert.throws(()=>loadConfig({...base,NODE_ENV:'production',APP_ORIGIN:'https://arvivatherap.com',MAIL_MODE:'development'}), /development/);
  assert.throws(()=>loadConfig({...base,MAIL_MODE:'development',HOST:'0.0.0.0'}), /loopback/);
  assert.throws(()=>loadConfig({...base,APP_ORIGIN:'https://example.com/path'}), /origin/);
  const prod=loadConfig({...base,NODE_ENV:'production',APP_ORIGIN:'https://arvivatherap.com'});
  assert.equal(prod.secureCookies,true);
  assert.equal(prod.mailMode,'disabled');
});
test('SMTP requires explicit credentials and does not silently turn into local delivery', () => {
  assert.throws(()=>loadConfig({...base,MAIL_MODE:'smtp',SMTP_HOST:'smtp.example.com'}), /SMTP/);
  assert.throws(()=>loadConfig({...base,MAIL_MODE:'unknown'}), /MAIL_MODE/);
  assert.equal(createMailer(loadConfig(base)).ready,false);
  assert.equal(loadConfig({...base,MAIL_MODE:'smtp',SMTP_HOST:'smtpdm.aliyun.com',SMTP_USER:'sender@example.com',SMTP_PASSWORD:'test-only',SMTP_FROM:'sender@example.com'}).smtp.secure,true);
});
test('development delivery writes only to its private directory and never returns a code', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'arviva-mail-test-'));
  try {
    const mailer=createMailer({...loadConfig({...base,MAIL_MODE:'development'}),developmentMailDir:dir});
    assert.equal(mailer.development,true);
    assert.equal(await mailer.sendCode({email:'qa@example.com',code:'816294',expiresMinutes:10}),undefined);
    const files=await readdir(dir);
    assert.equal(files.length,1);
    assert.match(files[0],/^[a-f0-9]{64}\.json$/);
    const message=JSON.parse(await readFile(path.join(dir,files[0]),'utf8'));
    assert.equal(message.code,'816294');
    assert.equal(message.email,'qa@example.com');
    assert.equal(message.delivery,'local-development-only');
  } finally {await rm(dir,{recursive:true,force:true});}
});
