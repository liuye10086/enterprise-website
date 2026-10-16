import test from 'node:test';
import assert from 'node:assert/strict';
import { readProfileResponse, validateProfileFields, createPreviewProfileStore, initializeProfile } from '../src/profile.js';

const fields = { fullName: 'Research User', contactPhone: '+86 138 0000 1234', organization: 'Example University', researchArea: 'Biomedicine' };
const response = (email = 'person@example.test', complete = true) => ({ profile: { ...fields, email, submittedAt: complete ? '2026-10-16T09:00:00.000Z' : null, ...(complete ? {} : {fullName:'',contactPhone:'',organization:'',researchArea:''}) }, complete });
const storage = () => { const values = new Map(); return {getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,value)}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('profile response must belong to the current verified email and have consistent completion', () => {
  assert.deepEqual(readProfileResponse(response(), 'person@example.test'), response());
  assert.throws(() => readProfileResponse(response('other@example.test'), 'person@example.test'), /invalid profile/i);
  assert.throws(() => readProfileResponse({...response(), complete:'true'}, 'person@example.test'), /invalid profile/i);
  assert.throws(() => readProfileResponse({...response(), profile:{...response().profile, submittedAt:'bad'}}, 'person@example.test'), /invalid profile/i);
  assert.throws(() => readProfileResponse({...response(), profile:{...response().profile,fullName:''}}, 'person@example.test'), /invalid profile/i);
});

test('contact validation allows international formatting without treating it as a login identity', () => {
  assert.deepEqual(validateProfileFields({...fields,fullName:'  Research User  ',email:'ignored@example.test',userId:99}), fields);
  for (const changes of [{fullName:'   '},{contactPhone:'123'},{contactPhone:'abc13800138000'},{organization:'a'.repeat(201)},{researchArea:'a'.repeat(201)}]) {
    assert.throws(()=>validateProfileFields({...fields,...changes}));
  }
});

test('local preview profiles persist separately by email and preserve the first submission date', () => {
  const backing = storage(); const first = createPreviewProfileStore(backing);
  first.setIdentity('first@example.test'); first.save('first@example.test', fields);
  const saved = first.load('first@example.test');
  const fresh = createPreviewProfileStore(backing);
  assert.equal(fresh.identity(), 'first@example.test');
  assert.deepEqual(fresh.load('first@example.test'), saved);
  assert.equal(fresh.load('other@example.test').complete, false);
  const updated = fresh.save('first@example.test', {...fields,fullName:'Updated User'});
  assert.equal(updated.profile.submittedAt, saved.profile.submittedAt);
  assert.equal(updated.profile.fullName, 'Updated User');
});

