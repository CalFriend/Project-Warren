// Point-in-time research. Ordinary distributions only; this output must never authorize a trade.
const assert = require('node:assert/strict');
const path = require('node:path');
const {options, readJson, saveJson} = require('../research_hk/research-io.cjs');

const asOf = '2026-11-18';
const marketPrice = 3.235;
const sources = {
  interim: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0819/2026081900378.pdf',
  annual: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0428/2026042802798.pdf',
  operations: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2026/1030/2026103000596.pdf',
  proposedAbs: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2026/1116/2026111601625.pdf',
  constructionPlan2022: 'https://doc.irasia.com/listco/hk/yuexiutransport/circulars/c221221.pdf',
  marketClose: 'https://hk.finance.yahoo.com/quote/1052.HK/history/',
  secondMarketClose: 'https://histock.tw/hkstock/01052',
};

// Profits are after intragroup interest elimination and already belong to the listed company.
// Last column is the change in the road's Jan–Sept toll revenue, not listed-company revenue.
const projects = [
  ['广州北二环', 140209, '2032-01-10', -8.4],
  ['秦滨', 64687, '2045-11-15', -38.6],
  ['随岳南', 60845, '2040-03-09', -20.9],
  ['尉许', 48970, '2035-11-18', 7.2],
  ['大广南', 37927, '2042-07-17', 3.5],
  ['平临', 36506, '2033-10-24', -3.4],
  ['长株', 25845, '2040-08-30', 1.8],
  ['汉蔡', 23620, '2038-08-27', 2.9],
  ['兰尉', 17610, '2034-07-01', 3.7],
  ['苍郁', 14739, '2030-12-28', -2.5],
  ['汉鄂', 9908, '2042-06-30', -43.7],
  ['虎门大桥', 24304, '2029-05-08', -9.2],
  ['清连', 14492, '2034-06-30', 6.1],
  ['汉孝（经越秀高速公路REIT）', 4230, '2036-12-09', 3.8],
  ['汕头海湾大桥', 2417, '2028-12-23', -1.7],
  ['广州西二环', 30760, '2030-12-19', -4.9],
].map(([name, h1AttributableProfitRmb000, end, nineMonthTollYoYPct]) =>
  ({ name, h1AttributableProfitRmb000, end, nineMonthTollYoYPct }));

const historicalDpsHkd = {
  2019: 0.39, 2020: 0.07, 2021: 0.61, 2022: 0.20, 2023: 0.30, 2024: 0.25, 2025: 0.25,
};
const sensitivityRates = [0.07, 0.08, 0.10];
const meanYearDays = 365.2425;

function yearsBetween(start, end) {
  return (Date.parse(end) - Date.parse(start)) / (86400000 * meanYearDays);
}

function presentValueOfAnnualUnit(years, rate) {
  assert(Number.isFinite(years) && Number.isFinite(rate) && rate >= 0);
  if (years <= 0) return 0;
  const fullYears = Math.floor(years);
  const lastFraction = years - fullYears;
  let pv = 0;
  for (let year = 1; year <= fullYears; year++) {
    pv += 1 / (1 + rate) ** year;
  }
  return pv + lastFraction / (1 + rate) ** years;
}

function weightedYearsFactor(rate, overrides = {}) {
  // Qinbin earned only 136 consolidated days from Feb 15 through June 30 inclusive.
  // Normalise exposure to the 181-day period. No FY earnings forecast is inferred.
  let weightSum = 0;
  let weightedFactor = 0;
  for (const project of projects) {
    const weight = project.h1AttributableProfitRmb000 * (project.name === '秦滨' ? 181 / 136 : 1);
    const expiry = overrides[project.name] || project.end;
    const years = yearsBetween(asOf, expiry);
    weightSum += weight;
    weightedFactor += weight * presentValueOfAnnualUnit(years, rate);
  }
  return weightedFactor / weightSum;
}

function ordinaryDistributionScenario(initialDps, rate, overrides) {
  const factor = weightedYearsFactor(rate, overrides);
  const ordinaryDistributionPV = initialDps * factor;
  const incrementalPVNeededAtClose = marketPrice - ordinaryDistributionPV;
  return {
    initialDps, hkDollarEquityReturn: rate, ordinaryDistributionPV, incrementalPVNeededAtClose,
    firstYearDpsNeededIfNoOtherCash: marketPrice / factor,
    equivalentSingleExtraPaymentInTenYears: incrementalPVNeededAtClose * (1 + rate) ** 10,
  };
}

