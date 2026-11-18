const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadCloud}=require('../tools/load-cloud.cjs');
const C=loadCloud(['WarrenCore']).WarrenCore;
const {decisionResearch:fixture, frameworkResearch}=require('./fixtures/research.cjs');
const now=Date.parse('2026-11-13T09:30:30+08:00');
test('confirmed holdings use total budget and per-payment collection minimum, including invested capital',()=>{
 const p=C.portfolioMetrics(fixture());assert.equal(p.cost,9400);assert.equal(p.headroom,22600);assert.ok(Math.abs(p.gross - 892.84) < 1e-9);assert.equal(p.collection,40);assert.equal(p.monthlyYear,132);assert.ok(Math.abs(p.afterFees - 720.84) < 1e-9);
});
test('missing dividend components or unconfirmed holdings never invent net income',()=>{
 const d=fixture();delete d.securities[0].decision.income.paymentsHKD;assert.equal(C.portfolioMetrics(d).afterFees,null);d.portfolio.currentHoldingsVerified=false;assert.equal(C.portfolioMetrics(d).headroom,null);
});
test('one income hurdle is not an independently validated company valuation',()=>{
 const d=fixture(),hkt=d.securities[0],m=C.decisionMetrics(hkt,12.22);assert.ok(Math.abs(m.income7-11.824285714)<1e-8);assert.equal(m.value,null);
 const unified=d.securities[1],u=C.decisionMetrics(unified,8.485);assert.equal(u.value,null);assert.ok(Math.abs(u.income7-7.852857142857)<1e-8);
 const ship=d.securities.find(x=>x.symbol==='HK.03877');assert.equal(C.decisionMetrics(ship,2.33).annual,.1);
});
test('income-only rules are withdrawn even with dated dividend evidence',()=>{
 const r=fixture().securities[0].valuation;assert.equal(C.ruleValid(r,'2026-11-13'),false);
 for(const change of [{first:12.8},{currency:'CNY'},{dividendPeriod:''},{basis:'optimistic'},{validUntil:'2026-11-12'}])assert.equal(C.ruleValid({...r,...change},'2026-11-13'),false);
});
test('income-only thresholds cannot produce a live alert',()=>{
 const r=fixture().securities[0].valuation,q={symbol:'HK.06823',price:11.8,time:now,dataDate:'2026-11-13',suspension:false,status:'NORMAL'};
 assert.equal(C.evaluate(q,r,null,now).event,null);
});
test('all sixteen rows show reasoning and income arithmetic, without old arbitrary ranges',()=>{
 const d=fixture(),out=C.renderBrief(d,{},now,null,'预览');assert.equal(out.format,'decision-v3');for(const c of d.securities)assert.ok(out.text.includes(c.symbol.slice(3)));
 assert.ok(!out.text.includes('分红折现 0.8277÷'));assert.ok(!out.text.includes('7%条件价'));assert.match(out.text,/每万元/);assert.match(out.text,/720.84/);assert.ok(!out.text.includes('10.35–14.07'));assert.ok(!out.text.includes('6.45–10.04'));assert.ok(out.text.length<4700);
});
test('a fresh daily close alone cannot turn a dividend hurdle into a proximity signal',()=>{
 const d=fixture(),q={symbol:'HK.06823',price:12.22,prevClose:12.34,dataDate:'2026-11-12',time:Date.parse('2026-11-12T15:58:00+08:00'),suspension:false,status:'NORMAL'};
 const bar={symbol:q.symbol,date:'2026-11-12',price:12.22,prevClose:12.34,autype:0,final:true,fetchedAt:now-1000};
 let out=C.renderBrief(d,{[q.symbol]:q},now,null,'预览',{closingBars:{[q.symbol]:bar}});assert.ok(!out.text.includes('香港电讯距7%收息'));
 d.date='2026-11-12';out=C.renderBrief(d,{[q.symbol]:q},now,null,'预览',{closingBars:{[q.symbol]:bar}});assert.ok(!out.text.includes('香港电讯距7%收息'));
});
test('portfolio income goal cannot move an independently specified value or attention line',()=>{
 const d=frameworkResearch();
 const c=d.securities[0];c.valuation={version:'synthetic-fundamental',status:'published',enabled:true,asOf:'2026-11-13',validUntil:'2026-11-20',first:12,second:10,ordinaryDividend:.8277,fairValue:{low:12,high:14},sources:['https://www.hkt.com/'],rationale:'合成基本面测试，非投资判断',invalidation:'现金预测失效'};
 const bar={symbol:c.symbol,date:'2026-11-12',price:12.22,prevClose:12.34,autype:0,final:true,fetchedAt:now-1000};
 d.briefing.focus=[];d.portfolio.incomeTargetCentral=.05;
 const a=C.renderBrief(d,{},now,null,'预览',{closingBars:{[c.symbol]:bar}});
 d.portfolio.incomeTargetCentral=.08;
 const b=C.renderBrief(d,{},now,null,'预览',{closingBars:{[c.symbol]:bar}});
 const priceSection=r=>r.text.split('\n').filter(line=>line.startsWith('• ')||/\b\d{5}(?:【持有】)? /.test(line));assert.equal(priceSection(a).length,17);assert.deepEqual(priceSection(a),priceSection(b));assert.match(a.text,/距基本面复核线12.00还差1.83%/);
 c.valuation.enabled=false;
 assert.ok(!C.renderBrief(d,{},now,null,'预览',{closingBars:{[c.symbol]:bar}}).text.includes('距基本面复核线'));
});
test('revised example framework preserves holdings and dividends while withdrawing uncalibrated price models',()=>{
 const d=frameworkResearch();
 assert.equal(d.securities.length,16);assert.ok(Math.abs(C.portfolioMetrics(d).gross - 892.84) < 1e-9);
 for(const c of d.securities){assert.equal(c.valuation,null);assert.notEqual(c.decision.value.kind,'ddm_check');}
 const out=C.renderBrief(d,{},now,null,'预览');assert.match(out.text,/有效基本面价格提醒 0\/16/);
 assert.ok(!out.text.includes('条件价'));assert.ok(!out.text.includes('11.82还差'));
});
