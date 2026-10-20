import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState } from '../src/access-state.js';
import { renderResearchAccessPage, renderResearchWorkspacePage } from '../src/research-access-view.mjs';

const client = await import('../src/research-access.js').catch(() => ({}));
const stateKey = 'arviva-access-preview-v1';
const storage = () => { const values = new Map(); return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}; };
const testClock=1_800_000_000_000;
const response = (access='trial-available', expires=null, now=testClock) => ({authenticated:access!=='signed-out',access,trialExpiresAt:expires,serverNow:new Date(now).toISOString()});
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('research access provides a local preview store and strict response reader', () => {
  assert.equal(typeof client.createPreviewResearchAccess,'function');
  assert.equal(typeof client.readResearchAccessResponse,'function');
});

test('checking the preview never consumes a trial; starting and reentering preserves its deadline', () => {
  const backing=storage(); const state=createDemoState(); state.signedIn=true;
  backing.setItem(stateKey,JSON.stringify(state)); let now=1_800_000_000_000;
  const preview=client.createPreviewResearchAccess(backing,{now:()=>now});
  assert.deepEqual(preview.read(),response()); assert.deepEqual(preview.read(),response());
  const started=preview.start(); assert.equal(started.access,'trial');
  assert.equal(Date.parse(started.trialExpiresAt),now+15*60*1000);
  now+=120_000;
  assert.deepEqual(preview.start(),{...started,serverNow:new Date(now).toISOString()});
  assert.deepEqual(client.createPreviewResearchAccess(backing,{now:()=>now}).read(),{...started,serverNow:new Date(now).toISOString()});
  now+=15*60*1000;
  assert.deepEqual(preview.read(),response('trial-used',null,now));
  assert.throws(()=>preview.start(),/already been used/);
});

test('signed-out previews cannot start trials and paid access does not consume a trial', () => {
  const backing=storage(); const state=createDemoState(); backing.setItem(stateKey,JSON.stringify(state));
  const preview=client.createPreviewResearchAccess(backing,{now:()=>testClock});
  assert.deepEqual(preview.read(),response('signed-out')); assert.throws(()=>preview.start(),/Sign in/);
  state.signedIn=true;state.products['module-01'].paid=true;backing.setItem(stateKey,JSON.stringify(state));
  assert.deepEqual(preview.start(),response('paid'));
  assert.equal(JSON.parse(backing.getItem(stateKey)).products['module-01'].trialUsed,false);
});

test('invalid or expired server responses never grant access', () => {
  const now=1_800_000_000_000;
  for (const raw of [{...response('paid'),authenticated:false},{...response('trial'),trialExpiresAt:'invalid'},response('unknown'),{...response(),authenticated:'true'}, {...response('paid'),serverNow:undefined}, {...response('trial'),serverNow:'invalid'}]) {
    assert.throws(()=>client.readResearchAccessResponse(raw),/invalid access/i);
  }
  assert.deepEqual(client.readResearchAccessResponse(response('trial',new Date(now-1).toISOString())),response('trial-used'));
});

function fixture({mode='live',workspace=false,request=async()=>response(),...options}={}) {
  const nodes=new Map(); const events=new Map(); const redirects=[]; const intervals=new Map(); let timer=0;let elapsed=0;
  const node=key=>{const listeners=new Map();const item={hidden:true,disabled:false,textContent:'',setAttribute(){},addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>listeners.delete(name),dispatch:(name,event={})=>listeners.get(name)?.({preventDefault(){},...event}),querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selector=>nodes.has(selector)?[nodes.get(selector)]:[]};nodes.set(key,item);return item;};
  node(workspace?'[data-research-workspace]':'[data-research-access]');
  for(const key of ['loading','error','guest','options','preview','trial','trial-label','trial-description','trial-button','retry','content','access-label','timer','remaining']) node(`[data-research-${key}]`);
  const root={hidden:false,querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selector=>nodes.has(selector)?[nodes.get(selector)]:[],addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name)};
  const browser={location:{hostname:'127.0.0.1',replace:path=>redirects.push(path)},performance:{now:()=>elapsed},sessionStorage:storage(),addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name),setInterval:handler=>{intervals.set(++timer,handler);return timer;},clearInterval:id=>intervals.delete(id)};
  const controller=client.initializeResearchAccess(root,browser,{mode,request,...options});
  return {nodes,browser,root,redirects,events,controller,intervals,elapse:ms=>{elapsed+=ms;for(const handler of [...intervals.values()])handler();}};
}