function buildResearch() {
  const scenarios = sensitivityRates.flatMap(rate =>
    [historicalDpsHkd[2022], historicalDpsHkd[2025], historicalDpsHkd[2023]]
      .map(dps => ordinaryDistributionScenario(dps, rate)));
  const baseline = ordinaryDistributionScenario(0.25, 0.08);
  return {
    asOf, ticker: '01052.HK', currency: 'HKD per share unless stated', sources, marketPrice,
    independentMarketCloseMatches: 2, historicalDpsHkd, historicalYieldAtClose: 0.25 / marketPrice,
    status: 'research_only', executableBuyRange: null,
    basis: '以归属上市公司的正路产利润分配集团普通股息的权重，每条路在表列经营期内等额贡献，届满归零。以每年末支付和末年按日计提简化，不计新股东无权领取的2026年中期息，不把半年盈利年化为可分配现金。集团派息已含利息、税与少数股东影响，不再从股息现值扣除净债务。',
    qualifications: [
      '这只计现有普通分红的条件现值。未计资本返还、新收购、超额经营改善或续期，亦未单独计未来资金缺口、港汇变化及港口亏损扩大。既不能当全公司价值，也不能保证股息足额支付。',
      '按2026年中报应占项目利润分配股息只是一种代理，项目现金上缴、各自借贷和派息能力可能不同。剔除琶洲港亏损331.9万元，集团净成本仍已包含在起点每股普通分红内。',
      '本案只为现有权利定期。秦滨两段到期时间分别为2045-11-15及2047-01-20，缺少分段收益，主例采用较早日期并另作敏感性分析。大广南採11月评估明示的疫情补偿后日期。其余项目按中报列示日期，未另计潜在补偿或扩建续期。',
      '表内7%、8%、10%是投资人港元名义年化总回报敏感性，不是公司计算出的资本成本，也不是组合股息目标。0.20、0.25、0.30来自不同年度实际股息，是情景起点，不带概率。',
      '九个月数据仅为路段营业信号，公布于10月30日，不等于上市公司利润同比或未来股息同比。中报已反映同期部分下滑，不能重复下调。单独的汉孝路费也不等于整个REIT净派息。',
      '十年后单笔回款只是将缺口按所选报酬率换算的等价数，不是2036年分配预测。续期示例不含新增工程资本金、贷款本金和利息，仅用于展示期限敏感度，不能用于提价。',
    ],
    projectWeightsSource: '2026 interim results, printed pp. 24–25, 40–43; Sept operating release p.1; Nov ABS appx I/II for Daguangnan.',
    projects,
    fundamentals: {
      periodEnd: '2026-06-30', attributableProfitRmbMillion: 385.794,
      attributableEquityRmbMillion: 12190.223, ordinarySharesMillion: 1673.162,
      externalDebtExcludingInterestPayableRmbMillion: 20772.358, parentCompanyLoanRmbMillion: 100,
      cashAndCashEquivalentsRmbMillion: 1933.611, cfoAfterTaxRmbMillion: 1529.671,
      interestAndFeesPaidRmbMillionApprox: 265, capexExcludingQinbinAcquisitionRmbMillionApprox: 608,
      contractedGnsrCapexRmbMillion: 8970, contractedGroupCapexRmbMillion: 9110,
      weightedAverageInterestRateH1: 0.0238,
    },
    pendingEvents: {
      gnsr: '当前批复2032-01-10。董事会预计改扩建完工后最长25年，待广东省最终批准。2022年通函预计总投资170亿元，其中约70%银行融资，上市公司预计出资30.6亿元。后续以资金实付、最新完工时间、最终年限及新收费标准重算。',
      daguangnan: '11月16日公告的拟议ABS，外部优先本金上限人民币34.49亿元，票息2.2%–2.5%，期限16年并设第8年退出安排。足额发行时有效权益约90%降至31.57%，预期仍并表。发行人预计集团净流入18.20亿元，用于未来项目及一般营运，合并层面不产生处置损益。跟踪监管程序、最终优先分配、本金及再融资、实际可归母现金用途。',
    },
    scenarios, baseline,
    historicalStressAt2020DividendAndReturn8Pct: ordinaryDistributionScenario(historicalDpsHkd[2020], 0.08),
    ordinaryDistributionReviewThresholds: {
      valuationDate: asOf, currency: 'HKD', initialDpsCases: [0.20, 0.25], assumedEquityReturn: 0.08,
      upperReviewThreshold: baseline.ordinaryDistributionPV,
      lowerStressReviewThreshold: ordinaryDistributionScenario(0.20, 0.08).ordinaryDistributionPV,
      purpose: '跨过任一门槛时可提示复核，直接跳过整段也应提示。只衡量普通分红压力情景，不代表企业公允价值、买入价格或跌幅下限。2020年实际股息只有0.07港元。',
      invalidation: '股息、资产出售或收购、项目债务、优先索偿、收费期限、剩余投资或实际利润权重发生重大改变时须重算。未证实关键事实或未核实当日报价时停用价格触发。',
    },
    sensitivitiesAtDps025AndReturn8Pct: {
      laterQinbinSectionExpiryOnly: ordinaryDistributionScenario(0.25, 0.08, { '秦滨': '2047-01-20' }),
      hypotheticalGnsr2053Only: ordinaryDistributionScenario(0.25, 0.08, { '广州北二环': '2053-06-30' }),
      reference: '2053仅按2022年提出的2028年完工假设配合最长25年情景，未获得批准，不含投资和再融资变化。',
    },
    publishActionOnlyAfter: [
      '将剩余现金逐年桥接到普通股东：逐项目收费、运营维养、税、工程出资、还本付息、少数股东与优先ABS分配，加上确认可回收的现金。',
      '以最后已获准收费期限建立基准；续期或并购只进入单独情景。复核持股、汇率、融资、剩余资本支出及普通股数。与股息法核对差额，再由独立数据源确认触发日股价及日期。',
    ],
  };
}

