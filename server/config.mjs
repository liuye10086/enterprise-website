import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const loopback=value=>['localhost','127.0.0.1','[::1]','::1'].includes(value);
function port(value,fallback) {
  const result=Number(value || fallback);
  if (!Number.isInteger(result)||result<1||result>65535) throw new Error('Invalid port configuration.');
  return result;
}
export function loadConfig(env=process.env) {
  const production=env.NODE_ENV==='production';
  const host=env.HOST||'127.0.0.1';
  const serverPort=port(env.PORT,4174);
  let origin;
  try {origin=new URL(env.APP_ORIGIN||`http://127.0.0.1:${serverPort}`);} catch {throw new Error('APP_ORIGIN must be an HTTP(S) origin.');}
  if (!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path.');
  if (production&&origin.protocol!=='https:') throw new Error('Production requires an HTTPS APP_ORIGIN.');
  if (origin.protocol==='http:'&&!loopback(origin.hostname)) throw new Error('HTTP is allowed only for loopback development.');
  if (!env.DATABASE_URL||!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL)) throw new Error('DATABASE_URL must be set to the project PostgreSQL connection.');
  if (!env.AUTH_SECRET||env.AUTH_SECRET.length<32||env.AUTH_SECRET==='REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS') throw new Error('AUTH_SECRET must contain at least 32 random characters, not the example placeholder.');
  const mailMode=env.MAIL_MODE||'disabled';
  if (!['disabled','smtp','development'].includes(mailMode)) throw new Error('Invalid MAIL_MODE.');
  if (mailMode==='development'&&(production||!loopback(host)||!loopback(origin.hostname))) throw new Error('development mail requires a loopback-only development server.');
  if (mailMode==='smtp'&&['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'].some(key=>!env[key])) throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM are required for SMTP.');
  if (env.TRUST_PROXY&&!['none','loopback'].includes(env.TRUST_PROXY)) throw new Error('TRUST_PROXY must be none or loopback.');
  const smtpPort=port(env.SMTP_PORT,465);
  return {
    production,host,port:serverPort,origin:origin.origin,
    databaseUrl:env.DATABASE_URL,authSecret:env.AUTH_SECRET,
    secureCookies:origin.protocol==='https:',mailMode,
    trustProxy:env.TRUST_PROXY==='loopback',
    developmentMailDir:path.join(projectRoot,'tmp','dev-mail'),
    smtp:{host:env.SMTP_HOST,port:smtpPort,secure:smtpPort===465,auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD},from:env.SMTP_FROM},
  };
}
