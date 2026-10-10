import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';

export function createMailer(config) {
  const development=config.mailMode==='development';
  const ready=development||config.mailMode==='smtp';
  const transport=config.mailMode==='smtp'?nodemailer.createTransport({
    host:config.smtp.host,port:config.smtp.port,secure:config.smtp.secure,
    requireTLS:!config.smtp.secure,auth:config.smtp.auth,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
    tls:{rejectUnauthorized:true},
  }):null;
  return {ready,development,async sendCode({email,code,expiresMinutes}) {
    if (!ready) throw Object.assign(new Error('Email delivery is not configured yet.'),{status:503,code:'mail_unavailable'});
    if (development) {
      await mkdir(config.developmentMailDir,{recursive:true});
      const file=createHash('sha256').update(email).digest('hex')+'.json';
      await writeFile(path.join(config.developmentMailDir,file),JSON.stringify({delivery:'local-development-only',email,code,createdAt:new Date().toISOString(),expiresMinutes},null,2)+'\n',{mode:0o600});
      return;
    }
    const result=await transport.sendMail({
      from:config.smtp.from,to:{address:email},subject:'Your Arviva verification code',
      text:`Your Arviva Therapeutics verification code is ${code}.\n\nIt expires in ${expiresMinutes} minutes and can only be used once. If you did not request this code, you can ignore this message.`,
    });
    if (!result.accepted?.length) throw Object.assign(new Error('The verification email could not be sent. Please try again later.'),{status:503,code:'mail_delivery_failed'});
  }};
}
