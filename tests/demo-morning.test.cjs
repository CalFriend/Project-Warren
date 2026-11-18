'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const {runMorningDemo} = require('../tools/demo-morning.cjs');

test('the current and stale morning samples use the same trading day and independently verified close', () => {
  const {current, stale} = runMorningDemo();
  assert.equal(current.researchFresh, true);
  assert.equal(stale.researchFresh, false);
  assert.ok(stale.errors.includes('RESEARCH_NOT_TODAY'));
  assert.match(current.text, /市场：模拟市场利率保持稳定/);
  assert.doesNotMatch(stale.text, /模拟市场利率保持稳定|基准 11\.44/);
  assert.match(stale.text, /香港电讯 06823 12\.24/);
});

test('the offline morning CLI offers a short preview and a full report from any working directory', () => {
  const script = path.join(__dirname, '../tools/demo-morning.cjs');
  const run = args => execFileSync(process.execPath, [script, ...args], {cwd:os.tmpdir(), encoding:'utf8'});
  const preview = run([]);
  assert.match(preview, /全部为合成数据/);
  assert.match(preview, /研究待补/);
  assert.doesNotMatch(preview, /估值逻辑与价位/);
  assert.match(run(['--full']), /估值逻辑与价位/);
});
