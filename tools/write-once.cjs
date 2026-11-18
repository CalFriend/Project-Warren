'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A hard link publishes a fully written file and never replaces a competing writer.
function writeOnce(file, content, checkExisting) {
  const dir = path.dirname(path.resolve(file));
  const temp = fs.mkdtempSync(path.join(dir, '.warren-report-'));
  const staged = path.join(temp, 'report.json');
  try {
    fs.writeFileSync(staged, content, 'utf8');
    try { fs.linkSync(staged, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = fs.readFileSync(file, 'utf8');
      if (existing !== content) checkExisting(existing);
    }
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
    fs.rmdirSync(temp);
  }
}

module.exports = {writeOnce};
