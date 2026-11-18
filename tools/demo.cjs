'use strict';

const {loadCloud} = require('./load-cloud.cjs');
const {evaluate} = require('./evening-asset-audit.cjs');
const {demoCompany, makeScenario} = require('../examples/evening-scenario.cjs');

function runDemo() {
  const {WarrenLearning} = loadCloud(['WarrenLearning']);
  const {first, second, learning} = makeScenario();
  const frozen = evaluate(first);
  frozen.learning = WarrenLearning.evaluate(first, frozen, null, null);
  const realised = evaluate(second, frozen);
  realised.learning = WarrenLearning.evaluate(second, realised, frozen, learning);
  return {frozen, realised};
}

function display({frozen, realised}) {
  const model = realised.learning.securities.find(card => card.symbol === demoCompany);
  const assumptions = model.reverseDcf.inputs;
  const sample = realised.learning.samples[0];
  const control = frozen.learning.benchmarks[0];
  return [
    'Project Warren 离线演示（全部为合成数据）',
    '',
    `${frozen.date} 读入 ${frozen.summary.securities} 个观察对象，其中一家公司提供了可比数据。上年经营现金为 ${control.baseline} 百万港元，本年预测 ${control.predicted} 百万港元，同时登记持平对照。`,
    `${realised.date} 披露的示例实绩为 ${sample.actual} 百万港元。原预测绝对误差 ${sample.absOriginal}，持平预测绝对误差 ${sample.absNaive}（百万港元）。`,
    `经营现金 ${model.ownerCash.start} 减去维持性投资 ${model.ownerCash.capexUsed}，可归普通股股东的现金为 ${model.ownerCash.value} 百万港元，每股 ${model.ownerCash.perUnit.toFixed(2)} 港元。`,
    `按示例价 ${assumptions.price} 港元、要求回报 ${assumptions.rate * 100}%、长期增长 ${assumptions.terminalGrowth * 100}%，隐含前 ${assumptions.years} 年的现金年变化率为 ${(model.reverseDcf.impliedAnnualGrowth * 100).toFixed(2)}%。`,
    `已对照 ${realised.learning.summary.independentlyScored} 个独立报告期，产生 ${realised.learning.summary.candidates} 项候选修正。`,
  ].join('\n');
}

if (require.main === module) console.log(display(runDemo()));
module.exports = {runDemo, display};
