import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const api = await import('../scripts/output-manifest.mjs').catch(()=>({}));
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(),'output-manifest-'));
  try {const dist=path.join(root,'dist');await mkdir(dist);await run(dist,root);} finally {await rm(root,{recursive:true,force:true});}
}
test('expired owned outputs are removed while unregistered files survive',async()=>fixture(async dist=>{
  assert.equal(typeof api.completeOutputBuild,'function');
  await writeFile(path.join(dist,'old.html'),'old');
  await writeFile(path.join(dist,'manual.txt'),'manual');
  await writeFile(path.join(dist,'new.html'),'new');
  await writeFile(path.join(dist,'.build-manifest.json'),JSON.stringify(['old.html']));
  await api.completeOutputBuild(dist,['new.html']);
  await assert.rejects(access(path.join(dist,'old.html')));
  assert.equal(await readFile(path.join(dist,'manual.txt'),'utf8'),'manual');
  assert.deepEqual(JSON.parse(await readFile(path.join(dist,'.build-manifest.json'),'utf8')),['new.html']);
}));
test('malicious manifest paths cannot remove outside files',async()=>fixture(async(dist,root)=>{
  await writeFile(path.join(root,'secret.txt'),'keep');
  for(const unsafe of ['../secret.txt','/secret.txt','C:\\secret.txt','x/../secret.txt','x\\secret.txt']) {
    await writeFile(path.join(dist,'.build-manifest.json'),JSON.stringify([unsafe]));
    await assert.rejects(api.completeOutputBuild(dist,[]),/unsafe|path/i);
    assert.equal(await readFile(path.join(root,'secret.txt'),'utf8'),'keep');
  }
}));
test('junction parents cannot delete or write outside dist',async()=>fixture(async(dist,root)=>{
  const outside=path.join(root,'outside');await mkdir(outside);await writeFile(path.join(outside,'secret.txt'),'keep');
  await symlink(outside,path.join(dist,'linked'),'junction');
  await writeFile(path.join(dist,'.build-manifest.json'),JSON.stringify(['linked/secret.txt']));
  await assert.rejects(api.completeOutputBuild(dist,[]),/outside|boundary/i);
  await assert.rejects(api.outputPath(dist,'linked/new.txt'),/outside|boundary/i);
  assert.equal(await readFile(path.join(outside,'secret.txt'),'utf8'),'keep');
}));
