'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {build} = require('../tools/build.cjs');
const {makeScenario} = require('../examples/evening-scenario.cjs');

test('all generated Apps Script files work together and produce reproducible digests', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warren-build-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const results = build(dir);
  assert.deepEqual(results.map(r => path.basename(r.file)), ['WarrenConfig.gs', 'Warren.gs', 'WarrenEvening.gs']);
  assert.deepEqual(build(dir), results);
  const sources = results.map(({file, sha256}) => {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), sha256);
    return content;
  });
  const context = vm.createContext({});
  vm.runInContext(sources.join('\n'), context);
  for (const entry of ['warrenInitialize','warrenAuditMorning','warrenEveningInstall','warrenEveningRunNow']) {
    assert.equal(typeof context[entry], 'function');
  }
  const {first} = makeScenario();
  const report = context.WarrenEveningCore.evaluate(first, null);
  assert.equal(report.summary.securities, context.WarrenCore.symbols.length);
  assert.equal(context.WarrenLearning.evaluate(first, report, null, null).benchmarks.length, 1);
});
