'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {runDemo} = require('../tools/demo.cjs');

test('the offline scenario scores a forecast frozen on an earlier night', () => {
  const {frozen, realised} = runDemo();
  assert.equal(frozen.summary.securities, 16);
  assert.equal(frozen.learning.summary.frozenControls, 1);
  assert.equal(frozen.learning.summary.independentlyScored, 0);
  assert.equal(realised.summary.misses, 1);
  assert.equal(realised.learning.samples[0].absNaive, 20);
  assert.equal(realised.learning.samples[0].absOriginal, 10);
  assert.equal(realised.learning.summary.reverseDcfs, 1);
  assert.equal(realised.learning.summary.candidates, 0);
});

test('the CLI runs from another working directory and identifies its synthetic inputs', () => {
  const script = path.join(__dirname, '../tools/demo.cjs');
  const output = execFileSync(process.execPath, [script], {cwd: os.tmpdir(), encoding: 'utf8'});
  assert.match(output, /全部为合成数据/);
  assert.match(output, /每股 1\.80 港元/);
});