test('live checks ignore forged paid preview storage and a visit does not POST a trial', async () => {
  const calls=[]; const ui=fixture({request:async(path,options)=>{calls.push([path,options]);return response();}});
  const state=createDemoState();state.signedIn=true;state.products['module-01'].paid=true;ui.browser.sessionStorage.setItem(stateKey,JSON.stringify(state));
  await tick(); assert.deepEqual(calls,[['/api/research/access',undefined]]);assert.deepEqual(ui.redirects,[]);
  assert.equal(ui.nodes.get('[data-research-options]').hidden,false);
});

test('starting a live trial waits for the API before opening the fixed workspace route', async () => {
  const calls=[]; const ui=fixture({request:async(path,options)=>{calls.push([path,options]);return path.endsWith('/trial')?{...response('trial',new Date(testClock+900_000).toISOString()),url:'https://unsafe.example/'}:response();}});
  await tick();await ui.nodes.get('[data-research-trial-button]').dispatch('click');
  assert.deepEqual(calls[1],['/api/research/trial',{method:'POST'}]);assert.deepEqual(ui.redirects,['/research-workspace']);
});

test('network failure keeps protected content hidden and offers retry without a redirect', async () => {
  const ui=fixture({workspace:true,request:async()=>{throw new Error('offline');}});await tick();
  assert.equal(ui.nodes.get('[data-research-content]').hidden,true);assert.equal(ui.nodes.get('[data-research-error]').hidden,false);assert.deepEqual(ui.redirects,[]);
});

test('existing paid access enters workspace and signed-out access displays login', async () => {
  const paid=fixture({request:async()=>response('paid')});await tick();assert.deepEqual(paid.redirects,['/research-workspace']);
  const guest=fixture({request:async()=>response('signed-out')});await tick();assert.equal(guest.nodes.get('[data-research-guest]').hidden,false);assert.deepEqual(guest.redirects,[]);
  const blocked=fixture({workspace:true,request:async()=>response('trial-used')});await tick();assert.deepEqual(blocked.redirects,['/research-access']);
});

test('embedded access uses the supplied navigator after an authoritative grant', async () => {
  const navigations=[];
  const ui=fixture({request:async()=>response('paid'),navigate:path=>navigations.push(path)});
  await tick();assert.deepEqual(navigations,['/research-workspace']);assert.deepEqual(ui.redirects,[]);
});

test('guest notification runs only after the current server response confirms signed-out access', async () => {
  let finish;let guests=0;
  const ui=fixture({request:()=>new Promise(resolve=>{finish=resolve;}),onGuest:()=>{guests++;}});
  assert.equal(guests,0);finish(response('signed-out'));await tick();
  assert.equal(guests,1);assert.equal(ui.nodes.get('[data-research-guest]').hidden,false);
});

test('a delayed access result after sign-out cannot open the previous account workspace', async () => {
  let resolve;let calls=0;const ui=fixture({request:()=>++calls===1?new Promise(done=>{resolve=done;}):Promise.resolve(response('signed-out'))});
  ui.controller.onSession({authenticated:false});resolve(response('paid'));await tick();
  assert.deepEqual(ui.redirects,[]);assert.equal(ui.nodes.get('[data-research-guest]').hidden,false);
});

