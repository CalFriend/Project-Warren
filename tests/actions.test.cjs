const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadCloud}=require('../tools/load-cloud.cjs');
const {dcf,buildModels}=require('../tools/fundamental-models.cjs');
const C=loadCloud(['WarrenCore']).WarrenCore;
const {actionResearch:read, closingBars}=require('./fixtures/research.cjs');
const prices={'HK.06823':12.24,'HK.00220':8.405,'HK.00288':6.765};
const now=Date.parse('2026-11-16T10:00:00+08:00');
function quote(price,time=now){return {symbol:'HK.06823',price,time,status:'NORMAL',suspension:false};}
function upRule(){return read().securities.find(c=>c.symbol==='HK.06823').upsideValuation;}
test('five-year DCF agrees with independent constant-growth perpetuity and zero-growth boundary',()=>{
 assert.ok(Math.abs(dcf(1,.1,.02,.02).value-1.02/.08)<1e-10);
 assert.ok(Math.abs(dcf(.8277,.09,0,0).value-.8277/.09)<1e-10);
 assert.ok(dcf(1,.12,.02,.01).value<dcf(1,.1,.02,.01).value);
 assert.throws(()=>dcf(1,.02,.02,.02),/INVALID_MODEL/);
});
test('UPC separates operating assets from cash, pending distributions, and liquidity allowance',()=>{
 const m=buildModels(prices)['HK.00220'];
 const independentlyCalculatedOperatingValue=(2.482561*.725*.92*1.02)/(.095-.02);
 const independentlyCalculatedExcess=9.324022-2.050234-2.5+1.6+.760196;
 assert.ok(Math.abs(m.base.value-(independentlyCalculatedOperatingValue+independentlyCalculatedExcess)/4.319334*1.12)<1e-10);
 assert.ok(Math.abs(m.base.operatingValue-22.5198073432)<1e-8);
 assert.ok(m.base.reinvestment>0);
});
test('HKT AFF bridge and WH parent cash proxy reconcile to their published components',()=>{
 const m=buildModels(prices),h=m['HK.06823'].evidence,w=m['HK.00288'].evidence;
 assert.equal(h.cashBridge.reduce((a,b)=>a+b,0),2639);
 assert.equal(w.ttmNormalizedProfit,1591+1017-1168);
 assert.equal(w.cash2025.proxyToParent,2526-611-5-85-137+78+9-241);
 assert.equal(w.cash2024.proxyToParent,2519-707-5-80-136+36+8-210);
 assert.match(w.limitations,/not FCFE/);
});
test('changing income goals or spot prices cannot move intrinsic working-model valuations',()=>{
 const a=buildModels(prices),b=buildModels({...prices,'HK.06823':8,'HK.00220':15,'HK.00288':20});
 for(const symbol of Object.keys(a))for(const k of ['base','first','deep','improvement','high'])assert.equal(a[symbol][k].value,b[symbol][k].value);
 const d=read(),before=JSON.stringify(d.securities.map(c=>[c.valuation,c.upsideValuation,c.model?.calculation]));
 d.portfolio.incomeTargetCentral=.09;d.portfolio.incomeTargetGrossRange=[.09,.09];
 assert.equal(JSON.stringify(d.securities.map(c=>[c.valuation,c.upsideValuation,c.model?.calculation])),before);
 assert.ok(Math.abs(.8277/.07-.8277/.09)>2.6);
});
test('coverage and ordinary-income accounts keep new candidates and unvalidated companies separate',()=>{
 const d=read();assert.equal(d.securities.length,16);assert.equal(d.candidatePool.length,3);
 assert.equal(d.securities.filter(c=>C.ruleValid(c.valuation,'2026-11-16')).length,3);
 assert.equal(d.securities.filter(c=>C.ruleValid(c.upsideValuation,'2026-11-16')).length,3);
 assert.equal(d.portfolio.performanceWindow.confirmedOrdinaryDividendsReceived,null);
 assert.equal(C.portfolioMetrics(d).cost,9400);assert.ok(Math.abs(C.portfolioMetrics(d).gross - 892.84) < 1e-9);
 const forecast=d.portfolio.holdings.reduce((s,h)=>s+h.shares*d.securities.find(c=>c.symbol===h.symbol).decision.forecastOrdinaryDividend.base,0);
 assert.ok(Math.abs(forecast-d.portfolio.forecastOrdinaryIncome.base)<1e-8);
 for(const c of d.securities.filter(c=>c.valuation)){assert.ok(c.decision.value.explanation.length<=70);assert.ok(c.decision.forecastOrdinaryDividend.basis.length>50);}
});
test('upward rules reject reversed order and trigger only when price rises into a review zone',()=>{
 const r=upRule();assert.equal(C.ruleValid(r,'2026-11-16'),true);
 assert.equal(C.ruleValid({...r,second:12},'2026-11-16'),false);
 assert.equal(C.evaluate(quote(10),r,null,now).event,null);
 const out=C.evaluate(quote(13.6),r,null,now);assert.equal(out.event.level,1);assert.equal(out.event.direction,'up');
 assert.match(C.renderAlert([out.event]).text,/停止加仓/);
 assert.equal(C.evaluate(quote(15),r,null,now).event.level,2);
});
test('upward alerts survive restart, suppress duplicates and permit deeper escalation',()=>{
 const r=upRule(),a=C.evaluate(quote(13.6),r,null,now);
 const b=C.evaluate(quote(13.7,now+60000),r,JSON.parse(JSON.stringify(a.state)),now+60000);assert.equal(b.event,null);
 const c=C.evaluate(quote(14.8,now+120000),r,b.state,now+120000);assert.equal(c.event.level,2);
 const next=Date.parse('2026-11-17T10:00:00+08:00');assert.equal(C.evaluate(quote(14.9,next),r,c.state,next).event,null);
});
test('expired, disabled or stale upward rules cannot send actionable alerts',()=>{
 const r=upRule();assert.equal(C.evaluate(quote(15,now-180000),r,null,now).event,null);
 for(const change of [{enabled:false},{validUntil:'2026-11-15'},{kind:'income_watch'}])assert.equal(C.evaluate(quote(15),{...r,...change},null,now).event,null);
});
test('brief displays both model directions and forecast basis while risk block removes all price signals',()=>{
 const d=read(),dayNow=Date.parse('2026-11-14T09:30:00+08:00'),bars=closingBars();
 const out=C.renderBrief(d,{},dayNow,null,'预览',{closingBars:bars});
 assert.equal(out.researchFresh,true);assert.match(out.text,/有效基本面价格提醒 3\/16/);assert.match(out.text,/上行复核 13.55 \/ 14.70/);
 assert.match(out.text,/基准 11.44/);assert.match(out.text,/研究年息情景 840.00/);assert.match(out.text,/892.84/);
 const blocked=C.renderBrief(d,{},dayNow,null,'预览',{closingBars:bars,disabledSymbols:[{symbol:'HK.06823'}]});
 assert.ok(!blocked.text.includes('上行复核 13.55'));assert.ok(!blocked.text.includes('考虑价 10.10'));assert.match(blocked.text,/有效基本面价格提醒 2\/16/);
});
