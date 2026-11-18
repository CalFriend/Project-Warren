'use strict';

// All figures and disclosures in this two-period example are invented.
// The audit requires the production symbol list, but no issuer facts are used.
const {symbols} = require('../tools/evening-asset-audit.cjs');

const demoCompany = 'HK.06823';
const definition = {
  asset: '示例网络业务', metric: '经营现金净额', kind: 'cash_flow', unit: '百万港元',
  basis: '示例普通股股东全年经营现金，已扣利息、税款、租赁及营运资本变化',
};

function disclosureUrl(symbol, year) {
  return `https://example.org/warren/${symbol}/${year}`;
}

function evening(date, year, actual) {
  const checkedAt = date + 'T21:40:00+08:00';
  const securities = symbols.map(symbol => {
    const source = disclosureUrl(symbol, year);
    const observed = symbol === demoCompany;
    return {
      symbol, name: observed ? '示例网络公司' : '示例观察对象 ' + symbol,
      method: '对照合成披露检查同一期间、单位和资产口径',
      checks: observed ? [{
        ...definition, source, period: year + '-FY', periodEnd: year + '-12-31',
        actual, checkedAt, publishedAt: year === 2023 ? '2024-03-15' : date,
        note: '数值来自离线演示材料',
      }] : [],
      sourceChecks: [{
        source, checkedAt, outcome: observed && year === 2024 ? 'updated' : 'no_change',
        detail: observed ? '已读入当期合成报表' : '本次示例没有新增披露',
      }],
      gaps: observed ? [] : ['演示未提供本期运营数据'],
      next: '等下一份可比较的披露',
    };
  });
  return {date, asOf: date + 'T21:45:00+08:00', securities};
}

function makeScenario() {
  const first = evening('2024-12-10', 2023, 100);
  const company = first.securities.find(card => card.symbol === demoCompany);
  company.forecasts = [{
    ...definition, targetPeriod: '2024-FY', periodEnd: '2024-12-31',
    value: 110, tolerance: 5, asOf: first.asOf,
    source: 'https://example.org/warren/frozen-forecast',
    reason: '假设次年经营现金增长10%，在实绩披露前登记',
  }];

  const second = evening('2025-03-20', 2024, 120);
  const cashCheck = second.securities.find(card => card.symbol === demoCompany).checks[0];
  const learning = {
    date: second.date, asOf: second.asOf,
    securities: [{
      symbol: demoCompany,
      cash: {
        mode: 'operating', period: cashCheck.period, annual: true, currency: 'HKD',
        scale: 'million', scope: 'parent', source: cashCheck.source, checkedAt: cashCheck.checkedAt,
        amount: cashCheck.actual, shares: 50, maintenanceCapex: 30,
        included: ['interest', 'tax', 'minorities', 'leases', 'workingCapital'], deductions: [],
      },
      dcf: {
        mode: 'perpetual', priceDate: second.date, price: 20, currency: 'HKD',
        priceSource: 'https://example.org/warren/illustrative-price',
        rate: 0.09, years: 5, terminalGrowth: 0.01, growth: [-0.02, 0.02, 0.04],
      },
    }],
  };
  return {first, second, learning};
}

module.exports = {demoCompany, makeScenario};
