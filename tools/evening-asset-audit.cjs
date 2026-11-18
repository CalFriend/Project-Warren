'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadCloud } = require('./load-cloud.cjs');
const { writeOnce } = require('./write-once.cjs');
const core = loadCloud(['WarrenEveningCore']).WarrenEveningCore;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function run(args) {
  const positional = [];
  let previousFile;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--previous') {
      if (previousFile || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing or duplicate --previous file');
      previousFile = args[++i];
    } else if (args[i].startsWith('--')) throw Error('Unknown option: ' + args[i]);
    else positional.push(args[i]);
  }
  if (positional.length < 1 || positional.length > 2) {
    throw Error('Usage: node tools/evening-asset-audit.cjs <input.json> [output.json] [--previous <last-report.json>]');
  }
  const [inputFile, outputFile] = positional;
  if (outputFile && [inputFile, previousFile].filter(Boolean).some(f => path.resolve(f) === path.resolve(outputFile))) {
    throw Error('Use a distinct path for the new report');
  }
  const report = core.evaluate(readJson(inputFile), previousFile ? readJson(previousFile) : null);
  const content = JSON.stringify(report, null, 2) + '\n';
  if (!outputFile) return process.stdout.write(content);
  writeOnce(outputFile, content, () => {
    throw Error('Existing audit differs. Preserve it and use a new revision path.');
  });
}

module.exports = {evaluate: core.evaluate, symbols: Array.from(core.symbols), run};
if (require.main === module) {
  try { run(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
