const {marketInput, finishMarket} = require('./research-io.cjs');
const {rows, symbol, opts} = marketInput('events');
if (!opts.demo && symbol !== '^HSI') throw Error('This 28,000-point target study requires the ^HSI price index.');
if (rows.length < 252) throw Error('Supply at least 252 daily bars for the rolling-high study.');
const events=[];let armed=false;const targetReturn=28000/rows.at(-1).c-1;
for(let i=251;i<rows.length;i++){
 const peak=Math.max(...rows.slice(i-251,i+1).map(x=>x.c));
 const dd=rows[i].c/peak-1;
 if(!armed&&dd>-.05)armed=true;
 if(armed&&dd<=-.15){
  armed=false;const goal=rows[i].c*(1+targetReturn);let hit=null;
  for(let j=i+1;j<rows.length;j++)if(rows[j].c>=goal){hit=j;break;}
  events.push({date:rows[i].date,close:rows[i].c,drawdown:dd,target:goal,hitDate:hit===null?null:rows[hit].date,tradingDaysToHit:hit===null?null:hit-i,availableTradingDays:rows.length-1-i});
 }
}
const hist=events.filter(x=>x.date<'2026-01-01');
function summary(list){return {n:list.length,horizons:[126,252,504].map(n=>({tradingDays:n,fullyObservable:list.filter(x=>x.availableTradingDays>=n).length,hitsAmongFullyObservable:list.filter(x=>x.availableTradingDays>=n&&x.tradingDaysToHit!==null&&x.tradingDaysToHit<=n).length,censoredBeforeHorizon:list.filter(x=>x.availableTradingDays<n).length}))};}
const out={method:'First crossing below -15% from rolling 252-session highest close; rearmed after drawdown above -5%; target fixed as current 28000/current close - 1; daily close arrival, excludes dividends; overlapping forward horizons may remain, so not independent trials.',start:rows[0].date,end:rows.at(-1).date,targetReturn,all:summary(events),pre2026:summary(hist),events};
finishMarket(opts, 'hsi_event_study.json', out);
