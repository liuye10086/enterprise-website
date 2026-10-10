import {watch} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runBuild} from './run-build.mjs';
import {createStaticServer} from './server.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
await runBuild();
const server = createStaticServer({root: path.join(projectRoot, 'dist')});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4173, '127.0.0.1', resolve); });
console.log('本地预览：http://127.0.0.1:4173/sy');
let building = false, dirty = false, timer, stopping = false;
const buildController = new AbortController();
async function rebuild() {
  if (stopping) return;
  if (building) { dirty = true; return; }
  building = true;
  do {
    dirty = false;
    try { await runBuild({signal: buildController.signal}); if (!stopping) console.log('构建完成，请刷新浏览器。'); }
    catch (error) { if (!stopping) console.error('构建失败：', error); }
  } while (dirty && !stopping);
  building = false;
}
const watcher = watch(path.join(projectRoot, 'src'), {recursive: true}, () => {
  if (building) { dirty = true; return; }
  clearTimeout(timer); timer = setTimeout(rebuild, 100);
});
watcher.on('error', error => console.error('监听失败：', error));
function stop() {
  if (stopping) return;
  stopping = true; clearTimeout(timer); watcher.close(); buildController.abort(); server.close(); server.closeAllConnections();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
