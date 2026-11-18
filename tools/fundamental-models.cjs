'use strict';
// All rates and forward assumptions below are research judgements, not market consensus.
function dcf(cash0, rate, growth, terminalGrowth, years=5) {
  if (!(rate>terminalGrowth && rate>0 && cash0>=0)) throw Error('INVALID_MODEL');
  const cashflows=Array.from({length:years},(_,i)=>cash0*(1+growth)**(i+1));
  const pvCash=cashflows.reduce((s,c,i)=>s+c/(1+rate)**(i+1),0);
  const terminal=cashflows.at(-1)*(1+terminalGrowth)/(rate-terminalGrowth);
  const pvTerminal=terminal/(1+rate)**years;
  return {cash0,rate,growth,terminalGrowth,cashflows,pvCash,pvTerminal,value:pvCash+pvTerminal,terminalShare:pvTerminal/(pvCash+pvTerminal)};
}
// Both callers price positive cash flows and increase with the assumed growth rate.
function solve(target,fn,lo,hi) {
  const lowValue=fn(lo), highValue=fn(hi);
  if (![target,lowValue,highValue].every(Number.isFinite) || lowValue>=highValue || target<lowValue || target>highValue) return null;
  for(let i=0;i<100;i++){
    const mid=(lo+hi)/2, value=fn(mid);
    if(!Number.isFinite(value)) return null;
    if(value<target) lo=mid; else hi=mid;
  }
  const growth=(lo+hi)/2;
  return Math.abs(fn(growth)-target)<=1e-9*Math.max(1,Math.abs(target)) ? growth : null;
}
function buildModels(prices) {
 const hkt={base:dcf(.8277,.09,.02,.015),rateLow:dcf(.8277,.085,.02,.015),rateHigh:dcf(.8277,.095,.02,.015),
  first:dcf(.8277,.10,.02,.015),deep:dcf(.8277,.09,0,0),improvement:dcf(.8277,.085,.03,.02),high:dcf(.8277,.08,.03,.02),stress:dcf(.8277*.9,.105,0,0)};
 hkt.impliedFiveYearGrowth=solve(prices['HK.06823'],g=>dcf(.8277,.09,g,.015).value,-.1,.15);
 hkt.evidence={affH1_2026:2639,affH2_2025:3637,shares:7582398399,cfoH1_2026:5261,netDebtH1_2026:44934,unit:'HKD million unless shares',cashBridge:[6586,-981,-805,-344,-603,-752,-445,-17],cashBridgeSum:2639};
 const upcCoreEbit=(2.565047-.039857-.087332)+(1.804714-1.648742-(.131267-.019998));
 const upcNopat=upcCoreEbit*(1-.275);
 const excess=9.324022-2.050234-2.5+1.6+.760196;
 const upcCase=(r,g,roc,fx=1.12,earn=1)=>{
   const nopat=upcNopat*earn,reinvestment=nopat*g/roc,cash=nopat-reinvestment,m=dcf(cash,r,g,g);
   return {...m,nopat,reinvestment,returnOnNewCapital:roc,excessAssets:excess,shares:4.319334,hkdPerCny:fx,value:(m.value+excess)/4.319334*fx,operatingValue:m.value};
 };
 const upc={base:upcCase(.095,.02,.25),rateLow:upcCase(.09,.02,.25),rateHigh:upcCase(.10,.02,.25),
  first:upcCase(.105,.01,.20),deep:upcCase(.105,0,.20,1.12,.9),improvement:upcCase(.09,.03,.25),high:upcCase(.085,.03,.25),stress:upcCase(.115,0,.20,1.064,.85)};
 upc.impliedSustainableGrowth=solve(prices['HK.00220'],g=>upcCase(.095,g,.25).value,-.02,.07);
 upc.evidence={unit:'RMB billion',coreEbit:upcCoreEbit,nopat:upcNopat,netCashH1:9.324022,declaredUnpaidDividendH1:2.050234,liquidityReserveAssumption:2.5,structuredDepositsCost:1.6,associateJVBook:.760196,excessAssets:excess,
  annual2025:{revenue:31.714309,ebit:2.565047,otherGains:.039857,governmentGrants:.087332,netProfit:2.050234,cfo:3.284365,cashCapex:1.084518,leasePrincipal:.030149,netWorkingCapitalRelease:.197408},
  half2026:{revenue:17.320967,ebit:1.804714,priorEbit:1.648742,otherGains:.131267,priorOtherGains:.019998,netProfit:1.402353,cfo:.926734,cashCapex:.546629,leasePrincipal:.016346}};
 const whCase=(eps,conversion,r,g,t)=>{const m=dcf(eps*conversion,r,g,t);return {...m,epsUSD:eps,cashConversion:conversion,hkdPerUsd:7.845,value:m.value*7.845,equityValueUSD:m.value};};
 const wh={base:whCase(.11,.8,.105,.02,.01),rateLow:whCase(.11,.8,.10,.02,.01),rateHigh:whCase(.11,.8,.11,.02,.01),
  first:whCase(.11,.7,.105,.01,.005),deep:whCase(.11,.7,.105,0,0),improvement:whCase(.12,.85,.10,.025,.015),high:whCase(.124,.9,.10,.025,.015),stress:whCase(.088,.7,.12,0,0)};
 wh.impliedCashConversion=.8*prices['HK.00288']/wh.base.value;
 wh.evidence={unit:'USD million unless EPS',normalizedProfit2025:1591,normalizedProfit9M2025:1168,normalizedProfit9M2026:1017,ttmNormalizedProfit:1440,
  normalEPSUSD:.11,normalEPSBasis:'Rounded research assumption below approximately 11.2 US cents implied by TTM parent profit; not an exact basic/diluted EPS splice.',
  cash2025:{cfo:2526,capex:611,otherCapital:5,leasePrincipal:85,interestPaid:137,interestReceived:78,associateDividends:9,minorityDividends:241,proxyToParent:1534},
  cash2024:{cfo:2519,capex:707,otherCapital:5,leasePrincipal:80,interestPaid:136,interestReceived:36,associateDividends:8,minorityDividends:210,proxyToParent:1425},
  half2026:{cfo:680,capex:265,debt:4414,cash:2201,treasuryProducts:1561,parentEquity:11162},parentEquityQ3:10976,
  limitations:'Parent cash proxy uses minority dividends, not full minority economic cash; excludes acquisitions. It is a cross-check, not FCFE. No cash/assets are added again to equity earnings valuation.'};
 return {'HK.06823':hkt,'HK.00220':upc,'HK.00288':wh};
}
module.exports={dcf,solve,buildModels};
if (require.main === module) {
  const path = require('node:path');
  const {options, readJson, saveJson} = require('../research_hk/research-io.cjs');
  const args = options('node tools/fundamental-models.cjs [--input CLOSES.json | --demo] [--output NEW.json]\n' +
    'Reproduce the November 2026 study. Supply HKD prices in quotes[symbol].price for HK.06823, HK.00220 and HK.00288. ' +
    '--demo uses invented prices with the dated historical model.', ['input', 'demo']);
  const research = path.join(__dirname, '..', 'research');
  const prices = {};
  if (args.demo) {
    Object.assign(prices, {'HK.06823': 10, 'HK.00220': 9, 'HK.00288': 7});
  } else {
    const file = args.input || path.join(research, 'closing-20261113.json');
    const {quotes} = readJson(file, 'Supply --input CLOSES.json or run --demo.');
    for (const symbol of ['HK.06823', 'HK.00220', 'HK.00288']) {
      const price = quotes?.[symbol]?.price;
      if (!Number.isFinite(price) || price <= 0) throw Error('Missing positive HKD quote for ' + symbol);
      prices[symbol] = price;
    }
  }
  const models = buildModels(prices);
  const summary = Object.fromEntries(Object.entries(models).map(([symbol, m]) => [symbol, {
    base:m.base.value, low:m.rateHigh.value, high:m.rateLow.value, first:m.first.value, deep:m.deep.value,
    up:m.improvement.value, upper:m.high.value, stress:m.stress.value,
    impliedGrowth:m.impliedFiveYearGrowth??m.impliedSustainableGrowth, impliedConversion:m.impliedCashConversion,
  }]));
  const defaultOutput = !args.input && !args.demo ? path.join(research, 'fundamental-models-20261114.json') : null;
  saveJson(args.output || defaultOutput, args.demo ? {syntheticPrices:true, prices, models} : models);
  console.log(JSON.stringify(args.demo ? {syntheticPrices:true, prices, summary} : summary));
}
