'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Apps Script files share globals. Use a fresh context for each test or offline run.
function loadCloud(names, globals = {}) {
  const context = vm.createContext(globals);
  for (const name of new Set(['WarrenUniverse', ...names])) {
    if (!/^Warren[A-Za-z]+$/.test(name)) throw Error('Invalid cloud module name');
    const file = path.join(__dirname, '..', 'cloud', name + '.gs');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return context;
}

module.exports = { loadCloud };
