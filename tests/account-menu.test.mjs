import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPages } from '../src/render.mjs';

const module = await import('../src/account-menu.js').catch(error => {
  if(error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});

function fixture() {
  const all = [];
  const make = (name, parent = null) => {
    const listeners = new Map();
    const item = { name, parent, hidden:false, disabled:false, isConnected:true, textContent:'', attrs:{},
      setAttribute(key,value){this.attrs[key]=value;}, getAttribute(key){return this.attrs[key]??null;}, removeAttribute(key){delete this.attrs[key];},
      contains(other){for(let p=other;p;p=p.parent)if(p===this)return true;return false;},
      focus(){root.activeElement=this;}, addEventListener(type,handler){listeners.set(type,handler);},
      dispatch(type,event={}){return listeners.get(type)?.({preventDefault(){},...event});},
      querySelector(selector){return all.find(x=>this.contains(x)&&x.name===selector)||null;},
      querySelectorAll(selector){return all.filter(x=>this.contains(x)&&(x.name===selector||(selector==='[role="menuitem"]'&&x.attrs.role==='menuitem')));},
    };all.push(item);return item;
  };
  const root=make('document');
  const wrapper=make('[data-account-menu-root]',root);
  const trigger=make('[data-account-trigger]',wrapper);
  const menu=make('[data-account-menu]',wrapper);menu.hidden=true;menu.attrs.id='account-menu';
  const profile=make('[data-account-profile]',menu);profile.attrs.role='menuitem';
  const logout=make('[data-account-logout]',menu);logout.attrs.role='menuitem';
  const status=make('[data-account-status]',menu);status.hidden=true;
  const outside=make('outside',root);
  assert.equal(typeof module.initializeAccountMenu,'function');
  const controller=module.initializeAccountMenu(root);
  return {root,wrapper,trigger,menu,profile,logout,status,outside,controller};
}

test('the header contains a hidden, labelled two-action menu connected to the avatar', async () => {
  const pages=await renderPages({articles:[]}); const html=pages.get('/home');
  assert.match(html,/data-account-menu-root/);
  assert.match(html,/<button[^>]*data-account-trigger[^>]*aria-haspopup="dialog"/);
  assert.match(html,/<div[^>]*id="account-menu"[^>]*role="menu"[^>]*aria-label="Account menu"[^>]*data-account-menu[^>]*hidden/);
  assert.match(html,/<a[^>]*href="\/profile"[^>]*role="menuitem"[^>]*data-account-profile[^>]*>Personal profile<\/a>/);
  assert.match(html,/<button[^>]*role="menuitem"[^>]*data-account-logout[^>]*>Log out<\/button>/);
});

test('authentication switches avatar semantics and signing out closes an open menu', () => {
  const ui=fixture();ui.controller.setAuthenticated(false);ui.controller.toggle();
  assert.equal(ui.menu.hidden,true);assert.equal(ui.trigger.attrs['aria-controls'],'login-dialog');
  ui.controller.setAuthenticated(true);ui.controller.toggle();
  assert.equal(ui.menu.hidden,false);assert.equal(ui.root.activeElement,ui.profile);
  assert.equal(ui.trigger.attrs['aria-expanded'],'true');assert.equal(ui.trigger.attrs['aria-haspopup'],'menu');
  assert.equal(ui.controller.owns(ui.trigger),true);assert.equal(ui.controller.owns(ui.outside),false);
  ui.controller.setAuthenticated(false);assert.equal(ui.menu.hidden,true);
  assert.equal(ui.trigger.attrs['aria-haspopup'],'dialog');
});

test('outside click and moving focus out close the menu while Escape restores avatar focus', () => {
  const ui=fixture();ui.controller.setAuthenticated(true);ui.controller.toggle();
  ui.root.dispatch('click',{target:ui.profile});assert.equal(ui.menu.hidden,false);
  ui.root.dispatch('click',{target:ui.outside});assert.equal(ui.menu.hidden,true);
  ui.controller.toggle();ui.root.dispatch('focusin',{target:ui.outside});assert.equal(ui.menu.hidden,true);
  ui.controller.toggle();ui.menu.dispatch('keydown',{key:'Escape'});
  assert.equal(ui.menu.hidden,true);assert.equal(ui.root.activeElement,ui.trigger);
});

test('arrow keys navigate both actions, skip a busy logout, and preserve native profile navigation', () => {
  const ui=fixture();ui.controller.setAuthenticated(true);
  ui.trigger.dispatch('keydown',{key:'ArrowUp'});assert.equal(ui.root.activeElement,ui.logout);
  ui.menu.dispatch('keydown',{key:'ArrowDown'});assert.equal(ui.root.activeElement,ui.profile);
  ui.menu.dispatch('keydown',{key:'End'});assert.equal(ui.root.activeElement,ui.logout);
  ui.controller.setBusy(true);assert.equal(ui.logout.disabled,true);
  ui.menu.dispatch('keydown',{key:'Home'});assert.equal(ui.root.activeElement,ui.profile);
  ui.menu.dispatch('keydown',{key:'ArrowDown'});assert.equal(ui.root.activeElement,ui.profile);
  let prevented=false;ui.profile.dispatch('click',{preventDefault(){prevented=true;}});
  assert.equal(prevented,false);assert.equal(ui.menu.hidden,true);
});

test('logout errors remain visible and the busy state ends without hiding the message', () => {
  const ui=fixture();ui.controller.setAuthenticated(true);ui.controller.toggle();ui.controller.setBusy(true);
  ui.controller.setError('Unable to reach the server. Please try again.');ui.controller.setBusy(false);
  assert.equal(ui.status.hidden,false);assert.match(ui.status.textContent,/Unable to reach/);assert.equal(ui.logout.disabled,false);
});

test('focusing the avatar before a second click does not reopen the dropdown', () => {
  const ui=fixture();ui.controller.setAuthenticated(true);ui.controller.toggle();
  ui.trigger.focus();ui.root.dispatch('focusin',{target:ui.trigger});
  ui.controller.toggle();
  assert.equal(ui.menu.hidden,true);
});

test('Escape on the avatar closes the menu after Shift+Tab returns focus to it', () => {
  const ui=fixture();ui.controller.setAuthenticated(true);ui.controller.toggle();
  ui.menu.dispatch('keydown',{key:'Tab',shiftKey:true});
  ui.trigger.focus();ui.root.dispatch('focusin',{target:ui.trigger});
  let prevented=false;
  ui.trigger.dispatch('keydown',{key:'Escape',preventDefault(){prevented=true;}});
  assert.equal(ui.menu.hidden,true);
  assert.equal(ui.trigger.attrs['aria-expanded'],'false');
  assert.equal(ui.root.activeElement,ui.trigger);
  assert.equal(prevented,true);
});
