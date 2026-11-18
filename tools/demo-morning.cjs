'use strict';

const {actionResearch, closingBars} = require('../examples/morning-scenario.cjs');
const {loadCloud} = require('./load-cloud.cjs');

function runMorningDemo() {
  const {WarrenCore} = loadCloud(['WarrenCore']);
  const now = Date.parse('2026-11-16T09:30:00+08:00');
  const options = {closingBars:closingBars()};
  const render = date => WarrenCore.renderBrief(actionResearch(date), {}, now, null, '预览', options);
  return {current:render('2026-11-16'), stale:render('2026-11-13')};
}

function displayMorning({current, stale}, full) {
  const sections = [
    ['当日上午已复核研究和前一交易日收盘价', current],
    ['仅有上周五的研究，收盘价仍可核验', stale]
  ];
  const lines = ['Project Warren 港股晨报离线演示（全部为合成数据，仅在本机显示，无邮件投递）'];
  for (const [label, report] of sections) {
    lines.push('', label, report.subject);
    if (full) lines.push(report.text);
    else lines.push(...report.text.split('\n').filter(line => /^(资料截止|研究状态：|市场：)/.test(line)));
  }
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--full')) {
    console.log(displayMorning(runMorningDemo(), args.includes('--full')));
  } else {
    console.error('用法：node tools/demo-morning.cjs [--full]');
    process.exitCode = 1;
  }
}

module.exports = {runMorningDemo};
