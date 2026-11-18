const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadCloud}=require('../tools/load-cloud.cjs');
const C=loadCloud(['WarrenCore']).WarrenCore;
test('quote access can include account-bound metadata without trading grants',()=>{assert.equal(C.quoteOnlyScope('quote:read'),true);assert.equal(C.quoteOnlyScope('quote:read accid:*'),true);assert.equal(C.quoteOnlyScope('quote:read accid:123456'),true);});
test('trading, account reads, watchlist writes and unknown scopes remain rejected',()=>{for(const scope of ['quote:read trade:read','quote:read trade:write','quote:read quote:write','quote:read mystery:read','accid:*',''])assert.equal(C.quoteOnlyScope(scope),false);});
const ms=s=>Date.parse(s+'+08:00');
const now=ms('2026-11-10T10:00:00');
function quote(price,time=now){return {symbol:'HK.06823',price,time,status:'NORMAL',suspension:false};}
function rule(){return {version:'v1',status:'published',enabled:true,asOf:'2026-11-10',validUntil:'2026-12-10',first:12,second:11,
 sources:['https://www.hkt.com/'],rationale:'合成测试',invalidation:'合成失效条件',ordinaryDividend:0.81,fairValue:{low:12,high:14}};}
function research(){
 const asOf='2026-11-10T09:15:00+08:00';
 return {schemaVersion:1,status:'published',date:'2026-11-10',asOf,summary:['完成今日公告复核'],
  briefing:{asOf,format:'compact-v1',market:'完成今日公告复核',change:'行业政策有待正式公布',focus:[]},
  securities:C.symbols.map(({symbol})=>({symbol,brief:{asOf,recent:'已复核公告日期和现金流披露',watch:'下次报告中的普通分派',decision:'维持'}})),
  sources:[{title:'港交所公告索引',url:'https://www.hkex.com.hk/',checkedAt:asOf}]};
}

