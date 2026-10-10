import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Dypnsapi from '@alicloud/dypnsapi20170525';
import {loadConfig} from '../server/config.mjs';
import {createSmsSender} from '../server/sms.mjs';

const base={DATABASE_URL:'postgresql://user:secret@127.0.0.1/arviva_test',AUTH_SECRET:'s'.repeat(64)};
const aliyun={...base,SMS_MODE:'aliyun-pnvs',ALIYUN_SMS_ACCESS_KEY_ID:'test-id',ALIYUN_SMS_ACCESS_KEY_SECRET:'test-secret',ALIYUN_SMS_SIGN_NAME:'Test signature',ALIYUN_SMS_TEMPLATE_CODE:'100001',ALIYUN_SMS_SCHEME_NAME:'Arviva'};
const delivery={phone:'+8613800000000',code:'816294',expiresMinutes:10};

test('disabled SMS is unavailable and never creates an SDK client', async () => {
  const sender=createSmsSender(loadConfig(base),{createClient:()=>assert.fail('No SDK client may be created.')});
  assert.equal(sender.ready,false);
  assert.equal(sender.development,false);
  await assert.rejects(sender.sendCode(delivery),{status:503,code:'sms_unavailable'});
});

test('development SMS writes a private phone-hashed JSON file and returns no code', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'arviva-sms-test-'));
  try {
    const sender=createSmsSender({...loadConfig({...base,SMS_MODE:'development'}),developmentSmsDir:dir});
    assert.equal(sender.ready,true);
    assert.equal(sender.development,true);
    assert.equal(await sender.sendCode(delivery),undefined);
    const filename=createHash('sha256').update(delivery.phone).digest('hex')+'.json';
    assert.deepEqual(await readdir(dir),[filename]);
    const message=JSON.parse(await readFile(path.join(dir,filename),'utf8'));
    assert.deepEqual({...message,createdAt:undefined},{delivery:'local-development-only',...delivery,createdAt:undefined});
    assert.ok(Number.isFinite(Date.parse(message.createdAt)));
    if (process.platform!=='win32') {
      assert.equal((await stat(path.join(dir,filename))).mode&0o777,0o600);
      assert.equal((await stat(dir)).mode&0o777,0o700);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('the sender itself refuses development delivery in production or on public bindings', () => {
  const config=loadConfig({...base,SMS_MODE:'development'});
  for (const override of [{production:true},{host:'0.0.0.0'},{origin:'https://example.com'}]) {
    assert.throws(()=>createSmsSender({...config,...override}),/loopback/);
  }
});

test('Aliyun uses the official PNVS request with a local OTP, fixed endpoint and disabled retries', async () => {
  let capturedConfig;
  let capturedRequest;
  let capturedRuntime;
  const sender=createSmsSender(loadConfig(aliyun),{createClient:config=>{
    capturedConfig=config;
    return {async sendSmsVerifyCodeWithOptions(request,runtime) {
      capturedRequest=request; capturedRuntime=runtime;
      return {body:{code:'OK',success:true,model:{verifyCode:'must-not-be-returned'}}};
    }};
  }});
  assert.equal(sender.ready,true);
  assert.equal(sender.development,false);
  assert.equal(await sender.sendCode(delivery),undefined);
  assert.equal(capturedConfig.endpoint,'dypnsapi.aliyuncs.com');
  assert.equal(capturedConfig.protocol,'https');
  assert.equal(capturedConfig.accessKeyId,'test-id');
  assert.equal(capturedConfig.accessKeySecret,'test-secret');
  assert.equal(capturedConfig.retryOptions.retryable,false);
  assert.ok(capturedRequest instanceof Dypnsapi.SendSmsVerifyCodeRequest);
  assert.equal(capturedRequest.phoneNumber,'13800000000');
  assert.equal(capturedRequest.countryCode,'86');
  assert.equal(capturedRequest.signName,'Test signature');
  assert.equal(capturedRequest.templateCode,'100001');
  assert.equal(capturedRequest.schemeName,'Arviva');
  assert.deepEqual(JSON.parse(capturedRequest.templateParam),{code:'816294',min:'10'});
  assert.equal(capturedRequest.validTime,600);
  assert.equal(capturedRequest.returnVerifyCode,false);
  assert.equal(capturedRequest.autoRetry,0);
  assert.equal(capturedRuntime.connectTimeout,10000);
  assert.equal(capturedRuntime.readTimeout,10000);
  assert.equal(capturedRuntime.ignoreSSL,false);
});

test('official SDK serializes SendSmsVerifyCode and maps the provider response without network access', async () => {
  let requests=0;
  const sender=createSmsSender(loadConfig(aliyun),{createClient:config=>{
    const client=new Dypnsapi.default(config);
    // Replace the SDK network boundary, while exercising its real request/response mapping.
    client.callApi=async (params,request)=>{
      requests++;
      assert.equal(params.action,'SendSmsVerifyCode');
      assert.equal(params.version,'2017-05-25');
      assert.equal(params.protocol,'HTTPS');
      assert.equal(request.query.PhoneNumber,'13800000000');
      assert.equal(request.query.CountryCode,'86');
      assert.equal(String(request.query.AutoRetry),'0');
      assert.equal(String(request.query.ReturnVerifyCode),'false');
      assert.deepEqual(JSON.parse(request.query.TemplateParam),{code:'816294',min:'10'});
      return {statusCode:200,headers:{},body:{Code:'OK',Success:true}};
    };
    return client;
  }});
  assert.equal(await sender.sendCode(delivery),undefined);
  assert.equal(requests,1);
});

test('non-OK, malformed and explicit failed provider results become sanitized delivery errors', async () => {
  for (const result of [{body:{code:'BUSINESS_LIMIT_CONTROL',message:'private raw response'}},{body:{code:'OK',success:false}},{}]) {
    let calls=0;
    const sender=createSmsSender(loadConfig(aliyun),{createClient:()=>({async sendSmsVerifyCodeWithOptions(){calls++;return result;}})});
    await assert.rejects(sender.sendCode(delivery),error=>{
      assert.equal(error.status,503); assert.equal(error.code,'sms_delivery_failed');
      assert.doesNotMatch(JSON.stringify(error)+error.message,/BUSINESS_LIMIT|private|13800000000|test-secret|816294/);
      assert.equal(error.cause,undefined);
      return true;
    });
    assert.equal(calls,1);
  }
});

test('SDK failures are not retried and never leak credentials, phone numbers or raw responses', async () => {
  let calls=0;
  const sender=createSmsSender(loadConfig(aliyun),{createClient:()=>({async sendSmsVerifyCodeWithOptions(){
    calls++;
    throw Object.assign(new Error('test-secret +8613800000000 816294'),{data:{raw:'private response'}});
  }})});
  await assert.rejects(sender.sendCode(delivery),error=>{
    assert.equal(error.status,503); assert.equal(error.code,'sms_delivery_failed');
    assert.doesNotMatch(JSON.stringify(error)+error.message,/private|13800000000|test-secret|816294/);
    assert.equal(error.cause,undefined);
    return true;
  });
  assert.equal(calls,1);
});

test('delivery requires a normalized mainland number and a six-digit local code before provider access', async () => {
  const sender=createSmsSender(loadConfig(aliyun),{createClient:()=>({sendSmsVerifyCodeWithOptions:()=>assert.fail('Invalid data must never reach the provider.')})});
  for (const phone of ['13800000000','+15551234567','../escape','+8612800000000']) {
    await assert.rejects(sender.sendCode({...delivery,phone}),{code:'invalid_phone'});
  }
  await assert.rejects(sender.sendCode({...delivery,code:'##code##'}),/verification code/);
  await assert.rejects(sender.sendCode({...delivery,expiresMinutes:0}),/expiry/);
});
