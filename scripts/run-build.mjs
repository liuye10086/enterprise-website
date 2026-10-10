import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// A fresh process reloads the entire ESM dependency graph on every rebuild.
export function runBuild({entry = fileURLToPath(new URL('./build.mjs', import.meta.url)), cwd = fileURLToPath(new URL('../', import.meta.url)), signal} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {cwd, signal, stdio: 'inherit', windowsHide: true});
    child.once('error', reject);
    child.once('close', (code, terminationSignal) => {
      if (code === 0) resolve();
      else reject(new Error(`Build process exited with ${terminationSignal ?? code}`));
    });
  });
}
