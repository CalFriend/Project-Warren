const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadCloud}=require('../tools/load-cloud.cjs');
const C=loadCloud(['WarrenCore']).WarrenCore;
const {actionResearch:read, demoLinks}=require('./fixtures/research.cjs');
const day='2026-11-18',asOf=day+'T09:05:00+08:00',now=Date.parse(day+'T09:30:00+08:00');
function current(){
  const d=read();d.date=day;d.asOf=asOf;d.briefing.asOf=asOf;
  for(const card of d.securities){card.brief.asOf=asOf;card.decision.asOf=asOf;}
  d.sources[0].checkedAt=asOf;
  return d;
}
const symbol='HK.06823',daily={symbol,date:'2026-11-17',price:12.1,prevClose:12.2,final:true,autype:0,fetchedAt:now-1000};
function render(d,opts={}){return C.renderBrief(d,{},now,null,'预览',{...demoLinks,closingBars:{[symbol]:daily},...opts});}
test('empty, malformed and structurally corrupt snapshots return a four-column bulletin with independently verified closes',()=>{
  for(const mutate of [()=>null,()=>'',()=>'{"date":',()=>[],()=>({}),d=>({...d,securities:{}}),
    d=>({...d,sources:[null]})]){
    const input=mutate(current()),r=render(input);
    assert.equal(r.researchFresh,false);assert.match(r.subject,/待补/);assert.ok(r.errors.length);
    assert.equal((r.html.match(/<th scope="col"/g)||[]).length,4);
    assert.equal((r.html.split('aria-label="16只证券决策表"')[1].match(/<tr[ >]/g)||[]).length,17);assert.match(r.text,/香港电讯 06823 12.10/);
    assert.match(r.html,/aria-label="已确认持仓收息测算"/);assert.match(r.html,/持仓待核验/);
    assert.match(r.text,/先看这1件事/);assert.ok((r.text.match(/https:\/\//g)||[]).length===2);
    assert.ok(!r.text.includes(read().briefing.market));assert.ok(!r.html.includes('13.55'));
  }
});
test('changing only root date or copying all display dates fails without a new source read',()=>{
  const old=read(),r=render({...old,date:day});
  assert.ok(r.errors.includes('ASOF_INVALID'));assert.ok(!r.text.includes(old.briefing.market));
  const d=current();d.sources=old.sources;
  assert.ok(render(d).errors.includes('NO_CURRENT_SOURCE_CHECK'));
  d.sources[0].checkedAt=day+'T09:06:00+08:00';
  assert.ok(render(d).errors.includes('FUTURE_SOURCE'));
});
test('a prior-session source timestamp written with the new local date cannot pass the same-day check',()=>{
  const d=current();d.asOf='2026-11-17T08:00:00Z';assert.ok(render(d).errors.includes('ASOF_INVALID'));
  for(const invalid of ['2026-11-18',day+'T09:01:00',day+'T09:20:00+08:00','2026-11-31T09:01:00+08:00']){
    d.asOf=invalid;assert.equal(render(d).researchFresh,false);
  }
});
test('matching yesterday’s public text requires a new dated recheck that identifies a listed source and the result',()=>{
  const prior=read(),d=current(),options={previousResearch:prior};
  assert.ok(render(d,options).errors.includes('REPLAY_WITHOUT_RECHECK'));
  const checked={url:d.sources[0].url,checkedAt:asOf,outcome:'no_change',detail:'复核原公告列表，截至本轮没有取代上次决议的公告。'};
  for(const change of [{url:'https://elsewhere.example/doc'},{checkedAt:prior.asOf},{outcome:'updated'},{detail:'无变化'}]){
    d.sourceChecks=[{...checked,...change}];assert.ok(render(d,options).errors.includes('REPLAY_WITHOUT_RECHECK'));
  }
  d.sourceChecks=[checked];
  assert.equal(render(d,options).researchFresh,true);
  assert.equal(d.sources[0].publicationDate,prior.sources[0].publicationDate);
});
test('empty summary, invalid links and blank display rows cannot produce a complete report',()=>{
  for(const change of [d=>{d.summary=[];},d=>{d.summary=['   '];},d=>{d.sources[0].url='https://';},d=>{d.sources[0].title='  ';},
    d=>{d.securities=d.securities.map(c=>({symbol:c.symbol}));},d=>{d.briefing.change='';},d=>{d.sources[0].publicationDate='2027-01-01';}]){
    const d=current();change(d);assert.equal(render(d).researchFresh,false);
  }
});
test('one bad card withholds its figures but keeps all verified rows, partial holding totals and the normal sections',()=>{
  const d=current();d.securities[0].brief.asOf=read().asOf;d.securities[0].brief.recent='旧信息不可发';
  const r=render(d);assert.ok(r.errors.includes('CARD_INVALID_'+symbol));
  for(const t of [r.text,r.html]){
    assert.ok(!t.includes('旧信息不可发'));assert.ok(!t.includes('13.55'));assert.ok(t.includes(d.securities[1].brief.recent));
    assert.ok(t.includes(d.securities[1].decision.value.explanation));assert.ok(t.includes('0.5497'));
    assert.ok(t.includes('9400.00'));assert.ok(!t.includes('892.84'));assert.ok(!t.includes('840.00'));
    assert.ok(t.includes('完整输入、压力测算与调整记录'));assert.ok(t.includes('计划与操作复盘')||t.includes('计划与复盘'));
  }
  d.securities.push(d.securities[1]);assert.ok(render(d).errors.includes('DUPLICATE_HK.00220'));
});
test('upstream read or price failure cannot be overridden by a valid research header',()=>{
  const d=current(),r=render(d,{validationErrors:['NO_VERIFIED_PREVIOUS_CLOSE'],closingBars:{[symbol]:{...daily,symbol:'HK.00220'}}});
  assert.ok(r.errors.includes('NO_VERIFIED_PREVIOUS_CLOSE'));assert.match(r.text,/06823【持有】 —/);assert.ok(r.text.includes(d.briefing.market));
  assert.ok(!r.text.includes('已达上行持仓复核线'));assert.ok(!r.text.includes('还差'));
  const outage=render(d,{validationErrors:['RESEARCH_READ_FAILED']});
  assert.ok(!outage.text.includes(d.briefing.market));assert.ok(!outage.text.includes('9400.00'));
});
test('an invalid account row masks the account only; checked market and company information remains available',()=>{
  const d=current();d.portfolio.holdings=[null];const r=render(d);
  assert.equal(r.researchFresh,false);assert.match(r.html,/持仓待核验/);
  assert.ok(r.text.includes(d.securities[0].brief.recent));assert.ok(r.text.includes(d.briefing.market));
});
test('a null security row does not erase the other 15 checked securities',()=>{
  const d=current();d.securities[0]=null;const r=render(d);
  assert.equal(r.researchFresh,false);assert.ok(r.errors.includes('MISSING_HK.06823'));
  assert.ok(r.text.includes(d.securities[1].decision.value.explanation));assert.ok(!r.text.includes('13.55'));
});
