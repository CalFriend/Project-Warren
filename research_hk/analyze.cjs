const {marketInput, finishMarket} = require('./research-io.cjs');
const {rows, symbol, opts} = marketInput('analyze', true);
if (rows.length < 253) throw Error('Supply at least 253 daily bars for annual volatility.');
const arr=rows.map(x=>x.c);
const last=rows.at(-1);
function sma(n){return arr.slice(-n).reduce((a,b)=>a+b,0)/n;}
function vol(n){const a=arr.slice(-n-1).map((v,i,a)=>i?Math.log(v/a[i-1]):null).slice(1);const m=a.reduce((s,v)=>s+v,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1))*Math.sqrt(252);}
let gain=0,loss=0;for(let i=1;i<=14;i++){let d=arr[i]-arr[i-1];gain+=Math.max(0,d)/14;loss+=Math.max(0,-d)/14;}for(let i=15;i<arr.length;i++){let d=arr[i]-arr[i-1];gain=(gain*13+Math.max(0,d))/14;loss=(loss*13+Math.max(0,-d))/14;}
const RSI14=100-100/(1+gain/loss);
const recent=rows.filter(x=>x.date>='2025-11-14');
if (!recent.length || recent.some(row => !Number.isFinite(row.h) || !Number.isFinite(row.l)))
  throw Error('Supply daily high/low values in the 52-week window ending 2026-11-13.');
const hi=recent.reduce((p,x)=>x.h>p.h?x:p,recent[0]);
const lo=recent.reduce((p,x)=>x.l<p.l?x:p,recent[0]);
const closehi=recent.reduce((p,x)=>x.c>p.c?x:p,recent[0]);
const events=[];let peak=rows[0],trough=peak,start=null;
for(const x of rows.slice(1)){if(x.c>=peak.c){if(start){events.push({peak:peak.date,peakC:peak.c,trough:trough.date,troughC:trough.c,recovery:x.date,drawdown:trough.c/peak.c-1,monthsToRecover:(new Date(x.date)-new Date(peak.date))/86400000/30.4375,monthsFromTrough:(new Date(x.date)-new Date(trough.date))/86400000/30.4375});start=null;}peak=x;trough=x;}else{if(x.c<trough.c)trough=x;if(x.c/peak.c-1<=-.1)start=true;}}
if(start)events.push({peak:peak.date,peakC:peak.c,trough:trough.date,troughC:trough.c,recovery:null,drawdown:trough.c/peak.c-1});
const out={symbol,n:rows.length,start:rows[0],end:last,SMA20:sma(20),SMA50:sma(50),SMA200:sma(200),SMA250:sma(250),RSI14,vol20:vol(20),vol60:vol(60),vol252:vol(252),fiftyTwoWeekHigh:hi,fiftyTwoWeekLow:lo,fiftyTwoWeekClosingHigh:closehi,drawdownFromClosingPeak:last.c/closehi.c-1,drawdownFromIntradayPeak:last.c/hi.h-1,events,last65:rows.slice(-65)};
const safeSymbol = symbol.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
finishMarket(opts, safeSymbol + '_analysis.json', out, {...out, last65:undefined});
