'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCloud} = require('../tools/load-cloud.cjs');
const {evaluate} = loadCloud(['WarrenLearning']).WarrenLearning;
const source = 'https://example.com/issuer/interim';
const checkedAt = '2026-11-18T21:30:00+08:00';
const date = '2026-11-18';
const defaultSymbol = 'HK.06823';
const included = ['maintenance','interest','tax','minorities','leases'];
const aff = {mode:'aff',currency:'HKD',scale:'million',scope:'parent',period:'TTM ending 2026-06-30',
  annual:true,shares:7582.398399,amount:6276,checkedAt,source,included,deductions:[]};
const operating = {mode:'operating',currency:'CNY',scale:'million',scope:'group',period:'2026-H1',annual:false,
  amount:926.734,totalCapex:546.629,source,checkedAt,included:['interest','tax'],deductions:[]};
const dcf = {mode:'perpetual',price:12.52,priceDate:date,priceSource:source,currency:'HKD',
  rate:.09,terminalGrowth:.015,years:5,growth:[0,.02,.03]};
function study(cash,dcfInput,symbol=defaultSymbol,cycle) {
  const report={date,asOf:checkedAt,securities:[{symbol}]};
  const packet={date,asOf:checkedAt,securities:[{symbol,cash,dcf:dcfInput,cycle}]};
  return evaluate({date},report,null,packet).securities[0];
}
test('owner earnings distinguish group all-capex proxy, equity earnings and the already adjusted AFF bridge',()=>{
  const proxy=study(operating,dcf);
  assert.equal(proxy.ownerCash.status,'after_all_capex_proxy');
  assert(Math.abs(proxy.ownerCash.value-380.105)<1e-9);
  assert.equal(proxy.ownerCash.perUnit,null);
  assert.equal(proxy.reverseDcf.status,'insufficient_evidence');
  const parent=study({...operating,scope:'parent',period:'2025-FY',annual:true,shares:10,currency:'HKD',
    included:['interest','tax','leases','minorities'],maintenanceCapex:200},dcf);
  assert.equal(parent.ownerCash.status,'owner_earnings');
  assert.equal(parent.ownerCash.value,726.734);
  assert.equal(study(aff,dcf).ownerCash.status,'verified_aff_bridge');
  assert.equal(study({...aff,maintenanceCapex:0},dcf).ownerCash.status,'insufficient_evidence');
  assert.equal(study({...operating,deductions:[{id:'interest',amount:10,note:'fee'}]},dcf).ownerCash.status,'insufficient_evidence');
  assert.equal(study({...operating,maintenanceCapex:600},dcf).ownerCash.status,'insufficient_evidence');
  assert.equal(study({...aff,period:'2026-H1'},dcf).ownerCash.status,'insufficient_evidence');
});
test('reverse DCF recovers the growth embedded in market price and handles missing or mismatched evidence',()=>{
  const out=study(aff,dcf).reverseDcf;
  assert(out.impliedAnnualGrowth>.039 && out.impliedAnnualGrowth<.043);
  assert(out.scenarios[1].value>11.43 && out.scenarios[1].value<11.46);
  assert.equal(study(aff,{...dcf,currency:'USD'}).reverseDcf.status,'insufficient_evidence');
  assert.equal(study(aff,{...dcf,priceDate:'2026-11-16'}).reverseDcf.status,'insufficient_evidence');
  assert.equal(study(aff,{...dcf,price:1e10}).reverseDcf.status,'no_solution_in_bounds');
  assert.equal(study(aff,{...dcf,terminalGrowth:.09}).reverseDcf.status,'insufficient_evidence');
  assert.equal(study(undefined,dcf).reverseDcf.status,'insufficient_evidence');
});
test('issuer group AFF lacking an ordinary-holder reconciliation remains a proxy even with an explicit allocation assumption',()=>{
  const group={...aff,scope:'group',included:included.filter(x=>x!=='minorities')};
  const missed=study(group,dcf);
  assert.equal(missed.ownerCash.status,'issuer_aff_proxy');
  assert.equal(missed.ownerCash.eligibleForDcf,false);
  assert.equal(missed.ownerCash.perUnit,null);
  assert.equal(missed.reverseDcf.status,'insufficient_evidence');
  assert.equal(study(group,{...dcf,assumedOwnerShare:1.01}).reverseDcf.status,'insufficient_evidence');
  const full=study(group,{...dcf,assumedOwnerShare:1}).reverseDcf;
  const half=study(group,{...dcf,assumedOwnerShare:.5}).reverseDcf;
  assert.equal(full.status,'conditional_proxy_sensitivity');
  assert.equal(full.authorizedForTrading,false);
  assert.equal(full.scenarios[1].value/2,half.scenarios[1].value);
});
test('contract expiry gives zero terminal value; bank and fund models never capitalize the corporate cash bridge',()=>{
  const finite={...dcf,mode:'finite',rightYears:2,rightEndsOn:'2028-11-18',rightSource:source,
    terminalGrowth:0,growth:[-.02,0,.02],price:1.50};
  const out=study(aff,finite,'HK.01052').reverseDcf;
  const cash=aff.amount/aff.shares;
  assert.equal(out.scenarios[1].terminalPortion,0);
  assert(Math.abs(out.scenarios[1].value-cash/1.09-cash/1.09**2)<1e-10);
  assert.equal(study(aff,{...finite,terminalGrowth:.02},'HK.01052').reverseDcf.status,'insufficient_evidence');
  assert.equal(study(aff,{...finite,rightEndsOn:'2028-11-17'},'HK.01052').reverseDcf.status,'insufficient_evidence');
  assert.equal(study(aff,{...finite,rightSource:null},'HK.01052').reverseDcf.status,'insufficient_evidence');
  assert.equal(study(aff,dcf,'HK.00177').reverseDcf.status,'insufficient_evidence');
  for (const symbol of ['HK.00939','HK.03416','HK.03417']) {
    const result=study(aff,dcf,symbol);
    assert.equal(result.ownerCash.status,'not_applicable');
    assert.equal(result.reverseDcf.status,'not_applicable');
  }
});
test('cycle diagnostics require consecutive completed comparable years and expose interpolated historical quartiles',()=>{
  const base={metric:'annual Brent spot',unit:'USD/bbl',source,checkedAt,note:'Realised oil price and gas revenue can differ.',
    history:[2019,2020,2021,2022,2023,2024].map((year,i)=>({year,value:50+10*i}))};
  const run=c=>study(undefined,undefined,'HK.00883',c).cycle;
  const c=run(base);
  assert.deepEqual([c.lowerQuartile,c.median,c.upperQuartile],[62.5,75,87.5]);
  assert.equal(c.role,'observed_driver_reference_only');
  for (const bad of [base.history.slice(0,4),[...base.history,base.history[5]],
    [...base.history,{year:2026,value:100}],base.history.map(x=>({...x,unit:'CNY/t'}))])
    assert.equal(run({...base,history:bad}).status,'insufficient_evidence');
});

