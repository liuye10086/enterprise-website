import path from 'node:path';
import {isIP} from 'node:net';
import {createStaticServer} from '../scripts/server.mjs';
import {PRODUCTS, getProductProductionUrl} from '../src/access-state.js';
import {ROUTES} from '../src/routes.mjs';

const COOKIE='arviva_session';
const SESSION_SECONDS=7*24*60*60;
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
function tokenFrom(req) {
  const part=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(COOKIE+'='));
  return part?.slice(COOKIE.length+1)||null;
}
function cookie(config,token,maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies?'; Secure':''}`;
}
function json(res,status,body,headers={}) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
  res.end(JSON.stringify(body));
  return true;
}
async function bodyFrom(req) {
  if (Number(req.headers['content-length'])>4096) {req.resume();throw fail(413,'body_too_large','Request is too large.');}
  const body=await new Promise((resolve,reject)=>{
    let size=0;const chunks=[];let finished=false;
    req.on('data',chunk=>{
      if(finished)return;
      size+=chunk.length;
      if(size>4096){finished=true;reject(fail(413,'body_too_large','Request is too large.'));return;}
      chunks.push(chunk);
    });
    req.once('end',()=>{if(!finished){finished=true;resolve(Buffer.concat(chunks).toString('utf8'));}});
    req.once('error',()=>{if(!finished){finished=true;reject(fail(400,'invalid_body','Unable to read request.'));}});
  });
  try {const parsed=JSON.parse(body);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;} catch {throw fail(400,'invalid_json','Send a valid JSON object.');}
}
function clientIp(req,config) {
  const remote=req.socket.remoteAddress||'';
  const forwarded=req.headers['x-real-ip'];
  if(config.trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof forwarded==='string'&&isIP(forwarded))return forwarded;
  return remote;
}
export function createApp({config,auth,mailer,sms={ready:false,development:false},root}) {
  const sessionView=state=>({...state,phone:state.phone??null,mailReady:mailer.ready,developmentMail:mailer.development,smsReady:sms.ready,developmentSms:sms.development});
  const protectProduct=async(req,res,product)=>{
    res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'method_not_allowed',message:'Method not allowed.'},{Allow:'GET, HEAD'});
    try {
      if(!await auth.canViewProduct(tokenFrom(req),product.id)){res.writeHead(302,{Location:ROUTES.intelligent});res.end();return true;}
    } catch {return json(res,503,{error:'service_unavailable',message:'Product access is temporarily unavailable.'});}
    res.writeHead(302,{Location:getProductProductionUrl(product.id)});res.end();return true;
  };
  const server=createStaticServer({root,beforeFile:async(req,res,{realRoot,realFile})=>{
    const resolved='/'+path.relative(realRoot,realFile).split(path.sep).join('/').toLowerCase();
    const product=PRODUCTS.find(item=>resolved.startsWith(item.url+'/'));
    return product?protectProduct(req,res,product):false;
  },beforeRequest:async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    let pathname;
    try {pathname=decodeURIComponent((req.url||'').split('?')[0]);} catch {return json(res,400,{error:'invalid_path',message:'Invalid URL.'});}
    if(pathname==='/runtime-config.js'&&['GET','HEAD'].includes(req.method)){
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
      res.end(req.method==='HEAD'?undefined:"export const mode = 'live';\n");return true;
    }
    const canonical=path.posix.normalize(pathname).toLowerCase().replace(/\/$/,'').replace(/\/index\.html$/,'');
    const product=PRODUCTS.find(item=>item.url===canonical);
    if(product&&await protectProduct(req,res,product))return true;
    if(!pathname.startsWith('/api/'))return false;
    try {
      if(pathname==='/api/session'){
        if(req.method!=='GET')return json(res,405,{error:'method_not_allowed',message:'Method not allowed.'},{Allow:'GET'});
        return json(res,200,sessionView(await auth.getSession(tokenFrom(req))));
      }
      const enter=/^\/api\/products\/(module-0[12])\/enter$/.exec(pathname);
      if(!enter&&!['/api/auth/request-code','/api/auth/verify','/api/auth/sms/request-code','/api/auth/sms/verify','/api/auth/logout'].includes(pathname))return json(res,404,{error:'not_found',message:'Not found.'});
      if(req.method!=='POST')return json(res,405,{error:'method_not_allowed',message:'Method not allowed.'},{Allow:'POST'});
      if(req.headers.origin!==config.origin||req.headers['sec-fetch-site']==='cross-site')throw fail(403,'invalid_origin','This request must come from this website.');
      if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw fail(415,'invalid_content_type','Use application/json.');
      const body=await bodyFrom(req);
      const token=tokenFrom(req),ip=clientIp(req,config);
      if(pathname==='/api/auth/request-code'){
        if(!mailer.ready)throw fail(503,'mail_unavailable','Email sign-in is not configured yet.');
        const result=await auth.requestCode(body.email,ip);
        return json(res,200,{...result,message:mailer.development?'A test code was saved on this computer. No email was sent.':result.message});
      }
      if(pathname==='/api/auth/sms/request-code'){
        if(!sms.ready)throw fail(503,'sms_unavailable','SMS sign-in is not configured yet.');
        const result=await auth.requestPhoneCode(body.phone,ip);
        return json(res,200,{...result,message:sms.development?'A test code was saved on this computer. No SMS was sent.':result.message});
      }
      if(pathname==='/api/auth/verify'||pathname==='/api/auth/sms/verify'){
        const phoneLogin=pathname==='/api/auth/sms/verify';
        if(phoneLogin&&!sms.ready)throw fail(503,'sms_unavailable','SMS sign-in is not configured yet.');
        const verified=phoneLogin?await auth.verifyPhoneCode(body.phone,body.code,ip):await auth.verifyCode(body.email,body.code,ip);
        // Successful sign-in rotates the browser's previous session as well.
        if(token)await auth.logout(token);
        return json(res,200,sessionView({authenticated:true,email:verified.email,phone:verified.phone??null,products:verified.products}),{'Set-Cookie':cookie(config,verified.token,SESSION_SECONDS)});
      }
      if(pathname==='/api/auth/logout'){
        await auth.logout(token);
        return json(res,200,{ok:true},{'Set-Cookie':cookie(config,'',0)});
      }
      return json(res,200,await auth.enterProduct(token,enter[1]));
    } catch(error) {
      const expected=Number.isInteger(error.status)&&error.status>=400&&error.status<=599;
      return json(res,expected?error.status:503,{error:expected?error.code:'service_unavailable',message:expected?error.message:'The service is temporarily unavailable. Please try again later.'});
    }
  }});
  server.requestTimeout=20000;
  server.headersTimeout=15000;
  return server;
}
