import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

test('HTTP auth boundary enforces origin, cookies, methods and protected route aliases',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'arviva-http-'));
  let enterCalls=0, sessionToken=null;
  const signedOut={authenticated:false,email:null,products:{'module-01':{trialUsed:false,paid:false},'module-02':{trialUsed:false,paid:false}}};
  const auth={
    getSession:async token=>{sessionToken=token;return signedOut;},
    requestCode:async()=>({message:'Sent',retryAfterSeconds:60}),
    verifyCode:async()=>({token:'a'.repeat(64),email:'qa@example.com',products:signedOut.products}),
    logout:async()=>{}, enterProduct:async()=>{enterCalls++;return {url:'/research-platform'};},canViewProduct:async()=>false,
  };
  let server;
  try {
    await mkdir(path.join(root,'research-platform'));
    await writeFile(path.join(root,'research-platform','index.html'),'PRIVATE');
    await writeFile(path.join(root,'index.html'),'PUBLIC');
    const config={origin:'http://127.0.0.1',secureCookies:false,trustProxy:false};
    server=createApp({config,auth,mailer:{ready:true,development:true},root});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    config.origin=base;
    const post=(url,body={},headers={})=>fetch(base+url,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    const state=await fetch(base+'/api/session',{headers:{Cookie:'arviva_session=hello'}});
    assert.equal(state.status,200);assert.equal((await state.json()).developmentMail,true);
    assert.equal(sessionToken,'hello');assert.equal(state.headers.get('cache-control'),'no-store');
    assert.equal((await post('/api/products/module-01/enter',{}, {Origin:'https://evil.example'})).status,403);
    assert.equal(enterCalls,0);
    assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await post('/api/auth/request-code',{email:'qa@example.com'},{'Content-Type':'text/plain'})).status,415);
    assert.equal((await fetch(base+'/api/auth/verify')).status,405);
    const verified=await post('/api/auth/verify',{email:'qa@example.com',code:'123456'});
    assert.equal(verified.status,200);assert.equal((await verified.json()).authenticated,true);
    const cookie=verified.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.doesNotMatch(cookie,/Domain=/);
    assert.equal((await post('/api/auth/request-code',{email:'x'.repeat(5000)})).status,413);
    for(const route of ['/research-platform','/research-platform/','/research-platform/index.html','/research%2dplatform/index.html','//research-platform//index.html','/prediction-platform']) {
      const response=await fetch(base+route,{redirect:'manual'});
      assert.equal(response.status,302,route);assert.equal(response.headers.get('location'),'/intelligent');
    }
    assert.equal(await (await fetch(base+'/runtime-config.js')).text(),"export const mode = 'live';\n");
    assert.equal(await (await fetch(base+'/')).text(),'PUBLIC');
    const out=await post('/api/auth/logout');assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
  } finally {if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true});}
});

test('filesystem aliases cannot bypass product authorization or private cache headers',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'arviva-product-alias-'));
  let allowed=false, databaseAvailable=true;
  const checkedProducts=[];
  const auth={canViewProduct:async(token,id)=>{
    checkedProducts.push(id);
    if(!databaseAvailable)throw new Error('Database unavailable');
    return allowed&&token==='valid-session';
  }};
  let server;
  try {
    const productDirectory=path.join(root,'research-platform');
    await mkdir(productDirectory);
    await writeFile(path.join(productDirectory,'index.html'),'PRIVATE');
    await writeFile(path.join(root,'index.html'),'PUBLIC');
    await symlink(productDirectory,path.join(root,'alternate-product'),'junction');
    const aliases=['/alternate-product','/alternate-product/index.html'];
    if(process.platform==='win32'){
      const shortFile=await realpath(path.join(root,'RESEAR~1','index.html')).catch(()=>null);
      if(shortFile===await realpath(path.join(productDirectory,'index.html')))aliases.push('/RESEAR~1/index.html');
      else t.diagnostic('NTFS short names are disabled on this filesystem; junction aliases remain covered.');
    }
    server=createApp({config:{origin:'http://127.0.0.1',secureCookies:false,trustProxy:false},auth,mailer:{ready:false,development:false},root});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    for(const route of aliases){
      const response=await fetch(base+route,{redirect:'manual'});
      assert.equal(response.status,302,route);
      assert.equal(response.headers.get('location'),'/intelligent');
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(checkedProducts.at(-1),'module-01');
    }
    allowed=true;
    for(const route of ['/research-platform',...aliases]){
      const response=await fetch(base+route,{headers:{Cookie:'arviva_session=valid-session'}});
      assert.equal(response.status,200,route);
      assert.equal(await response.text(),'PRIVATE');
      assert.equal(response.headers.get('cache-control'),'no-store');
    }
    const head=await fetch(base+'/alternate-product',{method:'HEAD',headers:{Cookie:'arviva_session=valid-session'}});
    assert.equal(head.status,200);assert.equal(head.headers.get('cache-control'),'no-store');
    databaseAvailable=false;
    assert.equal((await fetch(base+'/alternate-product',{redirect:'manual'})).status,503);
    assert.equal(await (await fetch(base+'/')).text(),'PUBLIC');
  } finally {if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true});}
});
