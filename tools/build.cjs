'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundles = {
  'WarrenConfig.gs': ['WarrenUniverse', 'WarrenConfig'],
  'Warren.gs': ['WarrenCore', 'WarrenNews', 'WarrenApp'],
  'WarrenEvening.gs': ['WarrenEveningCore', 'WarrenLearning', 'WarrenEveningApp'],
};

function build(destination = path.join(root, 'output')) {
  fs.mkdirSync(destination, {recursive:true});
  if (fs.realpathSync(destination) === fs.realpathSync(path.join(root, 'cloud'))) {
    throw Error('Choose a build directory outside the source directory');
  }
  return Object.entries(bundles).map(([filename, modules]) => {
    const content = modules.map(name => {
      const source = path.join(root, 'cloud', name + '.gs');
      return fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
    }).join('\n\n');
    const file = path.join(destination, filename);
    fs.writeFileSync(file, content);
    return {file, characters:content.length, sha256:crypto.createHash('sha256').update(content).digest('hex')};
  });
}

module.exports = {build};
if (require.main === module) {
  for (const result of build(process.argv[2])) console.log(JSON.stringify(result));
}
