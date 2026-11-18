'use strict';

// Fixed dates keep the offline examples reproducible. All account data, prose,
// fees and example sources below are invented. No Drive archive is used.
const instruments = [
  ['06823', '香港电讯'], ['00220', '统一企业中国'], ['00288', '万洲国际'],
  ['00014', '希慎兴业'], ['00823', '领展房产基金'], ['01052', '越秀交通基建'],
  ['02638', '港灯电力投资'], ['00941', '中国移动'], ['00883', '中国海洋石油'],
  ['00939', '建设银行'], ['00003', '香港中华煤气'], ['00177', '江苏宁沪高速'],
  ['03877', '中国船舶租赁'], ['00696', '中国民航信息网络'],
  ['03416', '国指备兑ETF'], ['03417', '恒科备兑ETF']
];
const filing = 'https://example.org/filings';
const demoLinks = Object.freeze({researchUrl:'https://example.org/research', planUrl:'https://example.org/plan'});
const prices = {'06823':12.24, '00220':8.405, '00288':6.765};
const payments = {'06823':[.348, .4797], '00220':[.5497], '00288':[.2, .41], '03877':[.1]};
const annualHKD = {'00014':1.08, '00823':2.5398, '01052':.25, '02638':.3203, '00941':5.4203, '00883':1.49, '00003':.35};
const annualCNY = {'00939':.3887, '00177':.49, '00696':.276};

function income(code) {
  const parts = payments[code];
  if (parts) {
    return {currency:'HKD', annual:Number(parts.reduce((sum, part) => sum + part, 0).toFixed(4)), paymentsHKD:[...parts]};
  }
  if (annualHKD[code]) return {currency:'HKD', annual:annualHKD[code]};
  if (annualCNY[code]) return {currency:'CNY', annual:annualCNY[code], fxAssumption:1.12};
  return {note:'普通分派待核'};
}

function account() {
  return {
    stockBudgetHKD:32000, currentHoldingsVerified:true,
    incomeTargetCentral:.045, incomeTargetGrossRange:[.04, .05], incomeStretchRange:[.05, .06],
    holdings:[
      {symbol:'HK.06823', shares:400, costPrice:9},
      {symbol:'HK.00220', shares:800, costPrice:6},
      {symbol:'HK.00288', shares:200, costPrice:5}
    ],
    fees:{monthly:11, dividendMin:8, dividendMax:70, dividendRate:.014},
    performanceWindow:{confirmedOrdinaryDividendsReceived:null}
  };
}

function snapshot(date, format) {
  const asOf = date + 'T08:45:00+08:00';
  return {
    schemaVersion:1, status:'published', version:'fixture-'+date, date, asOf,
    summary:['模拟公告与现金流核验。'],
    briefing:{format, asOf, market:'模拟市场利率保持稳定。', change:'本轮已复核样例公告。', focus:[]},
    sources:[{title:'样例披露索引', url:filing, publicationDate:'2026-11-10', checkedAt:asOf}],
    securities:instruments.map(([code, name]) => {
      const card = {
        symbol:'HK.'+code, name, price:prices[code] || 9,
        thesis:name+'的完整测试底稿仅供检验简报是否排除全文。',
        valuation:null, upsideValuation:null,
        brief:{asOf, decision:'首次', recent:name+'经营数据已复核', watch:'留意下一次经营更新'}
      };
      if (format !== 'compact-v1') {
        card.decision = {
          asOf, driver:'核对主营现金流', action:'核对投资开支和回款',
          value:{kind:'pending', explanation:name+'的现金流情景待逐项复核。'},
          income:income(code)
        };
      }
      return card;
    }),
    portfolio:account()
  };
}