test('preview mode outside loopback remains unavailable and never reads browser entitlements', async () => {
  const ui=fixture({mode:'demo'});ui.browser.location.hostname='research.arvivatherap.com';
  await ui.controller.refresh();await tick();assert.deepEqual(ui.redirects,[]);assert.equal(ui.nodes.get('[data-research-error]').hidden,false);
});

test('session loading and repeated account updates do not keep restarting access requests', async () => {
  let calls=0;const ui=fixture({request:async()=>{calls++;return response();}});await tick();
  ui.controller.onSession(null,{loading:true});await tick();assert.equal(calls,1);
  ui.controller.onSession({authenticated:true,email:'first@example.test'});await tick();assert.equal(calls,2);
  ui.controller.onSession({authenticated:true,email:'first@example.test',profileComplete:true});await tick();assert.equal(calls,2);
  ui.controller.onSession({authenticated:true,email:'second@example.test'});await tick();assert.equal(calls,3);
});

test('access markup reuses the current upgrade route and workspace tools remain explicit placeholders', () => {
  const access=renderResearchAccessPage();const workspace=renderResearchWorkspacePage();
  assert.match(access,/class="access-plan-grid"/);assert.match(access,/href="\/plans\?product=module-01"/);
  assert.match(access,/data-login-open/);assert.match(access,/data-research-options hidden/);
  assert.match(workspace,/data-research-content hidden/);assert.match(workspace,/Research tools are not available yet/);
  assert.equal((workspace.match(/class="research-coming-soon"/g)||[]).length,3);
});

test('a rejected trial start reloads authoritative access rather than leaving a stale start button', async () => {
  const calls=[];let used=false;
  const ui=fixture({request:async(path,options)=>{
    calls.push([path,options]);
    if(path.endsWith('/trial')){used=true;throw Object.assign(new Error('TRIAL_USED'),{status:403});}
    return response(used?'trial-used':'trial-available');
  }});
  await tick();await ui.nodes.get('[data-research-trial-button]').dispatch('click');
  assert.deepEqual(calls.map(([path])=>path),['/api/research/access','/api/research/trial','/api/research/access']);
  assert.equal(ui.nodes.get('[data-research-options]').hidden,false);
  assert.equal(ui.nodes.get('[data-research-trial-button]').disabled,true);
  assert.equal(ui.nodes.get('[data-research-trial-button]').textContent,'Trial used');
});

test('a client clock twenty minutes ahead cannot expire a newly issued server trial', t => {
  const serverClock=1_800_000_000_000;
  t.mock.method(Date,'now',()=>serverClock+20*60*1000);
  const raw={...response('trial',new Date(serverClock+900_000).toISOString()),serverNow:new Date(serverClock).toISOString()};
  assert.equal(client.readResearchAccessResponse(raw).access,'trial');
});

test('workspace countdown uses monotonic elapsed time and rechecks the server before leaving', async t => {
  const serverClock=1_800_000_000_000;
  t.mock.method(Date,'now',()=>serverClock+20*60*1000);
  let resolve;let calls=0;
  const ui=fixture({workspace:true,request:()=>++calls===1?Promise.resolve({...response('trial',new Date(serverClock+900_000).toISOString()),serverNow:new Date(serverClock).toISOString()}):new Promise(done=>{resolve=done;})});
  await tick();assert.equal(ui.nodes.get('[data-research-content]').hidden,false);assert.equal(ui.nodes.get('[data-research-remaining]').textContent,'15:00');
  ui.elapse(60_000);assert.equal(ui.nodes.get('[data-research-remaining]').textContent,'14:00');
  ui.elapse(840_000);assert.equal(calls,2);assert.equal(ui.nodes.get('[data-research-content]').hidden,true);assert.deepEqual(ui.redirects,[]);
  resolve({...response('trial-used'),serverNow:new Date(serverClock+900_000).toISOString()});await tick();assert.deepEqual(ui.redirects,['/research-access']);
});