function check(result) {
  assert.equal(presentValueOfAnnualUnit(2, 0), 2);
  assert.equal(presentValueOfAnnualUnit(-1, 0.08), 0);
  assert.equal(presentValueOfAnnualUnit(0.5, 0.08), 0.5 / 1.08 ** 0.5);
  assert.equal(projects.slice(0, 11).reduce((sum, p) => sum + p.h1AttributableProfitRmb000, 0), 480866);
  assert.equal(projects.slice(11).reduce((sum, p) => sum + p.h1AttributableProfitRmb000, -3319), 72884);
  assert(projects.every(p => Number.isFinite(yearsBetween(asOf, p.end)) && yearsBetween(asOf, p.end) > 0));
  const baseline = result.baseline;
  assert(Math.abs(baseline.ordinaryDistributionPV + baseline.incrementalPVNeededAtClose - marketPrice) < 1e-10);
  assert(ordinaryDistributionScenario(0.25, 0.1).ordinaryDistributionPV < baseline.ordinaryDistributionPV);
  assert(result.sensitivitiesAtDps025AndReturn8Pct.laterQinbinSectionExpiryOnly.ordinaryDistributionPV > baseline.ordinaryDistributionPV);
  assert(result.sensitivitiesAtDps025AndReturn8Pct.hypotheticalGnsr2053Only.ordinaryDistributionPV > baseline.ordinaryDistributionPV);
  assert.equal(result.executableBuyRange, null);
}

if (require.main === module) {
  const args = options('node tools/yuexiu-model.cjs [--output NEW.json] [--check]\n' +
    'Reproduce the dated 2026-11-18 dividend scenario from its embedded public inputs. ' +
    '--check compares a previously written report. Historical research only.', ['check']);
  const result = buildResearch();
  check(result);
  const output = args.output || path.join(__dirname, '..', 'research', 'yuexiu-model-20261118.json');
  if (args.check) {
    assert.deepEqual(readJson(output, 'Generate a report first with --output FILE, then check that same file.'), result);
  } else {
    saveJson(output, result);
  }
  console.log(JSON.stringify(result.baseline));
}
