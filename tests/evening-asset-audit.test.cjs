'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {loadCloud} = require('../tools/load-cloud.cjs');
const path = require('node:path');
const os = require('node:os');
const {evaluate, symbols, run} = require('../tools/evening-asset-audit.cjs');

const url = 'https://issuer.example/reports/q3.pdf';
const definition = {asset:'network',metric:'cash from operations',unit:'HKD million',basis:'consolidated after-tax full year',kind:'cash_flow'};
function check(day, values={}) {
  return {...definition,period:'2025-FY',periodEnd:'2025-12-31',source:url,publishedAt:'2026-03-01',
    checkedAt:day+'T21:40:00+08:00',actual:100,note:'Issuer cash flow statement line 2',...values};
}
function input(day='2026-11-18') {
  return {date:day,asOf:day+'T21:50:00+08:00',securities:symbols.map(symbol=>({
    symbol,name:symbol,method:'audit underlying operations',checks:[],gaps:['unreported'],next:'recheck the next announcement',
    sourceChecks:[{source:url,checkedAt:day+'T21:40:00+08:00',outcome:'no_change',detail:'examined filings since yesterday'}]
  }))};
}
function forecast(extra={}) {
  return {...definition,targetPeriod:'2026-FY',periodEnd:'2026-12-31',value:99,tolerance:1,asOf:'2026-11-18',
    source:'https://example.org/research/archive',reason:'Forecast operating cash under unchanged capacity',...extra};
}
function freeze() {
  const first = input();
  first.securities[0].forecasts = [forecast()];
  return evaluate(first);
}
function newActual(values={}) {
  const next = input('2027-03-01');
  next.securities[0].checks = [check(next.date,{period:'2026-FY',periodEnd:'2026-12-31',publishedAt:next.date,...values})];
  return next;
}
test('independent universe matches the official 16, including both funds',()=>{
  const {WarrenCore} = loadCloud(['WarrenCore']);
  assert.deepEqual(symbols,Array.from(WarrenCore.symbols,r=>r.symbol));
  const data=input(), r=evaluate(data);
  assert.equal(r.summary.securities,16);
  assert.equal(r.summary.securitiesWithSuccessfulSourceChecks,16);
  assert.equal(r.summary.scored,0);
  data.securities[0]=data.securities[1];
  assert.throws(()=>evaluate(data),/16_UNIQUE/);
  data.securities.pop();
  assert.throws(()=>evaluate(data),/16_UNIQUE/);
});
test('publishing a fresh report timestamp never upgrades old or missing source data',()=>{
  const data=input(), d=data.date;
  data.securities[0].checks=[
    check(d),check(d,{metric:'January operating cash',actual:null}),check(d,{metric:'February operating cash',source:'http://invalid'}),
    check(d,{metric:'next report',publishedAt:'2026-11-19'}),check(d,{metric:'unchecked',checkedAt:'2026-11-17T21:00:00+08:00'}),
    check(d,{metric:'release after check',publishedAt:d+'T21:45:00+08:00'}),check(d,{metric:'future operating period',periodEnd:'2027-01-31'})
  ];
  data.securities[1].sourceChecks[0].outcome='unavailable';
  const r=evaluate(data);
  assert.equal(r.summary.historicalBaselines,1);
  assert.equal(r.summary.unavailableChecks,6);
  assert.equal(r.summary.publishedToday,0);
  assert.equal(r.summary.securitiesWithSourceFailures,1);
  assert.equal(r.summary.securitiesWithSuccessfulSourceChecks,15);
  assert.equal(r.summary.scored,0);
});
test('unavailable holdings can state evidence gaps even if no direct source could be checked',()=>{
  const d=input();d.securities[0].sourceChecks=[];
  assert.equal(evaluate(d).summary.securitiesWithSuccessfulSourceChecks,15);
  d.securities[0].gaps=[];
  assert.throws(()=>evaluate(d),/INCOMPLETE_SECURITY_CARD/);
});
test('failed reads and same-evening conflicting values never count as forecast verdicts',()=>{
  const prior=freeze();
  const failed=newActual();failed.securities[0].sourceChecks[0].outcome='unavailable';
  const blocked=evaluate(failed,prior);
  assert.equal(blocked.summary.scored,0);
  assert(blocked.securities[0].checks[0].issues.includes('source_read_failed'));
  const bad=newActual();
  bad.securities[0].checks.push({...bad.securities[0].checks[0],actual:120,source:'https://issuer.example/correction.pdf'});
  const result=evaluate(bad,prior);
  assert.equal(result.summary.scored,0);
  assert.equal(result.evidenceHistory.length,0);
  assert(result.securities[0].checks.every(c=>c.issues.includes('conflicting_measurement')));
});
test('quoting a link without an independently recorded read cannot verify a forecast',()=>{
  const d=newActual(), c=d.securities[0];
  c.checks[0].source='https://issuer.example/unstudied.pdf';
  const r=evaluate(d,freeze());
  assert.equal(r.summary.scored,0);
  assert.equal(r.summary.unavailableChecks,1);
  assert(r.securities[0].checks[0].issues.includes('missing_source_read'));
  assert.equal(r.evidenceHistory.length,0);
});
test('fund observations with instrument as-of only keep the number and source without inventing a release',()=>{
  const d=input();d.securities[15].checks=[check(d.date,{kind:'fund_nav',metric:'unit NAV',actual:5.76,
    publishedAt:null,dataAsOf:'2026-11-17'})];
  const r=evaluate(d),c=r.securities[15].checks[0];
  assert.equal(r.summary.securities,16);
  assert.equal(c.actual,5.76);assert.equal(c.dataAsOf,'2026-11-17');
  assert(c.issues.includes('unavailable_disclosure_date'));assert.equal(r.summary.scored,0);
});
test('only company operating cash counts as asset cash; ETF NAV and total returns stay separate',()=>{
  const data=input();
  data.securities[0].checks=[check(data.date,{metric:'每股股息'}),check(data.date,{metric:'普通分红',kind:'distribution'})];
  data.securities[14].checks=[check(data.date,{metric:'unit NAV',kind:'fund_nav'}),check(data.date,{metric:'total return',kind:'fund_return'})];
  const r=evaluate(data);
  assert.equal(r.summary.cashFlowObservations,0);
  assert.equal(r.summary.unavailableChecks,1);
  assert.equal(r.securities[14].checks[0].classification,'fund_nav');
  assert.equal(r.summary.scored,0);
});
test('a genuine frozen forecast survives a quiet evening and gets scored when disclosed',()=>{
  const first=freeze(), quiet=evaluate(input('2026-11-19'),first);
  assert.equal(quiet.forecastLedger[0].firstFrozenAt,first.asOf);
  const r=evaluate(newActual(),quiet);
  assert.equal(r.summary.scored,1);
  assert.equal(r.summary.misses,0);
  assert.equal(r.scoreHistory[0].delta,1);
  assert.equal(r.summary.cashFlowComparisons,1);
});
test('a miss and subsequent published restatement remain separate, repeated evidence is never rescored',()=>{
  const miss=evaluate(newActual({actual:96}),freeze());
  assert.equal(miss.scoreHistory[0].outcome,'outside_tolerance');
  const d=input('2027-03-02');
  d.securities[0].checks=[check(d.date,{period:'2026-FY',periodEnd:'2026-12-31',publishedAt:'2027-03-01',actual:96})];
  const repeated=evaluate(d,miss);
  assert.equal(repeated.summary.repeatedObservations,1);
  assert.equal(repeated.summary.scored,0);
  const revised=input('2027-03-03');
  revised.securities[0].checks=[check(revised.date,{period:'2026-FY',periodEnd:'2026-12-31',publishedAt:'2027-03-03',actual:99})];
  const revision=evaluate(revised,repeated);
  assert.equal(revision.summary.restatements,1);
  assert.equal(revision.scoreHistory.length,2);
  assert.equal(revision.scoreHistory[1].outcome,'within_tolerance');
});
test('different period, company, basis, unit, horizon or type cannot validate a frozen forecast',()=>{
  const prior=freeze();
  for(const override of [{period:'2026-H2'},{unit:'USD million'},{basis:'excluding a business'},
    {periodEnd:'2026-12-30'},{kind:'driver'},{asset:'single segment'},{metric:'different measure'}]) {
    const r=evaluate(newActual(override),prior);
    assert.equal(r.summary.scored,0,JSON.stringify(override));
  }
  const d=newActual();d.securities[1].checks=d.securities[0].checks;d.securities[0].checks=[];
  assert.equal(evaluate(d,prior).summary.scored,0);
});
test('a self-reported prior never counts and a forecast first seen after period close cannot be backdated',()=>{
  const d=newActual({prior:forecast()});d.securities[0].forecasts=[forecast()];
  const r=evaluate(d);
  assert.equal(r.summary.scored,0);assert.equal(r.forecastLedger.length,0);
  assert.equal(r.securities[0].forecasts[0].status,'too_late_to_freeze');
  const prior=freeze(), next=input('2026-11-19');
  next.securities[0].forecasts=[forecast({value:104})];
  const conflict=evaluate(next,prior);
  assert.equal(conflict.forecastLedger[0].value,99);
  assert.equal(conflict.securities[0].forecasts[0].status,'frozen_forecast_conflict');
});
test('date boundaries use real Hong Kong time and reject lookahead from the same-day report',()=>{
  const data=input();data.asOf='2026-11-18T16:00:00Z';
  assert.throws(()=>evaluate(data),/INVALID_EVENING/);
  data.date='2026-11-19';data.asOf='2026-11-19T13:30:00Z';assert.equal(evaluate(data).date,data.date);
  const prior=freeze();
  assert.throws(()=>evaluate(input('2026-11-18'),prior),/INVALID_PREVIOUS/);
  const bad=input();bad.date='2026-02-30';assert.throws(()=>evaluate(bad),/INVALID_EVENING/);
});
test('a morning scan or fresh evening cover timestamp cannot substitute for a real late read',()=>{
  const d=input();
  d.asOf=d.date+'T21:29:59+08:00';assert.throws(()=>evaluate(d),/INVALID_EVENING/);
  d.asOf=d.date+'T21:50:00+08:00';
  d.securities[0].sourceChecks[0].checkedAt=d.date+'T09:15:00+08:00';
  d.securities[0].checks=[check(d.date)];
  d.securities[1].checks=[check(d.date,{checkedAt:d.date+'T09:15:00+08:00'})];
  const report=evaluate(d);
  assert.equal(report.summary.securitiesWithSuccessfulSourceChecks,15);
  assert.equal(report.summary.unavailableChecks,2);
  assert.equal(report.summary.historicalBaselines,0);
});
test('CLI saves a replayable separate report, accepts an identical retry, rejects changed overwrite',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'warren-evening-test-'));
  const inp=path.join(dir,'input.json'),out=path.join(dir,'out.json');
  try {
    const d=input();fs.writeFileSync(inp,JSON.stringify(d));run([inp,out]);run([inp,out]);
    assert.equal(JSON.parse(fs.readFileSync(out)).summary.securities,16);
    d.securities[0].checks=[check(d.date)];fs.writeFileSync(inp,JSON.stringify(d));
    assert.throws(()=>run([inp,out]),/Existing audit differs/);
    assert.throws(()=>run([inp,inp]),/distinct path/);
  } finally {
    for(const f of [inp,out]) if(fs.existsSync(f))fs.unlinkSync(f);
    fs.rmdirSync(dir);
  }
});
