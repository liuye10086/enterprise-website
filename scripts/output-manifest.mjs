import {mkdir,realpath,lstat,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
const manifestName = '.build-manifest.json';

function validate(relative) {
  if(typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[\\:\x00-\x1f]/.test(relative) || relative.split('/').some(part=>!part || part==='.' || part==='..') || relative===manifestName) {
    throw new Error(`Unsafe output path: ${relative}`);
  }
  return relative;
}
function inside(root,target) {
  const relative=path.relative(root,target);
  if(relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Output path outside dist boundary: ${target}`);
}
async function statIfPresent(target) {
  try {return await lstat(target);} catch(error) {if(error.code==='ENOENT') return null;throw error;}
}
export async function outputPath(dist,relative) {
  validate(relative);
  const root=await realpath(dist);
  let parent=root;
  for(const part of relative.split('/').slice(0,-1)) {
    parent=path.join(parent,part);
    if(!await statIfPresent(parent)) await mkdir(parent);
    inside(root,await realpath(parent));
  }
  const target=path.join(root,relative);
  const stat=await statIfPresent(target);
  if(stat?.isSymbolicLink() || stat?.isDirectory()) throw new Error(`Unsafe output file path: ${relative}`);
  return target;
}
export async function completeOutputBuild(dist,files) {
  const root=await realpath(dist);
  const current=[...new Set(files.map(validate))].sort();
  const manifest=path.join(root,manifestName);
  const stat=await statIfPresent(manifest);
  if(stat?.isSymbolicLink() || stat?.isDirectory()) throw new Error('Unsafe manifest path');
  const previous=stat ? JSON.parse(await readFile(manifest,'utf8')) : [];
  if(!Array.isArray(previous)) throw new Error('Unsafe manifest path list');
  previous.forEach(validate);
  const owned=new Set(current);
  const stale=[];
  for(const relative of previous.filter(file=>!owned.has(file))) {
    const target=path.join(root,relative);
    try {inside(root,await realpath(path.dirname(target)));} catch(error) {if(error.code==='ENOENT') continue;throw error;}
    const targetStat=await statIfPresent(target);
    if(targetStat?.isDirectory()) throw new Error(`Unsafe output path is directory: ${relative}`);
    if(targetStat) stale.push(target);
  }
  for(const target of stale) await unlink(target);
  await writeFile(manifest,JSON.stringify(current,null,2)+'\n','utf8');
}
