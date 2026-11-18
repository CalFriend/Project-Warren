'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
function run(file, args, cwd = os.tmpdir()) {
  return execFileSync(process.execPath, [path.join(root, file), ...args], {cwd, encoding: 'utf8'});
}

test('all archived market studies run on explicitly synthetic data without local market files', () => {
  for (const name of ['analyze', 'events', 'presidents']) {
    const result = JSON.parse(run('research_hk/' + name + '.cjs', ['--demo']));
    assert.equal(result.synthetic, true);
    assert(result.events.length > 0);
  }
  const fundamentals = JSON.parse(run('tools/fundamental-models.cjs', ['--demo']));
  assert.equal(fundamentals.syntheticPrices, true);
  assert.equal(Object.keys(fundamentals.summary).length, 3);
});

test('historical output is reproducible and a different existing report is preserved', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'warren-research-test-'));
  t.after(() => fs.rmSync(cwd, {recursive:true, force:true}));
  const script = 'tools/yuexiu-model.cjs';
  const args = ['--output', 'scenario.json'];
  const original = run(script, args, cwd);
  assert.equal(run(script, [...args, '--check'], cwd), original);
  assert.equal(run(script, args, cwd), original);
  const file = path.join(cwd, 'scenario.json');
  fs.writeFileSync(file, '{"keep":true}');
  const attempt = spawnSync(process.execPath, [path.join(root, script), ...args], {cwd, encoding:'utf8'});
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /different contents/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"keep":true}');
});