test('blocked preview storage does not claim a successful durable save', () => {
  const backing = {getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const store = createPreviewProfileStore(backing);
  assert.equal(store.identity(), null);
  assert.equal(store.load('person@example.test').complete, false);
  assert.throws(()=>store.save('person@example.test',fields), /storage/i);
});

test('restored static pages read the current preview account rather than their old cached identity', async () => {
  const ui=fixture({page:true,mode:'preview'});
  ui.controller.onSignIn(session('first@example.test'));await tick();
  const shared=createPreviewProfileStore(ui.browser.sessionStorage);
  shared.setIdentity('second@example.test');
  ui.controller.onSession({authenticated:true});await tick();
  assert.equal(ui.nodes.get('[name="email"]').value,'second@example.test');
});

function fixture({page = false, request = async()=>response(), mode='live'} = {}) {
  const nodes = new Map();
  function node(selector) {
    const listeners = new Map();
    const item={hidden:true,disabled:false,open:false,value:'',textContent:'',isConnected:true,
      addEventListener:(name,handler)=>listeners.set(name,handler),
      dispatch:(name,event={})=>listeners.get(name)?.({preventDefault(){},...event}),
      setAttribute(){}, reportValidity(){return true;}, focus(){root.activeElement=item;},
      showModal(){item.open=true;},close(){item.open=false;},reset(){for(const name of ['fullName','email','contactPhone','organization','researchArea']) nodes.get(`[name="${name}"]`).value='';},
      querySelector:selector=>nodes.get(selector)||null,
      querySelectorAll:selector=>selector==='input'?[...nodes].filter(([key])=>key.startsWith('[name=')).map(([,value])=>value):[],
    }; nodes.set(selector,item); return item;
  }
  const root={activeElement:null,querySelector:s=>nodes.get(s)||null,querySelectorAll:s=>nodes.has(s)?[nodes.get(s)]:[]};
  const browser={location:{hostname:'127.0.0.1',pathname:page?'/profile':'/intelligent'},sessionStorage:storage(),addEventListener(){}};
  const prompt=node('[data-profile-prompt]'); const dismiss=node('[data-profile-dismiss]'); node('[data-profile-go]'); node('[data-profile-link]');
  if(page) {
    node('[data-profile-page]'); node('[data-profile-form]');
    for(const name of ['fullName','email','contactPhone','organization','researchArea']) node(`[name="${name}"]`);
    for(const key of ['guest','loading','load-error','retry','email-only','status','save','date','complete','preview']) node(`[data-profile-${key}]`);
  }
  const controller=initializeProfile({mode,root,browser,request});
  return {controller,nodes,prompt,dismiss,root,browser};
}
const session = (email='person@example.test',profileComplete=false) => ({authenticated:true,email,phone:null,profileComplete});

test('only successful incomplete email sign-in opens a dismissible reminder, never ordinary refresh', async () => {
  const ui=fixture(); ui.controller.onSession(session()); assert.equal(ui.prompt.open,false);
  ui.controller.onSignIn(session()); assert.equal(ui.prompt.open,true);
  ui.dismiss.dispatch('click'); assert.equal(ui.prompt.open,false);
  ui.controller.onSession(session()); assert.equal(ui.prompt.open,false);
  ui.controller.onSignIn(session('person@example.test',true)); assert.equal(ui.prompt.open,false);
  ui.controller.onSignIn({authenticated:true,email:null,phone:'+8613800138000',profileComplete:null}); assert.equal(ui.prompt.open,false);
});

test('profile page saves editable fields with an account guard and session refresh preserves unsaved edits', async () => {
  const calls=[];const ui=fixture({page:true,request:async(path,options)=>{calls.push([path,options]);return response();}});
  ui.controller.onSession(session()); await tick();
  const name=ui.nodes.get('[name="fullName"]'); name.value='Unsaved name';
  ui.controller.onSession(session()); await tick(); assert.equal(name.value,'Unsaved name');
  name.value=fields.fullName;
  await ui.nodes.get('[data-profile-form]').dispatch('submit');
  assert.deepEqual(calls[1],['/api/profile',{method:'POST',body:{...fields,expectedEmail:'person@example.test'}}]);
  assert.equal(ui.nodes.get('[data-profile-status]').textContent,'Your profile has been saved.');
  assert.equal(ui.nodes.get('[data-profile-form]').hidden,false);
  assert.equal(ui.nodes.get('[name="email"]').value,'person@example.test');
});

test('responses arriving after sign-out cannot display the previous account profile', async () => {
  let resolve; const ui=fixture({page:true,request:()=>new Promise(done=>{resolve=done;})});
  ui.controller.onSession(session());
  ui.controller.onSession({authenticated:false,email:null,phone:null});
  resolve(response());await tick();
  assert.equal(ui.nodes.get('[data-profile-form]').hidden,true);
  assert.equal(ui.nodes.get('[name="email"]').value,'');
  assert.equal(ui.nodes.get('[data-profile-guest]').hidden,false);
});

test('a cookie account switch rejects the old form, clears it and requires a fresh session', async () => {
  let cookieAccount='first@example.test'; let writes=0; let reloaded=false;
  const ui=fixture({page:true,request:async(path,options)=>{
    if(options?.method!=='POST')return response(cookieAccount);
    if(options.body.expectedEmail!==cookieAccount)throw Object.assign(new Error('Your sign-in account has changed. Reload this page before saving your profile.'),{status:409});
    writes++;return response(cookieAccount);
  }});
  ui.browser.location.reload=()=>{reloaded=true;};
  ui.controller.onSession(session(cookieAccount));await tick();
  ui.nodes.get('[name="fullName"]').value='First account edit';
  cookieAccount='second@example.test';
  await ui.nodes.get('[data-profile-form]').dispatch('submit');
  assert.equal(writes,0);
  assert.equal(ui.nodes.get('[name="fullName"]').value,'');
  assert.equal(ui.nodes.get('[name="email"]').value,'');
  assert.equal(ui.nodes.get('[data-profile-form]').hidden,true);
  assert.equal(ui.nodes.get('[data-profile-load-error]').hidden,false);
  ui.nodes.get('[data-profile-retry]').dispatch('click');
  assert.equal(reloaded,true);
});

test('initial session loading shows progress rather than a false failure', () => {
  const ui=fixture({page:true});
  ui.controller.onSession(null,{loading:true});
  assert.equal(ui.nodes.get('[data-profile-loading]').hidden,false);
  assert.equal(ui.nodes.get('[data-profile-load-error]').hidden,true);
  ui.controller.onSession(null,{loading:false});
  assert.equal(ui.nodes.get('[data-profile-loading]').hidden,true);
  assert.equal(ui.nodes.get('[data-profile-load-error]').hidden,false);
});

test('failed saves preserve edits and display an actionable error', async () => {
  const ui=fixture({page:true,request:async(path,options)=>{if(options?.method==='POST')throw new Error('Unable to reach the server. Please try again.');return response();}});
  ui.controller.onSession(session());await tick();
  ui.nodes.get('[name="fullName"]').value='Keep my edit';
  await ui.nodes.get('[data-profile-form]').dispatch('submit');
  assert.equal(ui.nodes.get('[name="fullName"]').value,'Keep my edit');
  assert.match(ui.nodes.get('[data-profile-status]').textContent,/Unable to reach/);
  assert.equal(ui.nodes.get('[data-profile-save]').disabled,false);
});