test('Hong Kong day boundary is independent of computer timezone',()=>assert.equal(C.parts(Date.parse('2026-11-10T16:00:00Z')).day,'2026-11-11'));
test('verified 2026 exchange holidays include both April 6 and 7',()=>{assert.equal(C.marketDay('2026-04-06'),'CLOSED');assert.equal(C.marketDay('2026-04-07'),'CLOSED');});
test('exchange half days have no afternoon alerts',()=>{assert.equal(C.session(ms('2026-12-24T10:00:00')),'CONTINUOUS');assert.equal(C.session(ms('2026-12-24T14:00:00')),'OUTSIDE_SESSION');});
test('future calendar is unknown until sourced, never assumed open',()=>assert.equal(C.marketDay('2027-01-04'),'UNKNOWN'));
test('provider calendar can represent afternoon-only and closures',()=>{const cal={start:'2027-01-01',end:'2027-01-31',days:[{time:'2027-01-04',trade_date_type:'AFTERNOON'}]};assert.equal(C.session(ms('2027-01-04T10:00:00'),cal),'OUTSIDE_SESSION');assert.equal(C.session(ms('2027-01-04T14:00:00'),cal),'CONTINUOUS');assert.equal(C.marketDay('2027-01-05',cal),'CLOSED');});
test('lunch is outside continuous trading',()=>assert.equal(C.session(ms('2026-11-10T12:30:00')),'OUTSIDE_SESSION'));
test('morning report is due at 09:30, never 09:29, and once only',()=>{assert.equal(C.dueBrief(ms('2026-11-10T09:29:59'),{}),false);assert.equal(C.dueBrief(ms('2026-11-10T09:30:00'),{}),true);assert.equal(C.dueBrief(ms('2026-11-10T09:30:00'),{briefDay:'2026-11-10'}),false);});
test('late wake does not send an hours-old morning brief',()=>assert.equal(C.dueBrief(ms('2026-11-10T14:00:00'),{}),false));
test('weekend is skipped',()=>assert.equal(C.dueBrief(ms('2026-11-14T09:30:00'),{}),false));
test('previous trading day handles multi-day holiday',()=>assert.equal(C.previousDay('2026-04-08'),'2026-04-02'));
test('DDM and combined stress match independently calculated results',()=>{assert.ok(Math.abs(C.dgm(.81,.08,.015)-12.46153846)<1e-7);assert.equal(C.dgm(.729,.09,.015),9.72);});
test('invalid perpetuity growth is rejected',()=>assert.throws(()=>C.dgm(.81,.02,.03),/INVALID_DDM/));
test('finite concession cash flows do not silently assume a terminal asset',()=>assert.ok(Math.abs(C.dcf([1,1],.1,0)-(1/1.1+1/1.21))<1e-10));
test('reverse valuation and dividend hurdle remain distinct',()=>{assert.ok(Math.abs(C.impliedGrowth(12,.81,.08)-.0125)<1e-10);assert.equal(C.incomePrice(.81,.0675),12);});
test('historical and disabled rules cannot generate alerts',()=>{const r=rule();r.status='historical';assert.equal(C.evaluate(quote(10),r,null,now).event,null);r.status='published';r.enabled=false;assert.equal(C.evaluate(quote(10),r,null,now).event,null);});
test('expired evidence disables valuation lines',()=>{const r=rule();r.validUntil='2026-11-09';assert.equal(C.ruleValid(r,'2026-11-10'),false);});
test('rules need original sources and a falsification condition',()=>{const r=rule();r.sources=[];assert.equal(C.ruleValid(r,'2026-11-10'),false);r.sources=['https://www.hkt.com/'];r.invalidation='';assert.equal(C.ruleValid(r,'2026-11-10'),false);});
test('initial deep-zone position emits only the highest level',()=>{const result=C.evaluate(quote(10.8),rule(),null,now);assert.equal(result.event.level,2);assert.equal(result.event.reason,'INITIAL_STATE');});
test('first threshold escalates to second without cooldown suppression',()=>{const a=C.evaluate(quote(11.8),rule(),null,now);const b=C.evaluate(quote(10.9,now+60000),rule(),a.state,now+60000);assert.equal(b.event.level,2);});
test('durable state suppresses duplicate alert after restart',()=>{const a=C.evaluate(quote(11.8),rule(),null,now);const restored=JSON.parse(JSON.stringify(a.state));assert.equal(C.evaluate(quote(11.7,now+60000),rule(),restored,now+60000).event,null);});
test('remaining inside same band tomorrow does not generate a new alert',()=>{const a=C.evaluate(quote(11.8),rule(),null,now);const next=ms('2026-11-11T10:00:00');assert.equal(C.evaluate(quote(11.7,next),rule(),a.state,next).event,null);});
test('stale or future quotes do not create crossings',()=>{assert.equal(C.evaluate(quote(10,now-180000),rule(),null,now).rejected,'STALE_QUOTE');assert.equal(C.evaluate(quote(10,now+60000),rule(),null,now).rejected,'STALE_QUOTE');});
test('halted and unknown security status cannot create alerts',()=>{const q=quote(10);q.suspension=true;assert.equal(C.evaluate(q,rule(),null,now).rejected,'NON_NORMAL_SECURITY');delete q.suspension;assert.equal(C.evaluate(q,rule(),null,now).event,null);});
test('out-of-order quotes leave durable state untouched',()=>{const a=C.evaluate(quote(13),rule(),null,now);assert.equal(C.evaluate(quote(10,now-1000),rule(),a.state,now).rejected,'DUPLICATE_OR_OUT_OF_ORDER');});
test('new valuation version is clearly labelled, not an invented crossing',()=>{const a=C.evaluate(quote(12.1),rule(),null,now);const r=rule();r.version='v2';r.first=12.2;assert.equal(C.evaluate(quote(12.1,now+60000),r,a.state,now+60000).event.reason,'RULE_UPDATED');});
test('ex-dividend trigger is retained with an explicit caveat',()=>{const r=rule();r.exDividendDate='2026-11-10';const e=C.evaluate(quote(11.9),r,null,now).event;assert.equal(e.exDividend,true);assert.match(C.renderAlert([e]).text,/机械除息/);});
test('freshness requires published research before the information cutoff',()=>{const r=research();assert.equal(C.validateResearch(r,'2026-11-10',now).length,0);r.status='research_pending';assert.ok(C.validateResearch(r,'2026-11-10',now).includes('RESEARCH_NOT_PUBLISHED'));r.status='published';r.asOf='2026-11-10T09:20:00+08:00';assert.ok(C.validateResearch(r,'2026-11-10',now).includes('AFTER_INFORMATION_CUTOFF'));});
test('all sixteen instruments and unique symbols are required',()=>{const r=research();r.securities.pop();assert.ok(C.validateResearch(r,'2026-11-10',now).some(x=>x.startsWith('MISSING_')));});
test('old price is not presented as yesterday closing price',()=>{assert.equal(C.quoteClose({dataDate:'2026-11-05',price:12},'2026-11-10','2026-11-09'),null);assert.equal(C.quoteClose({dataDate:'2026-11-10',price:13,prevClose:12},'2026-11-10','2026-11-09'),12);});
test('HTML escapes concise research text',()=>{const r=research();r.briefing.market='<img src=x onerror=alert(1)>';const html=C.renderBrief(r,{},now,null,'test').html;assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));});
test('missing research produces a labelled limited report',()=>{const r=C.renderBrief(null,{},now,null,'行情待授权');assert.equal(r.researchFresh,false);assert.match(r.text,/资料未完成或已过期/);assert.match(r.text,/无合格报价/);});

test('quote health distinguishes complete snapshots from fresh intraday coverage',()=>{const all=Object.fromEntries(C.symbols.map(s=>[s.symbol,{...quote(10),symbol:s.symbol}]));const health=C.quoteHealth(all,now);assert.equal(health.allFreshDuringSession,true);assert.equal(health.freshCount,16);all['HK.03417'].time=now-180000;const partial=C.quoteHealth(all,now);assert.equal(partial.freshCount,15);assert.equal(partial.allFreshDuringSession,false);assert.equal(partial.rejected['HK.03417'],'STALE_QUOTE');});
test('after-hours snapshots never assert intraday freshness',()=>{const later=ms('2026-11-10T23:00:00');const all=Object.fromEntries(C.symbols.map(s=>[s.symbol,{...quote(10,later),symbol:s.symbol}]));assert.equal(C.quoteHealth(all,later).allFreshDuringSession,false);assert.equal(C.quoteHealth(all,later).freshCount,0);});