function compactResearch() {
  const data = snapshot('2026-11-11', 'compact-v1');
  const card = code => data.securities.find(item => item.symbol === 'HK.'+code);
  const ranges = {
    '06823':[10.34625, .8277/.07, 14.0709], '00220':[6.4512, 8.1536, 10.0352],
    '00288':[4.9, 6.4, 8.1], '00014':[9.5, 12, 14.4], '00823':[26.67, 33.33, 40],
    '02638':[4.27, 4.93, 5.82], '00941':[57.22, 72.27, 92.5], '00003':[3.89, 5, 5.83],
    '03877':[1.68, 2.16, 2.7], '00696':[8.06, 10.58, 13.44]
  };
  for (const [code, [low, base, high]] of Object.entries(ranges)) {
    card(code).preliminaryRange = {low, base, high};
  }
  card('06823').brief.watch = '全年现金能否继续覆盖派息';
  card('00220').brief.recent = '上半年利润+9%';
  card('01052').model = {incomeReference:{value:.25/.07}};
  card('03416').model = {kind:'nav', nav:7.85, navDate:'2026-11-09'};
  card('03417').model = {kind:'nav', nav:6.14, navDate:'2026-11-09'};
  return data;
}

function fundamentalRule(card, date, direction, thresholds, fairValue) {
  return {
    kind:'fundamental_review', status:'published', enabled:true, direction,
    version:'fixture-'+card.symbol+'-'+direction, asOf:date, validUntil:'2026-11-21',
    first:thresholds[0], second:thresholds[1], fairValue:{...fairValue},
    ordinaryDividend:card.decision.income.annual, sources:[filing],
    rationale:'使用样例经营现金流检验提醒流程。', invalidation:'现金流偏离样例情景。',
    action:direction === 'up' ? '停止加仓并复核预期回报' : '检查经营假设再决定'
  };
}

function decisionResearch() {
  const data = snapshot('2026-11-13', 'decision-v2');
  const card = data.securities[0];
  card.decision.value.kind = 'ddm_check';
  // Even with otherwise valid fields a dividend-only rule cannot send an alert.
  card.valuation = {...fundamentalRule(card, data.date, 'down', [11.8, 10.2], {low:12, high:14}),
    kind:'income_watch', currency:'HKD', dividendPeriod:'FY2025', basis:'ordinary'};
  return data;
}

function frameworkResearch() {
  return snapshot('2026-11-13', 'decision-v3');
}

function actionResearch(date = '2026-11-14') {
  const data = snapshot(date, 'decision-v3');
  const bands = [
    {down:[10.1, 9.2], up:[13.55, 14.7], value:{low:10.1, base:11.44, high:14.7}, forward:.8},
    {down:[7.2, 6.7], up:[9.1, 10.3], value:{low:7, base:8.2, high:10}, forward:.5},
    {down:[6.2, 5.4], up:[7.6, 8.4], value:{low:5.8, base:6.9, high:8.3}, forward:.6}
  ];
  bands.forEach(({down, up, value, forward}, i) => {
    const card = data.securities[i];
    card.model = {kind:'fixture_cash_flow', calculation:{base:{value:value.base}, stress:{value:value.low}}};
    card.valuation = fundamentalRule(card, data.date, 'down', down, value);
    card.upsideValuation = fundamentalRule(card, data.date, 'up', up, value);
    card.decision.value.kind = 'operating_cash_flow';
    card.decision.forecastOrdinaryDividend = {kind:'research_scenario_not_declared', currency:'HKD', base:forward,
      basis:'本样例按经营收入、必要维护支出与普通派息的现金覆盖形成模拟基准，并在经营现金回款下降时重新检验，具体付款金额仍待董事会公布。'};
  });
  data.candidatePool = ['DEMO-A', 'DEMO-B', 'DEMO-C'].map(symbol => ({symbol, status:'unvalidated'}));
  data.portfolio.forecastOrdinaryIncome = {kind:'research_scenario_run_rate_not_payment_calendar', low:790, base:840, high:890};
  return data;
}

function closingBars() {
  return Object.fromEntries(instruments.map(([code]) => {
    const symbol = 'HK.'+code, price = prices[code] || 9;
    return [symbol, {symbol, date:'2026-11-13', price, prevClose:price-.1,
      final:true, autype:0, fetchedAt:Date.parse('2026-11-13T17:05:00+08:00')}];
  }));
}

module.exports = {compactResearch, decisionResearch, frameworkResearch, actionResearch, closingBars, demoLinks};
