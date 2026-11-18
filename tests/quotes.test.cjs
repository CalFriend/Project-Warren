const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadCloud}=require('../tools/load-cloud.cjs');
const C=loadCloud(['WarrenCore']).WarrenCore;
const now=Date.parse('2026-11-13T09:30:10+08:00');
const stale={symbol:'HK.03416',price:7.715,prevClose:7.8,dataDate:'2026-11-12',time:Date.parse('2026-11-12T15:58:38+08:00'),suspension:false,status:'NORMAL'};
test('daily unadjusted close restores a thinly traded security without relabeling its old last trade',()=>{
 const bars=C.normalizeCloses(stale.symbol,[{code:stale.symbol,date:20261112,close_price:7.715,last_close_price:7.8}],now);
 const r=C.closingInfo(stale,stale,'2026-11-13','2026-11-12',now,null,bars['2026-11-12']);assert.equal(r.price,7.715);assert.equal(r.usable,true);assert.ok(Math.abs(r.change-(7.715/7.8-1))<1e-12);
 assert.equal(C.closingInfo(stale,stale,'2026-11-13','2026-11-12',now,null).price,null);
});
test('today unfinished bars, future dates, different symbols and adjusted bars are not prior closes',()=>{
 const b=C.normalizeCloses(stale.symbol,[{code:stale.symbol,date:20261113,close_price:7.7},{code:'HK.00003',date:20261112,close_price:7}],now);assert.equal(Object.keys(b).length,0);
 const d={symbol:stale.symbol,date:'2026-11-12',price:7.715,final:true,autype:1,fetchedAt:now};assert.equal(C.closingInfo(stale,stale,'2026-11-13','2026-11-12',now,null,d).price,null);
});
test('contradicting previous close and halt block proximity even with a daily bar',()=>{
 const d=C.normalizeCloses(stale.symbol,[{code:stale.symbol,date:20261112,close_price:7.715,last_close_price:7.8}],now)['2026-11-12'];
 const q={...stale,time:now,dataDate:'2026-11-13',prevClose:8};assert.equal(C.closingInfo(q,stale,'2026-11-13','2026-11-12',now,null,d).usable,false);
 q.suspension=true;assert.equal(C.closingInfo(q,stale,'2026-11-13','2026-11-12',now,null,d).usable,false);
});
test('retrieval freshness never upgrades an old price to realtime eligible',()=>{
 const q={...stale,time:now-180000,dataDate:'2026-11-13',fetchedAt:now};const h=C.quoteHealth({[q.symbol]:q},now);
 assert.equal(h.fetchedCount,1);assert.equal(h.freshCount,0);assert.equal(h.rejected[q.symbol],'STALE_QUOTE');
});
