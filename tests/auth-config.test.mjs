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

test('SMS is disabled by default and its daily budget must be a positive integer', () => {
  const config=loadConfig(base);
  assert.equal(config.smsMode,'disabled');
  assert.equal(config.smsDailyLimit,100);
  assert.equal(config.developmentSmsDir,path.resolve('tmp/dev-sms'));
  assert.equal(loadConfig({...base,SMS_DAILY_LIMIT:'25'}).smsDailyLimit,25);
  for (const value of ['0','-1','1.5','abc','Infinity','9007199254740992']) {
    assert.throws(()=>loadConfig({...base,SMS_DAILY_LIMIT:value}),/SMS_DAILY_LIMIT/);
  }
});

test('development SMS is allowed only on a nonproduction loopback server', () => {
  assert.equal(loadConfig({...base,SMS_MODE:'development'}).smsMode,'development');
  assert.throws(()=>loadConfig({...base,SMS_MODE:'unknown'}),/SMS_MODE/);
  assert.throws(()=>loadConfig({...base,SMS_MODE:'development',HOST:'0.0.0.0'}),/loopback/);
  assert.throws(()=>loadConfig({...base,SMS_MODE:'development',APP_ORIGIN:'https://example.com'}),/loopback/);
  assert.throws(()=>loadConfig({...base,SMS_MODE:'development',NODE_ENV:'production',APP_ORIGIN:'https://example.com'}),/development/);
});

test('Aliyun PNVS configuration requires explicit credentials and console signature/template', () => {
  const settings={...base,SMS_MODE:'aliyun-pnvs',ALIYUN_SMS_ACCESS_KEY_ID:'test-id',ALIYUN_SMS_ACCESS_KEY_SECRET:'test-secret',ALIYUN_SMS_SIGN_NAME:'Test signature',ALIYUN_SMS_TEMPLATE_CODE:'100001'};
  for (const key of ['ALIYUN_SMS_ACCESS_KEY_ID','ALIYUN_SMS_ACCESS_KEY_SECRET','ALIYUN_SMS_SIGN_NAME','ALIYUN_SMS_TEMPLATE_CODE']) {
    assert.throws(()=>loadConfig({...settings,[key]:''}),/ALIYUN_SMS/);
  }
  assert.deepEqual(loadConfig({...settings,ALIYUN_SMS_SCHEME_NAME:'Arviva'}).aliyunSms,{
    accessKeyId:'test-id',accessKeySecret:'test-secret',signName:'Test signature',templateCode:'100001',schemeName:'Arviva',
  });
  assert.throws(()=>loadConfig({...settings,ALIYUN_SMS_SCHEME_NAME:'x'.repeat(21)}),/SCHEME_NAME/);
  assert.equal(loadConfig(base).aliyunSms.accessKeyId,undefined);
  assert.equal(loadConfig(base).aliyunSms.accessKeySecret,undefined);
});
