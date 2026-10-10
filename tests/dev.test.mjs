import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('rebuild reloads imported dependencies in a fresh Node process', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'website-rebuild-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = path.join(root, 'build.mjs');
  const dependency = path.join(root, 'content.mjs');
  const output = path.join(root, 'output.txt');
  await writeFile(entry, "import {writeFile} from 'node:fs/promises';\nimport {content} from './content.mjs';\nawait writeFile(new URL('./output.txt', import.meta.url), content);\n");
  await writeFile(dependency, "export const content = 'before';\n");
  const {runBuild} = await import('../scripts/run-build.mjs');
  await runBuild({entry, cwd: root});
  assert.equal(await readFile(output, 'utf8'), 'before');
  await writeFile(dependency, "export const content = 'after';\n");
  await runBuild({entry, cwd: root});
  assert.equal(await readFile(output, 'utf8'), 'after');
});

test('failed child build rejects so dev can report a build failure', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'website-build-failure-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const entry = path.join(root, 'build.mjs');
  await writeFile(entry, 'process.exit(7);');
  const {runBuild} = await import('../scripts/run-build.mjs');
  await assert.rejects(runBuild({entry, cwd: root}), /7/);
});