// Each December, publish a new H1 forecast using disclosures for June of the same year.
function vintages(actuals,extraReleases=false) {
  const model={symbol:defaultSymbol,asset:'network',metric:'AFF',unit:'HKD million',basis:'consolidated group AFF',
    kind:'cash_flow',source};
  const evidenceHistory=[],forecastLedger=[],scoreHistory=[],outputs=[];
  let previous=null;
  for (const [i,current] of actuals.entries()) {
    const year=2018+i,day=year+'-12-01',stamp=day+'T21:30:00+08:00',period=year+'-H1';
    evidenceHistory.push({...model,period,firstSeen:day,release:year+'-08-01',actual:current});
    const original=forecastLedger.find(x=>x.targetPeriod===period);
    if (original) {
      const score={...model,eventId:period,actual:current,predicted:original.value,
        targetPeriod:period,publishedAt:year+'-08-01',reviewedOn:day,disclosure:source,
        frozenAt:original.firstFrozenAt,forecastSource:source};
      scoreHistory.push(score);
      if(extraReleases) scoreHistory.push({...score,eventId:'revised'+period,actual:current+5,publishedAt:year+'-09-01'});
    }
    forecastLedger.push({...model,targetPeriod:(year+1)+'-H1',value:current+10,periodEnd:(year+1)+'-06-30',
      firstFrozenAt:stamp,asOf:stamp});
    if(extraReleases) forecastLedger.push({...forecastLedger.at(-1),value:current+4,source:source+'?second-vintage'});
    const report={date:day,asOf:stamp,securities:[{symbol:defaultSymbol}],evidenceHistory,forecastLedger,scoreHistory};
    previous=evaluate({date:day},report,previous,null);
    outputs.push(previous);
  }
  return outputs;
}
test('a missing track record stays unproven and forecasts, revisions and repeated scoring are not independent samples',()=>{
  const r=vintages([100,100,100],true).at(-1);
  assert.equal(r.samples.length,2);
  assert.equal(r.tracks[0].distinctScoredPeriods,2);
  assert.equal(r.tracks[0].status,'insufficient_independent_periods');
  assert.equal(r.tracks[0].meanSignedError,-10);
  assert.equal(r.tracks[0].originalMAE,10);
  assert.equal(r.tracks[0].naiveMAE,0);
});
test('a candidate losing its out-of-sample comparison cannot be promoted; winning comparisons trigger human review only',()=>{
  const losing=vintages([100,100,100,100,110,120],true);
  assert.equal(losing[3].tracks[0].status,'awaiting_forward_evidence');
  assert.equal(losing[3].tracks[0].candidate.forwardScored,0);
  const failed=losing.at(-1).tracks[0].candidate;
  assert.equal(failed.status,'not_supported');
  assert.equal(failed.forwardScored,2);
  const naiveBeatsCandidate=vintages([100,100,100,100,100,100]).at(-1).tracks[0].candidate;
  assert.equal(naiveBeatsCandidate.status,'not_supported');
  assert(naiveBeatsCandidate.forwardCandidateMAE<naiveBeatsCandidate.forwardOriginalMAE);
  assert(naiveBeatsCandidate.forwardCandidateMAE>naiveBeatsCandidate.forwardNaiveMAE);
  const winning=vintages([100,100,100,100,105,110]).at(-1);
  assert.equal(winning.tracks[0].candidate.status,'recommend_human_review');
  assert.equal(winning.tracks[0].candidate.adjustment,-5);
  assert.equal(winning.tracks[0].candidate.forwardCandidateMAE,0);
  assert.equal(winning.policy.autoPublish,false);
  assert.equal(vintages([100,110,120,130,140]).at(-1).tracks[0].status,'retain_original');
});
test('a failed rule stays archived when three genuinely new training periods support a later candidate',()=>{
  const audit=vintages([100,100,100,100,100,100,100,100,100]).at(-1),track=audit.tracks[0];
  assert.equal(track.candidateHistory[0].status,'not_supported');
  assert.equal(track.candidate.version,2);
  assert.equal(track.candidate.trainingPeriods.length,3);
  assert.equal(track.candidate.forwardScored,0);
});
test('daytime source checks cannot impersonate the scheduled evening run',()=>{
  assert.equal(study({...aff,checkedAt:'2026-11-18T09:10:00+08:00'},dcf).ownerCash.status,'insufficient_evidence');
});
test('late baselines cannot be invented once a result is known or a forecast ends',()=>{
  const old='2025-01-01T21:30:00+08:00',model={symbol:defaultSymbol,asset:'A',metric:'cash',basis:'group',
    unit:'HKD million',kind:'cash_flow',source};
  const report={date,asOf:checkedAt,securities:[{symbol:defaultSymbol}],
    evidenceHistory:[{...model,period:'2024-H1',actual:50,firstSeen:date,release:'2024-08-01'}],
    forecastLedger:[{...model,targetPeriod:'2026-H1',periodEnd:'2026-06-30',asOf:old,firstFrozenAt:old,value:55}],
    scoreHistory:[{...model,targetPeriod:'2026-H1',frozenAt:old,publishedAt:'2026-08-15',forecastSource:source,
      predicted:55,actual:54,disclosure:source}]};
  const out=evaluate({date},report,null,null);
  assert.equal(out.benchmarks.length,0);
  assert.equal(out.summary.independentlyScored,0);
  assert.equal(out.unpairedScores[0].originalError,-1);
  assert.equal(out.unpairedScores[0].absOriginal,1);
});
