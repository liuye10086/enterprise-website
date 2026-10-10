import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

test('SMS endpoints enforce origin, readiness and secure session rotation without exposing OTP or token',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'arviva-sms-http-'));
  const products={'module-01':{trialUsed:false,paid:false},'module-02':{trialUsed:false,paid:false}};
  const calls=[];
  const auth={
    getSession:async()=>({authenticated:false,email:null,phone:null,products}),
    requestPhoneCode:async(phone,ip)=>{calls.push(['send',phone,ip]);return {message:'SMS code sent.',retryAfterSeconds:60};},
    verifyPhoneCode:async(phone,code,ip)=>{calls.push(['verify',phone,code,ip]);return {token:'b'.repeat(64),email:null,phone:'+8613800000000',products};},
    logout:async token=>{calls.push(['logout',token]);},
  };
  const config={origin:'http://127.0.0.1',secureCookies:true,trustProxy:false};
  const sms={ready:true,development:true};
  let server;
  try {
    await writeFile(path.join(root,'index.html'),'PUBLIC');
    server=createApp({config,auth,mailer:{ready:true,development:false},sms,root});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    config.origin=base;
    const post=(url,body={},headers={})=>fetch(base+url,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    const session=await (await fetch(base+'/api/session')).json();
    assert.equal(session.smsReady,true);assert.equal(session.developmentSms,true);
    assert.equal(session.phone,null);assert.equal(session.mailReady,true);
    for(const endpoint of ['/api/auth/sms/request-code','/api/auth/sms/verify']){
      assert.equal((await fetch(base+endpoint)).status,405);
      assert.equal((await post(endpoint,{phone:'13800000000'},{Origin:'https://evil.example'})).status,403);
      assert.equal((await post(endpoint,{}, {'Sec-Fetch-Site':'cross-site'})).status,403);
      assert.equal((await post(endpoint,{}, {'Content-Type':'text/plain'})).status,415);
    }
    assert.deepEqual(calls,[]);
    const sent=await post('/api/auth/sms/request-code',{phone:'13800000000'});
    assert.equal(sent.status,200);
    const sendBody=await sent.json();
    assert.equal(sendBody.retryAfterSeconds,60);assert.match(sendBody.message,/No SMS was sent/);
    assert.equal('code' in sendBody,false);assert.deepEqual(calls[0],['send','13800000000','127.0.0.1']);
    const verified=await post('/api/auth/sms/verify',{phone:'13800000000',code:'654321'},{Cookie:'arviva_session=old-token'});
    assert.equal(verified.status,200);
    const user=await verified.json();
    assert.equal(user.authenticated,true);assert.equal(user.phone,'+8613800000000');assert.equal(user.email,null);
    assert.equal(user.smsReady,true);assert.equal('token' in user,false);assert.equal('code' in user,false);
    assert.match(verified.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);
    assert.doesNotMatch(verified.headers.get('set-cookie'),/Domain=/);
    assert.deepEqual(calls.at(-1),['logout','old-token']);
    sms.ready=false;
    const priorCalls=calls.length;
    assert.equal((await post('/api/auth/sms/request-code',{phone:'13800000000'})).status,503);
    assert.equal((await post('/api/auth/sms/verify',{phone:'13800000000',code:'654321'})).status,503);
    assert.equal(calls.length,priorCalls);
    assert.equal((await (await fetch(base+'/api/session')).json()).smsReady,false);
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await rm(root,{recursive:true,force:true});
  }
});
