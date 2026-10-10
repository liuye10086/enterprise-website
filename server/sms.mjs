import {createHash} from 'node:crypto';
import {chmod,mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import Dypnsapi from '@alicloud/dypnsapi20170525';
import OpenApi from '@alicloud/openapi-core';
import Dara from '@darabonba/typescript';

const loopback=value=>['localhost','127.0.0.1','[::1]','::1'].includes(value);
const deliveryError=()=>Object.assign(new Error('The verification SMS could not be sent. Please try again later.'),{status:503,code:'sms_delivery_failed'});

export function createSmsSender(config,{createClient=sdkConfig=>new Dypnsapi.default(sdkConfig)}={}) {
  const development=config.smsMode==='development';
  if (development&&(config.production||!loopback(config.host)||!loopback(new URL(config.origin).hostname))) {
    throw new Error('development SMS requires a loopback-only development server.');
  }
  const ready=development||config.smsMode==='aliyun-pnvs';
  // PNVS is separate from Dysmsapi. SDK v2 reads retryOptions from client config.
  const client=config.smsMode==='aliyun-pnvs'?createClient(new OpenApi.$OpenApiUtil.Config({
    accessKeyId:config.aliyunSms.accessKeyId,
    accessKeySecret:config.aliyunSms.accessKeySecret,
    endpoint:'dypnsapi.aliyuncs.com',protocol:'https',
    connectTimeout:10000,readTimeout:10000,
    retryOptions:new Dara.RetryOptions({retryable:false}),
  })):null;

  return {ready,development,async sendCode({phone,code,expiresMinutes}) {
    if (!ready) throw Object.assign(new Error('SMS delivery is not configured yet.'),{status:503,code:'sms_unavailable'});
    if (typeof phone!=='string'||!/^\+861[3-9]\d{9}$/.test(phone)) throw Object.assign(new Error('A normalized +86 mobile number is required.'),{status:400,code:'invalid_phone'});
    if (typeof code!=='string'||!/^\d{6}$/.test(code)) throw new TypeError('A six-digit verification code is required.');
    if (!Number.isSafeInteger(expiresMinutes)||expiresMinutes<1||!Number.isSafeInteger(expiresMinutes*60)) throw new TypeError('A positive whole-minute expiry is required.');
    try {
      if (development) {
        await mkdir(config.developmentSmsDir,{recursive:true,mode:0o700});
        await chmod(config.developmentSmsDir,0o700);
        const filename=createHash('sha256').update(phone).digest('hex')+'.json';
        const file=await open(path.join(config.developmentSmsDir,filename),'w',0o600);
        try {
          await file.chmod(0o600);
          await file.writeFile(JSON.stringify({delivery:'local-development-only',phone,code,createdAt:new Date().toISOString(),expiresMinutes},null,2)+'\n');
        } finally {await file.close();}
        return;
      }

      // A concrete code in TemplateParam is delivered as-is and checked locally.
      // AutoRetry controls PNVS's own resends, independently of SDK HTTP retries.
      const request=new Dypnsapi.SendSmsVerifyCodeRequest({
        phoneNumber:phone.slice(3),countryCode:'86',
        signName:config.aliyunSms.signName,templateCode:config.aliyunSms.templateCode,
        schemeName:config.aliyunSms.schemeName,
        templateParam:JSON.stringify({code,min:String(expiresMinutes)}),
        validTime:expiresMinutes*60,returnVerifyCode:false,autoRetry:0,
      });
      const runtime=new Dara.RuntimeOptions({connectTimeout:10000,readTimeout:10000,ignoreSSL:false});
      const result=await client.sendSmsVerifyCodeWithOptions(request,runtime);
      if (result?.body?.code!=='OK'||result.body.success!==true) throw deliveryError();
    } catch {
      // SDK errors may contain the request, credentials, code and recipient.
      throw deliveryError();
    }
  }};
}
