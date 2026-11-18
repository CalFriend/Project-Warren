/* Deterministic rules. No credentials, network, orders or model calls. */
var WarrenCore = (function () {
  'use strict';
  var VERSION = '0.6.0';
  var symbols = warrenUniverse();
  var holidays2026 = ['01-01','02-17','02-18','02-19','04-03','04-06','04-07','05-01','05-25','06-19','07-01','10-01','10-19','12-25'];
  var half2026 = ['02-16','12-24','12-31'];
  function assert(ok, code) { if (!ok) throw new Error(code); }
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function quoteOnlyScope(scope) {
    if(typeof scope!=='string')return false;
    var a=scope.split(/\s+/).filter(Boolean);
    // accid limits account scope; data/actions still require trade:read or trade:write.
    return a.indexOf('quote:read')>=0&&a.every(function(s){return s==='quote:read'||/^accid:(\*|[0-9]+)$/.test(s);});
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function parts(ms) {
    assert(finite(Number(ms)), 'INVALID_TIME');
    var d=new Date(Number(ms)+8*3600000);
    assert(!isNaN(d.getTime()), 'INVALID_TIME');
    return {day:d.toISOString().slice(0,10),minute:d.getUTCHours()*60+d.getUTCMinutes(),weekday:d.getUTCDay()};
  }
  function marketDay(day,calendar) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(day),'INVALID_DAY');
    if(calendar && calendar.start<=day && calendar.end>=day) {
      var entry=(calendar.days||[]).find(function(x){return x.time===day;});
      return entry ? entry.trade_date_type : 'CLOSED';
    }
    var weekday=new Date(day+'T00:00:00Z').getUTCDay();
    if(weekday===0||weekday===6)return 'CLOSED';
    if(day.slice(0,4)!=='2026')return 'UNKNOWN';
    if(holidays2026.indexOf(day.slice(5))>=0)return 'CLOSED';
    return half2026.indexOf(day.slice(5))>=0?'MORNING':'WHOLE';
  }
  function session(ms,calendar) {
    var p=parts(ms),type=marketDay(p.day,calendar),m=p.minute;
    if(type==='CLOSED'||type==='UNKNOWN')return type;
    if(type!=='AFTERNOON'&&m>=570&&m<720)return 'CONTINUOUS';
    if(type!=='MORNING'&&m>=780&&m<960)return 'CONTINUOUS';
    if(type==='MORNING'&&m>=720&&m<730||type!=='MORNING'&&m>=960&&m<970)return 'CLOSING_AUCTION';
    return 'OUTSIDE_SESSION';
  }
  function previousDay(day,calendar) {
    var d=new Date(day+'T00:00:00Z');
    for(var i=0;i<15;i++) {d.setUTCDate(d.getUTCDate()-1);var s=d.toISOString().slice(0,10),t=marketDay(s,calendar);if(t==='UNKNOWN')return null;if(t!=='CLOSED')return s;}
    return null;
  }
  function dueBrief(ms,state,calendar) {
    var p=parts(ms),t=marketDay(p.day,calendar);
    return t!=='CLOSED'&&t!=='UNKNOWN'&&p.minute>=570&&p.minute<600&&state.briefDay!==p.day;
  }
  function dgm(dividend,requiredReturn,growth) {
    assert(finite(dividend)&&dividend>=0&&finite(requiredReturn)&&finite(growth)&&requiredReturn>growth&&requiredReturn>0,'INVALID_DDM');
    return dividend/(requiredReturn-growth);
  }
  function dcf(cashflows,rate,terminalValue) {
    assert(Array.isArray(cashflows)&&cashflows.length>0&&cashflows.every(finite)&&finite(rate)&&rate>0&&finite(terminalValue),'INVALID_DCF');
    return cashflows.reduce(function(s,c,i){return s+c/Math.pow(1+rate,i+1);},0)+terminalValue/Math.pow(1+rate,cashflows.length);
  }
  function impliedGrowth(price,dividend,requiredReturn) {assert(finite(price)&&price>0&&finite(dividend)&&dividend>=0&&finite(requiredReturn),'INVALID_INPUT');return requiredReturn-dividend/price;}
  function incomePrice(dividend,yieldTarget){assert(finite(dividend)&&dividend>=0&&finite(yieldTarget)&&yieldTarget>0,'INVALID_INPUT');return dividend/yieldTarget;}
  function ruleValid(rule,day) {
    if(!rule||rule.status!=='published'||rule.enabled!==true||!rule.version||rule.asOf>day||rule.validUntil<day||!rule.asOf||!rule.validUntil)return false;
    if(!Array.isArray(rule.sources)||!rule.sources.length||!rule.sources.every(function(u){return /^https:\/\//.test(u);}))return false;
    var direction=rule.direction||'down';
    if(['down','up'].indexOf(direction)<0)return false;
    if(!finite(rule.first)||!finite(rule.second)||rule.first<=0||rule.second<=0||(direction==='up'?rule.second<rule.first:rule.second>rule.first))return false;
    if(!rule.rationale||!rule.invalidation||!finite(rule.ordinaryDividend)||rule.ordinaryDividend<0)return false;
    // A portfolio income goal cannot establish company value or a price alert.
    if(rule.kind==='income_watch')return false;
    if(!rule.fairValue||!finite(rule.fairValue.low)||!finite(rule.fairValue.high)||rule.fairValue.low<=0||rule.fairValue.high<rule.fairValue.low)return false;
    return true;
  }
  function ruleBookValid(data,now){
    if(!record(data)||data.status!=='published'||data.schemaVersion!==1||!Array.isArray(data.securities)||data.securities.length!==symbols.length)return false;
    var stamp=instant(data.asOf);
    return finite(stamp)&&stamp<=now&&parts(stamp).day===data.date&&symbols.every(function(s){
      return data.securities.some(function(c){return record(c)&&c.symbol===s.symbol&&Object.prototype.hasOwnProperty.call(c,'valuation');});
    });
  }
  function watchRule(card,field,day,blocks,bookDay){
    var r=card&&card[field];
    if(!r||!ruleValid(r,day)||(r.direction||'down')!==(field==='valuation'?'down':'up')||
       !/^\d{4}-\d{2}-\d{2}$/.test(r.asOf)||!/^\d{4}-\d{2}-\d{2}$/.test(r.validUntil)||
       r.asOf>bookDay||r.kind!=='fundamental_review'||
       r.fairValue.base!=null&&(!finite(r.fairValue.base)||r.fairValue.base<r.fairValue.low||r.fairValue.base>r.fairValue.high))return null;
    var blocked=blocks.some(function(b){return typeof b==='string'?b===card.symbol:b&&b.symbol===card.symbol&&(!b.reviewedVersion||b.reviewedVersion!==r.version);});
    return blocked?null:r;
  }
  function ruleLevels(r){
    return r?[r.first,r.second,r.fairValue.low,finite(r.fairValue.base)?r.fairValue.base:null,r.fairValue.high]:null;
  }
  function priceRuleId(r){return r?(r.direction||'down')+'-'+r.first+'-'+r.second:null;}
  function validateQuote(q,now,calendar,maxAge) {
    if(!q||!symbols.some(function(x){return x.symbol===q.symbol;}))return 'UNWATCHED_SYMBOL';
    if(!finite(q.price)||q.price<=0||!finite(q.time))return 'INVALID_QUOTE';
    if(q.suspension!==false||q.status!=='NORMAL')return 'NON_NORMAL_SECURITY';
    if(q.time>now+5000||now-q.time>(maxAge||120000))return 'STALE_QUOTE';
    if(parts(q.time).day!==parts(now).day)return 'WRONG_TRADE_DATE';
    var s=session(q.time,calendar);
    if(s!=='CONTINUOUS'&&s!=='CLOSING_AUCTION')return s;
    return null;
  }
  function normalizeQuote(q,fetchedAt) {
    return {symbol:q.code,price:q.last_price,time:q.data_time,dataDate:q.data_date,prevClose:q.prev_close_price,
      suspension:q.suspension,status:q.sec_status,volume:q.volume,source:'Futu WebAPI',fetchedAt:fetchedAt||null};
  }
  function normalizeCloses(symbol,bars,now,calendar){
    var result={};
    (Array.isArray(bars)?bars:[]).forEach(function(b){
      var raw=String(b.date||''),day=raw.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
      if(b.code!==symbol||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!finite(b.close_price)||b.close_price<=0)return;
      var type=marketDay(day,calendar),cutoff=Date.parse(day+(type==='MORNING'?'T12:15:00+08:00':'T16:15:00+08:00'));
      if(type==='CLOSED'||type==='UNKNOWN'||!finite(cutoff)||cutoff>now)return;
      result[day]={symbol:symbol,date:day,price:b.close_price,prevClose:finite(b.last_close_price)&&b.last_close_price>0?b.last_close_price:null,
        source:'Futu日K（不复权）',autype:0,final:true,fetchedAt:now};
    });
    return result;
  }
  function quoteHealth(quotes,now,calendar) {
    var rejected={},fresh=[];
    symbols.forEach(function(s){var reason=validateQuote((quotes||{})[s.symbol],now,calendar);if(reason)rejected[s.symbol]=reason;else fresh.push(s.symbol);});
    var marketSession=session(now,calendar),inSession=marketSession==='CONTINUOUS'||marketSession==='CLOSING_AUCTION';
    var fetched=symbols.filter(function(s){var q=(quotes||{})[s.symbol];return q&&finite(q.price)&&q.price>0&&finite(q.fetchedAt)&&q.fetchedAt<=now+5000&&now-q.fetchedAt<=120000;}).map(function(s){return s.symbol;});
    return {checkedAt:new Date(now).toISOString(),marketSession:marketSession,received:Object.keys(quotes||{}).length,fetchedCount:fetched.length,
      note:'获取时间与价格更新时间分别记录；价格超过120秒未更新时暂停该条实时触价判断，不记作抓取失败。',
      freshCount:fresh.length,freshSymbols:fresh,rejected:rejected,allFreshDuringSession:inSession&&fresh.length===symbols.length};
  }
  function evaluate(q,rule,prior,now,calendar) {
    var rejected=validateQuote(q,now,calendar);
    if(rejected)return {event:null,state:prior||null,rejected:rejected};
    if(prior&&q.time<=prior.time)return {event:null,state:prior,rejected:'DUPLICATE_OR_OUT_OF_ORDER'};
    var day=parts(now).day,valid=ruleValid(rule,day),state=clone(prior||{level:0,armed:true,aboveSince:null,notified:{}});
    state.notified=state.notified||{};
    if(state.day!==day)state.notified={};
    var direction=valid&&(rule.direction||'down'),level=valid?(direction==='up'?(q.price>=rule.second?2:q.price>=rule.first?1:0):(q.price<=rule.second?2:q.price<=rule.first?1:0)):0;
    var changed=valid&&state.version!==rule.version,initial=!prior;
    var event=null;
    if(valid&&level>0&&(initial||changed||level>state.level)) {
      var key=day+'|'+q.symbol+'|'+rule.version+'|'+direction+'|'+level;
      if(!state.notified[key]&&(initial||changed||level>1||state.armed)) {
        event={id:key,symbol:q.symbol,price:q.price,quoteTime:q.time,createdAt:now,level:level,
          reason:initial?'INITIAL_STATE':changed?'RULE_UPDATED':'CROSSED',ruleVersion:rule.version,
          threshold:level===2?rule.second:rule.first,ordinaryYield:rule.ordinaryDividend/q.price,
          kind:rule.kind||'valuation',direction:direction,action:rule.action||'',condition:rule.condition||'',budgetNote:rule.budgetNote||'',dividendPeriod:rule.dividendPeriod||null,fairValue:rule.fairValue,risk:rule.risk||'',rationale:rule.rationale,invalidation:rule.invalidation,
          sources:rule.sources,exDividend:rule.exDividendDate===day};
        state.notified[key]=true;state.armed=false;state.aboveSince=null;
      }
    }
    if(valid&&(direction==='up'?q.price<rule.first*0.995:q.price>rule.first*1.005)) {
      if(!state.aboveSince)state.aboveSince=now;
      if(now-state.aboveSince>=300000)state.armed=true;
    } else state.aboveSince=null;
    state.level=level;state.time=q.time;state.price=q.price;state.day=day;state.version=valid?rule.version:null;state.direction=direction||null;
    return {event:event,state:state,rejected:null};
  }
  function record(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
  function nonempty(x){return typeof x==='string'&&!!x.trim();}
  function sourceUrl(x){return typeof x==='string'&&/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i.test(x);}
  function instant(x){
    return typeof x==='string'&&/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(x)&&
      new Date(x.slice(0,10)+'T00:00:00Z').getUTCDate()===Number(x.slice(8,10))?Date.parse(x):NaN;
  }
  function verifiedToday(x,day,asOf){var t=instant(x);return finite(t)&&parts(t).day===day&&t<=asOf;}
  function cardReady(c,asOf,decision){
    var b=c.brief,d=c.decision;
    if(!record(b)||b.asOf!==asOf||!shortText(b.recent,decision?52:42,null)||!shortText(b.watch,decision?40:32,null))return false;
    if(['维持','上调','下调','首次','暂停','待核'].indexOf(b.decision)<0)return false;
    return !decision||record(d)&&d.asOf===asOf&&shortText(d.driver,40,null)&&shortText(d.action,65,null)&&record(d.value)&&shortText(d.value.explanation,70,null);
  }
  // Compare what a reader would see, ignoring timestamps and the order of holdings.
  function displayedResearch(d){
    var b=d.briefing,cards=d.securities;
    if(!record(b)||!Array.isArray(cards)||cards.some(function(c){return !record(c);}))return null;
    return JSON.stringify([b.market,b.change,Array.isArray(b.focus)?b.focus.map(function(f){return f&&f.text;}):[],symbols.map(function(s){
      var c=cards.find(function(x){return x.symbol===s.symbol;})||{},brief=c.brief||{},v=c.decision||{};
      return [brief.recent,brief.watch,brief.decision,v.driver,v.action,v.value&&v.value.explanation];
    })]);
  }
  function validateResearch(data,day,now,options) {
    var errors=[],asOf=instant(data&&data.asOf),cutoff=Date.parse(day+'T09:15:00+08:00');
    if(!data||data.schemaVersion!==1)return ['SCHEMA_INVALID'];
    if(data.status!=='published')errors.push('RESEARCH_NOT_PUBLISHED');
    if(data.date!==day)errors.push('RESEARCH_NOT_TODAY');
    if(!finite(asOf)||parts(asOf).day!==day||asOf>now)errors.push('ASOF_INVALID');
    if(asOf>cutoff)errors.push('AFTER_INFORMATION_CUTOFF');
    if(!Array.isArray(data.summary)||!data.summary.length||data.summary.length>5||!data.summary.every(nonempty))errors.push('SUMMARY_INVALID');
    var b=record(data.briefing)?data.briefing:{},decision=b.format==='decision-v2'||b.format==='decision-v3';
    if((!decision&&b.format!=='compact-v1')||b.asOf!==data.asOf||!shortText(b.market,decision?80:65,null)||!shortText(b.change,decision?80:55,null)||!Array.isArray(b.focus)||b.focus.length>3||b.focus.some(function(f){return !record(f)||!nonempty(f.text);}))errors.push('BRIEFING_INVALID');
    if(!Array.isArray(data.securities))errors.push('SECURITIES_INVALID');
    else {var seen={};data.securities.forEach(function(c){
      if(!record(c)||!symbols.some(function(s){return s.symbol===c.symbol;})){errors.push('UNKNOWN_SYMBOL');return;}
      if(seen[c.symbol])errors.push('DUPLICATE_'+c.symbol);
      seen[c.symbol]=true;
      if(!cardReady(c,data.asOf,decision))errors.push('CARD_INVALID_'+c.symbol);
    });symbols.forEach(function(s){if(!seen[s.symbol])errors.push('MISSING_'+s.symbol);});}
    var sources=Array.isArray(data.sources)?data.sources:[];
    if(!sources.length||!sources.every(function(x){return record(x)&&sourceUrl(x.url)&&nonempty(x.title);}))errors.push('SOURCES_INVALID');
    if(sources.some(function(x){return record(x)&&(instant(x.checkedAt)>asOf||(/^\d{4}-\d{2}-\d{2}$/.test(x.publicationDate)&&x.publicationDate>day));}))errors.push('FUTURE_SOURCE');
    var checks=Array.isArray(data.sourceChecks)?data.sourceChecks:[];
    function currentCheck(x){return record(x)&&verifiedToday(x.checkedAt,day,asOf)&&['no_change','updated'].indexOf(x.outcome)>=0&&
      nonempty(x.detail)&&!/^\s*(无|不变|无变化|未核实|待核验|无更新|no change|n\/?a|none|pending)\s*[。.]?$/i.test(x.detail)&&sources.some(function(s){return record(s)&&s.url===x.url&&sourceUrl(s.url);});}
    if(!sources.some(function(x){return record(x)&&verifiedToday(x.checkedAt,day,asOf);})&&!checks.some(currentCheck))errors.push('NO_CURRENT_SOURCE_CHECK');
    var prior=options&&options.previousResearch;
    if(record(prior)&&prior.date<day&&displayedResearch(data)===displayedResearch(prior)&&!checks.some(function(x){return currentCheck(x)&&x.outcome==='no_change';}))errors.push('REPLAY_WITHOUT_RECHECK');
    if(data.portfolio&&data.portfolio.holdings!==undefined&&(!Array.isArray(data.portfolio.holdings)||data.portfolio.holdings.some(function(h){return !record(h)||!symbols.some(function(s){return s.symbol===h.symbol;})||!finite(h.shares)||h.shares<=0||!finite(h.costPrice)||h.costPrice<0;})))errors.push('HOLDINGS_INVALID');
    return errors;
  }
  function escape(s) {return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function money(n){return finite(n)?n.toFixed(2):'待核验';}
  function percent(n){return finite(n)?(100*n).toFixed(2)+'%':'待核验';}
  function quoteClose(q,day,previous) {
    if(!q)return null;
    if(q.dataDate===day&&finite(q.prevClose)&&q.prevClose>0)return q.prevClose;
    if(q.dataDate===previous&&finite(q.price)&&q.price>0)return q.price;
    return null;
  }
  // Compact prose must be supplied as complete sentences. Never truncate a financial
  // qualification mid-sentence or silently fall back to the full research cards.
  function shortText(value,max,fallback){
    if(typeof value!=='string')return fallback;
    var s=value.replace(/\s+/g,' ').trim();return s&&Array.from(s).length<=max?s:fallback;
  }
  function priceText(n){return finite(n)?(Math.abs(n*100-Math.round(n*100))<1e-7?n.toFixed(2):n.toFixed(3)):'—';}
  function dividendText(n){return finite(n)?n.toFixed(4).replace(/0+$/,'').replace(/\.$/,''):'—';}
  function shortName(s){var names={'HK.00220':'统一企业','HK.00823':'领展','HK.01052':'越秀交通','HK.02638':'港灯',
    'HK.00883':'中海油','HK.00003':'中华煤气','HK.00177':'宁沪高速','HK.03877':'中国船舶租赁','HK.00696':'中国航信',
    'HK.03416':'国指备兑ETF','HK.03417':'恒科备兑ETF'};return names[s.symbol]||s.name;}
  function closingInfo(q,archived,day,prior,now,calendar,daily){
    var normal=function(x){return x&&x.suspension===false&&x.status==='NORMAL'&&finite(x.time)&&x.time<=now+5000&&parts(x.time).day===x.dataDate;};
    // A current halt or abnormal state must not be hidden by a normal old snapshot.
    if(q&&(q.suspension!==false||q.status!=='NORMAL'))return {price:null,change:null,usable:false};
    if(daily&&daily.date===prior&&daily.symbol===(q&&q.symbol||archived&&archived.symbol||daily.symbol)&&daily.final===true&&daily.autype===0&&finite(daily.price)&&daily.price>0&&finite(daily.fetchedAt)&&daily.fetchedAt<=now+5000){
      if(normal(q)&&q.dataDate===day&&finite(q.prevClose)&&Math.abs(q.prevClose-daily.price)>0.00001)return {price:null,change:null,usable:false,reason:'收盘来源不一致'};
      return {price:daily.price,change:finite(daily.prevClose)&&daily.prevClose>0?daily.price/daily.prevClose-1:null,usable:true,source:daily.source};
    }
    var closed=function(x){return normal(x)&&x.dataDate===prior&&parts(x.time).minute>=(marketDay(prior,calendar)==='MORNING'?720:960);};
    var current=normal(q)&&(q.dataDate===day||closed(q))?quoteClose(q,day,prior):null;
    var old=closed(archived)?archived:null;
    var price=current!==null?current:old?quoteClose(old,day,prior):null;
    var basis=closed(q)?q:old,change=null;
    // Today's prevClose is yesterday's price, not yesterday's percentage change.
    // Only compare two closes from the same dated snapshot; mismatches stay blank.
    if(price!==null&&basis&&finite(basis.prevClose)&&basis.prevClose>0&&Math.abs(basis.price-price)<1e-7)change=price/basis.prevClose-1;
    return {price:price,change:change,usable:price!==null};
  }
  function securityClose(symbol,quotes,options,day,prior,now,calendar){
    function item(map){var x=map&&map[symbol];return record(x)&&x.symbol===symbol?x:null;}
    return closingInfo(item(quotes),item(options.closingQuotes),day,prior,now,calendar,item(options.closingBars));
  }
  function compactLevel(c,close,day,canCompare,blocked){
    var rule=c.valuation,p=c.preliminaryRange,m=c.model||{},result={lines:[],focus:null};
    if(blocked){result.lines=['旧点位暂停','等待风险复核'];return result;}
    if(ruleValid(rule,day)){
      result.lines=['估值 '+money(rule.fairValue.low)+'–'+money(rule.fairValue.high),'向下关注 '+money(rule.first)+' / '+money(rule.second)];
      if(canCompare){var threshold=close<=rule.second?rule.second:rule.first,d=(close-threshold)/threshold;
        if(d<=0){result.lines.push('已达价格条件');result.focus={priority:1,text:'已达向下关注线'+money(threshold)+'，先复核基本面'};}
        else if(d<=0.05){var label=d<=0.02?'临近':'进入关注';result.lines.push(label+'，距线'+percent(d));result.focus={priority:2,text:label+'：距向下关注线'+money(threshold)+'还差'+percent(d)};}}
      return result;
    }
    // An expired published rule must not quietly reactivate an earlier draft target.
    if(rule){result.lines=['旧点位已失效','等待重新核定'];return result;}
    if(p&&finite(p.low)&&finite(p.high)&&p.low>0&&p.high>=p.low){
      var support=c.symbol==='HK.00014'||c.symbol==='HK.00003';
      result.lines=[(support?'分派测算 ':'研究 ')+money(p.low)+'–'+money(p.high)];
      if(finite(p.base)&&p.base>0)result.lines.push('基准 '+money(p.base)+'（待核）');
      if(canCompare&&!support&&finite(p.base)&&p.base>0){var distance=(close-p.base)/p.base;
        if(Math.abs(distance)<=0.05)result.focus={priority:4,text:(distance>=0?'距研究参考'+money(p.base)+'还差':'已低于研究参考'+money(p.base)+' ')+percent(Math.abs(distance))+'；尚未核定'};}
    }else if(m.kind==='nav'&&finite(m.nav)&&m.nav>0&&/^\d{4}-\d{2}-\d{2}$/.test(m.navDate||'')){
      result.lines=['净值 '+money(m.nav),'截至 '+m.navDate.slice(5)];
    }else if(m.incomeReference&&finite(m.incomeReference.value)&&m.incomeReference.value>0){
      result.lines=['收息参考 '+money(m.incomeReference.value),'经营权估值待核'];
    }else result.lines=['点位待核定'];
    return result;
  }
  function decisionMetrics(card,price){
    var d=card&&card.decision||{},inc=d.income||{},fx=inc.currency==='HKD'?1:inc.fxAssumption;
    var cash=finite(inc.annual)&&inc.annual>=0&&finite(fx)&&fx>0?inc.annual*fx:null;
    var result={annual:cash,fxEstimated:inc.currency!=='HKD',income7:cash===null?null:cash/0.07,
      stressIncome7:cash===null?null:cash*0.8/0.07,yield:cash!==null&&finite(price)&&price>0?cash/price:null,
      per10000:cash!==null&&finite(price)&&price>0?cash/price*10000:null,value:null,fiveYearCash:cash===null?null:cash*5};
    var v=d.value||{};
    // Uncalibrated DDM examples are retained in history, never promoted to value.
    return result;
  }
  function dividendFee(amount,fees){return Math.min(fees.dividendMax,Math.max(fees.dividendMin,amount*fees.dividendRate));}
  function briefLinks(options){
    var links=[
      {label:'完整输入、压力测算与调整记录',url:options.researchUrl},
      {label:'计划与操作复盘',url:options.planUrl}
    ].filter(function(link){return sourceUrl(link.url);});
    return {
      text:links.map(function(link){return link.label+'：'+link.url;}),
      html:links.length?'<p>'+links.map(function(link){return '<a href="'+escape(link.url)+'">'+link.label+'</a>';}).join(' · ')+'</p>':''
    };
  }
  function portfolioMetrics(data){
    var p=data.portfolio||{},holdings=p.currentHoldingsVerified&&Array.isArray(p.holdings)?p.holdings:[],fees=p.fees||{};
    var cost=0,gross=0,collection=0,complete=holdings.length>0,feeKnown=[fees.monthly,fees.dividendMin,fees.dividendMax,fees.dividendRate].every(finite),rows=[];
    holdings.forEach(function(h){
      var c=(data.securities||[]).find(function(x){return x.symbol===h.symbol;}),inc=c&&c.decision&&c.decision.income||{},m=decisionMetrics(c,null);
      if(!finite(h.shares)||h.shares<=0||!finite(h.costPrice)||h.costPrice<0){complete=false;return;}
      cost+=h.shares*h.costPrice;
      var payments=inc.paymentsHKD,known=m.annual!==null&&!m.fxEstimated&&Array.isArray(payments)&&payments.length>0&&payments.every(function(x){return finite(x)&&x>=0;})&&Math.abs(payments.reduce(function(a,b){return a+b;},0)-m.annual)<0.00001;
      var income=known?m.annual*h.shares:null,charge=known&&feeKnown?payments.reduce(function(sum,x){return sum+dividendFee(h.shares*x,fees);},0):null;
      if(!known)complete=false;else gross+=income;if(charge!==null)collection+=charge;
      rows.push({symbol:h.symbol,shares:h.shares,cost:h.shares*h.costPrice,gross:income,afterCollection:income!==null&&charge!==null?income-charge:null});
    });
    return {rows:rows,cost:cost,budget:p.stockBudgetHKD,headroom:holdings.length&&finite(p.stockBudgetHKD)?p.stockBudgetHKD-cost:null,
      gross:complete?gross:null,collection:complete&&feeKnown?collection:null,monthlyYear:feeKnown?fees.monthly*12:null,
      afterFees:complete&&feeKnown?gross-collection-fees.monthly*12:null,complete:complete&&feeKnown};
  }
  function renderDecisionBrief(data,quotes,now,calendar,health,options,errors){
    options=options||{};
    var day=parts(now).day,prior=previousDay(day,calendar),fresh=errors.length===0,
      brief=data.briefing&&data.briefing.asOf===data.asOf?data.briefing:{},rows=[],focus=[],active=0;
    (fresh&&Array.isArray(brief.focus)?brief.focus:[]).slice(0,3).forEach(function(x){var t=shortText(x.text,80,null);if(t)focus.push({priority:x.kind==='risk'?0:4,text:t});});
    symbols.forEach(function(s){
      var c=(data.securities||[]).find(function(x){return x.symbol===s.symbol;})||{},d=c.decision&&c.decision.asOf===data.asOf?c.decision:{},b=c.brief&&c.brief.asOf===data.asOf?c.brief:{};
      var info=securityClose(s.symbol,quotes,options,day,prior,now,calendar);
      var blocked=(Array.isArray(options.disabledSymbols)?options.disabledSymbols:[]).some(function(x){return (typeof x==='string'?x:x&&x.symbol)===s.symbol;});
      var usable=info.usable&&!blocked,m=decisionMetrics({decision:d},info.price),inc=d.income||{},v=d.value||{},calc=v.kind==='ddm_check'?'旧分红折现假设未核定，已撤回价格结论':shortText(v.explanation,70,'缺少已核定输入，暂不报合理价');
      var income=m.annual===null?[shortText(inc.note,55,'分派依据待核')]:[m.fxEstimated?inc.currency+'普通息 '+dividendText(inc.annual)+'×'+inc.fxAssumption+'≈'+dividendText(m.annual):'普通年息 '+dividendText(m.annual),
        m.per10000===null?'现价息率待核':'历史参考 '+percent(m.yield)+'；每万元年息约'+Math.round(m.per10000)];
      var forward=d.forecastOrdinaryDividend;
      if(forward&&forward.kind==='research_scenario_not_declared'&&forward.currency==='HKD'&&finite(forward.base))income.push('研究年息 '+money(forward.base)+'（未宣派）');
      var valid=ruleValid(c.valuation,day)&&!blocked,upValid=ruleValid(c.upsideValuation,day)&&!blocked,points=[];
      if(valid)active++;
      if(valid){points.push('基准 '+money(c.valuation.fairValue.base)+'（'+money(c.valuation.fairValue.low)+'–'+money(c.valuation.fairValue.high)+'）');points.push('考虑价 '+money(c.valuation.first)+' / '+money(c.valuation.second));}
      if(upValid)points.push('上行复核 '+money(c.upsideValuation.first)+' / '+money(c.upsideValuation.second));
      if(usable&&valid){var target=info.price<=c.valuation.second?c.valuation.second:c.valuation.first,gap=(info.price-target)/target;
        if(gap<=0)focus.push({priority:2,text:shortName(s)+'已达基本面复核线'+money(target)+'；'+shortText(d.caveat,35,'复核估值依据和仓位')});
        else if(gap<=0.05)focus.push({priority:1,distance:gap,text:shortName(s)+'距基本面复核线'+money(target)+'还差'+percent(gap)});
      }
      if(usable&&upValid){var upTarget=info.price>=c.upsideValuation.second?c.upsideValuation.second:c.upsideValuation.first,upGap=(upTarget-info.price)/upTarget;
        if(upGap<=0)focus.push({priority:2,text:shortName(s)+'已达上行持仓复核线'+money(upTarget)+'；'+shortText(c.upsideValuation.action,42,'复核继续持有的预期回报')});
        else if(upGap<=0.05)focus.push({priority:1,distance:upGap,text:shortName(s)+'距上行持仓复核线'+money(upTarget)+'还差'+percent(upGap)});
      }
      if(blocked)income.push('风险复核中，触价暂停');
      var held=(data.portfolio&&data.portfolio.holdings||[]).some(function(h){return h.symbol===s.symbol;});
      rows.push({symbol:s.symbol,name:shortName(s),held:held,price:priceText(info.price),change:info.change===null?'涨跌待核':(info.change>0?'+':'')+percent(info.change),
        driver:shortText(d.driver,40,'经营与可分配现金待核'),calculation:calc,points:points,income:income,
        recent:shortText(b.recent,52,'近期情况待更新'),action:shortText(d.action,65,shortText(b.watch,40,'等待经营与现金流复核')),reason:info.reason||null});
    });
    focus.sort(function(a,b){return a.priority-b.priority||(a.distance||0)-(b.distance||0);});focus=focus.slice(0,3).map(function(x){return x.text;});
    if(!focus.length)focus=[fresh?'暂无可核实的接近项。':'当前仅列通过核验的资料，缺项待补。'];
    var p=portfolioMetrics(data),market=shortText(brief.market,80,'市场证据待更新'),change=shortText(brief.change,80,'判断变化待更新'),links=briefLinks(options);
    var profile=data.portfolio||{},budget=finite(p.budget)?'股票总预算 '+money(p.budget)+' 港元。':'股票预算待核。';
    var portfolio=budget+(p.rows.length?'已投入'+money(p.cost)+'，预算余量'+money(p.headroom)+'。':'持仓待核。')+
      (profile.cashVerified&&finite(profile.availableCash)?'可用现金 '+money(profile.availableCash)+' 港元。':'实际现金待对账。');
    var feeNote='按普通派息维持、全年持有测算，费用取自该组合提供的费率。';
    var totals=p.complete?'历史普通息维持：现有持仓年息约'+money(p.gross)+'，代收约'+money(p.collection)+'、月费全年'+money(p.monthlyYear)+'后约'+money(p.afterFees)+'。':'持仓股息合计所需数据尚不完整。';
    var incomeScenario=data.portfolio&&data.portfolio.forecastOrdinaryIncome,scenarioText=p.complete&&incomeScenario&&incomeScenario.kind==='research_scenario_run_rate_not_payment_calendar'&&finite(incomeScenario.base)?'研究年息情景 '+money(incomeScenario.base)+'（'+money(incomeScenario.low)+'–'+money(incomeScenario.high)+'），未宣派、未扣费税，非实际到账或付款排期；未投入资金未计。':null;
    var notice=fresh?'':'研究状态：资料未完成或已过期，仅列已核验的资料；无合格报价的项目显示“—”。';
    var goal=finite(p.budget)&&finite(profile.incomeTargetCentral)?'年度普通分红目标 '+money(p.budget*profile.incomeTargetCentral)+' 港元。':'';
    if(finite(p.budget)&&Array.isArray(profile.incomeStretchRange)&&profile.incomeStretchRange.length===2&&profile.incomeStretchRange.every(finite))
      goal+='进取目标 '+money(p.budget*profile.incomeStretchRange[0])+'–'+money(p.budget*profile.incomeStretchRange[1])+' 港元。';
    var note=goal+'实收与年化参考分开。每万元未按整手或扣税费。有效基本面价格提醒 '+active+'/'+symbols.length+'；未核定的估值不报接近买点。';
    var basis=day+' 09:30 · '+prior+'收盘参考 · 港元';
    var stamp=data.asOf&&!isNaN(Date.parse(data.asOf))?new Date(Date.parse(data.asOf)+8*3600000).toISOString().slice(0,16).replace('T',' ')+'（北京时间）':'待核实';
    var fault=health&&!/^(预览|行情已授权|行情按证券核验)/.test(health)?'行情状态异常：'+health+'；缺失或冲突报价不判断接近。':null;
    var textLines=['港股晨报｜'+basis,'资料截止 '+stamp,notice,'市场：'+market,'较上版：'+change,'',portfolio,totals,scenarioText,feeNote,'','先看这'+focus.length+'件事'];
    focus.forEach(function(x){textLines.push('• '+x);});
    textLines.push('','股票/昨收 | 估值逻辑与价位 | 分红参考 | 近期事实与建议');
    rows.forEach(function(r){textLines.push(r.name+' '+r.symbol.slice(3)+(r.held?'【持有】':'')+' '+r.price+' / '+r.change+' | '+r.driver+'；'+r.calculation+(r.points.length?'；'+r.points.join('；'):'')+' | '+r.income.join('；')+' | '+r.recent+'；'+r.action);});
    textLines=textLines.concat(['',note,fault],links.text);
    var esc=escape,muted=function(x){return '<span style="color:#64748b;font-size:12px">'+esc(x)+'</span>';},td=function(x){return '<td style="vertical-align:top;padding:10px 8px;border-bottom:1px solid #dce5eb;overflow-wrap:anywhere">'+x+'</td>';};
    var html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px 8px;background:#f3f6f8"><div style="max-width:980px;margin:auto;padding:20px 16px;background:white;font:14px/1.5 Arial,Microsoft YaHei,sans-serif;color:#172b3a"><h1 style="font-size:24px;margin:0 0 6px">港股晨报 · '+esc(day.slice(5))+'</h1><p>'+muted(basis+'；资料截止 '+stamp)+'</p>';
    if(notice||fault)html+='<p style="color:#985415">'+esc([notice,fault].filter(Boolean).join(' '))+'</p>';
    html+='<p><b>市场</b> '+esc(market)+'<br><b>较上版</b> '+esc(change)+'</p><div style="background:#edf4f7;padding:12px 14px"><b>你的股票账户</b><p style="margin:6px 0">'+esc(portfolio)+'<br>'+esc(totals)+'</p>';
    var holdingsHtml=p.rows.map(function(h){return '<tr><td>'+esc(shortName(symbols.find(function(s){return s.symbol===h.symbol;})))+'</td><td style="text-align:center">'+h.shares+'</td><td style="text-align:center">'+money(h.cost)+'</td><td style="text-align:center">'+money(h.gross)+' / '+money(h.afterCollection)+'</td></tr>';}).join('');
    if(!holdingsHtml)holdingsHtml='<tr><td>持仓待核验</td><td>待核验</td><td>待核验</td><td>待核验</td></tr>';
    html+='<table aria-label="已确认持仓收息测算" style="width:100%;font-size:12px;border-collapse:collapse"><tr><th style="text-align:left">持仓</th><th>股数</th><th>投入</th><th>年息/扣代收后</th></tr>'+holdingsHtml+'</table>';
    if(scenarioText)html+='<p style="margin:6px 0">'+esc(scenarioText)+'</p>';
    html+='<p style="margin:6px 0 0">'+muted(feeNote)+'</p></div><div style="padding:12px 0"><b>先看这'+focus.length+'件事</b>'+focus.map(function(x){return '<p style="margin:5px 0">• '+esc(x)+'</p>';}).join('')+'</div><table aria-label="16只证券决策表" style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px"><thead style="background:#edf4f7"><tr>'+['股票 / 昨收','估值逻辑与价位','分红参考','近期事实与建议'].map(function(t,i){return '<th scope="col" style="text-align:left;padding:10px 8px;width:'+([15,29,24,32][i])+'%">'+t+'</th>';}).join('')+'</tr></thead><tbody>';
    rows.forEach(function(r,i){html+='<tr'+(i%2?' style="background:#fafcfd"':'')+'>'+td('<b>'+esc(r.name)+'</b>'+ (r.held?' '+muted('持有'):'')+'<br>'+muted(r.symbol.slice(3))+'<br><b>'+esc(r.price)+'</b> '+muted(r.change)+(r.reason?'<br>'+muted(r.reason):''))+td(esc(r.driver)+'<br>'+muted(r.calculation)+(r.points.length?'<br><b>'+r.points.map(esc).join('<br>')+'</b>':''))+td(r.income.map(esc).join('<br>'))+td(esc(r.recent)+'<br><b>'+esc(r.action)+'</b>')+'</tr>';});
    html+='</tbody></table><p>'+muted(note)+'</p>'+links.html+'</div></body></html>';
    return {subject:day.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1年$2月$3日')+'港股晨报'+(fresh?'':'（研究待补）'),text:textLines.filter(function(x){return x!==null;}).join('\n'),html:html,researchFresh:fresh,errors:errors,format:'decision-v3'};
  }
  function verifiedSections(data,errors){
    // No section from a corrupt, stale or unverified snapshot is safe to quote.
    var badRows={},localOnly=errors.every(function(code){
      var m=/^(?:CARD_INVALID_|MISSING_|DUPLICATE_)(HK\.\d{5})$/.exec(code);
      if(m){badRows[m[1]]=true;return true;}
      return code==='NO_VERIFIED_PREVIOUS_CLOSE'||code==='HOLDINGS_INVALID'||code==='BRIEFING_INVALID'||code==='UNKNOWN_SYMBOL';
    });
    if(!localOnly)return {securities:[]};
    return {asOf:data.asOf,briefing:errors.indexOf('BRIEFING_INVALID')<0?data.briefing:null,
      portfolio:errors.indexOf('HOLDINGS_INVALID')<0?data.portfolio:null,
      securities:data.securities.filter(function(c){return record(c)&&symbols.some(function(s){return s.symbol===c.symbol;})&&!badRows[c.symbol];})};
  }
  function renderBrief(data,quotes,now,calendar,health,options) {
    options=options||{};
    var day=parts(now).day,errors=validateResearch(data,day,now,options);
    (Array.isArray(options.validationErrors)?options.validationErrors:[]).forEach(function(e){if(errors.indexOf(e)<0)errors.push(e);});
    if(errors.length)return renderDecisionBrief(verifiedSections(data,errors),quotes,now,calendar,health,options,errors);
    if(['decision-v2','decision-v3'].indexOf(data.briefing.format)>=0)return renderDecisionBrief(data,quotes,now,calendar,health,options,errors);
    var prior=previousDay(day,calendar),fresh=true;
    var brief=data&&data.briefing&&data.briefing.asOf===data.asOf?data.briefing:{},cards=data&&Array.isArray(data.securities)?data.securities:[],focus=[],rows=[],active=0;
    var market=shortText(brief.market,65,'市场简述待核实，详见研究记录。');
    var change=shortText(brief.change,55,'尚无可比较的昨日判断，详见研究记录。');
    (fresh&&Array.isArray(brief.focus)?brief.focus:[]).slice(0,3).forEach(function(x){
      var t=shortText(x&&x.text,60,null);if(t)focus.push({priority:x.kind==='risk'?0:3,text:t});});
    symbols.forEach(function(s){
      var c=cards.find(function(x){return x.symbol===s.symbol;})||{},b=c.brief&&c.brief.asOf===data.asOf?c.brief:{};
      var blocked=(Array.isArray(options.disabledSymbols)?options.disabledSymbols:[]).some(function(x){return (typeof x==='string'?x:x&&x.symbol)===s.symbol;});
      var info=securityClose(s.symbol,quotes,options,day,prior,now,calendar);
      var level=compactLevel(c,info.price,day,fresh&&info.usable&&!blocked,blocked);
      if(fresh&&!blocked&&ruleValid(c.valuation,day))active++;
      if(level.focus)focus.push({priority:level.focus.priority,text:shortName(s)+'：'+level.focus.text});
      var delta=info.change===null?'涨跌待核':(info.change>0?'+':'')+percent(info.change);
      rows.push({symbol:s.symbol,name:shortName(s),price:priceText(info.price),delta:delta,change:info.change,
        recent:shortText(b.recent,42,'近期情况待更新，详见研究记录'),
        watch:shortText(b.watch,32,'等待核实经营与现金流'),levels:level.lines,
        decision:['维持','上调','下调','首次','暂停','待核'].indexOf(b.decision)>=0?b.decision:'待核'});
    });
    focus.sort(function(a,b){return a.priority-b.priority;});focus=focus.slice(0,3).map(function(x){return x.text;});
    if(!focus.length)focus=[fresh?'今日暂无可核实的接近项，等待新证据。':'资料未更新，今日接近条件暂不判断。'];
    var stamp=data&&data.asOf&&!isNaN(Date.parse(data.asOf))?new Date(Date.parse(data.asOf)+8*3600000).toISOString().slice(0,16).replace('T',' '):'待核实';
    var basis='09:30 北京时间 · '+(prior||'待核实')+'收盘参考 · 港元';
    var notice=fresh?'':'研究状态：资料未完成或已过期，以下为旧记录。';
    var availability=rows.some(function(r){return r.price==='—';})?'无合格报价的项目显示“—”，不判断接近点位。':'';
    var links=briefLinks(options);
    var note='“研究/基准”尚未核定；“分派测算”不含完整资产价值；净值按标注日期。有效到价规则 '+active+'/16。';
    var lines=['港股晨报｜'+day,basis,'资料核验至 '+stamp];
    if(notice)lines.push(notice);if(availability)lines.push(availability);
    lines.push('市场：'+market,'较上版：'+change,'','先看这'+focus.length+'件事');
    focus.forEach(function(x){lines.push('• '+x);});
    lines.push('','股票 | 昨收/涨跌 | 近期情况 | 区间与点位 | 今天看什么');
    rows.forEach(function(r){lines.push(r.name+' '+r.symbol.slice(3)+' | '+r.price+' / '+r.delta+' | '+r.recent+' | '+r.levels.join('；')+' | '+r.decision+'：'+r.watch);});
    lines=lines.concat(['',note],links.text);
    var fault=health&&!/^(预览|行情已授权)/.test(health)?shortText(health,70,'行情状态异常，请核对富途。'):null;
    if(fault)lines.push('行情状态：'+fault);
    var th=function(t,w){return '<th scope="col" width="'+w+'%" style="padding:10px 8px;text-align:left;font-weight:600;border-bottom:2px solid #b6c9d5">'+t+'</th>';};
    var td=function(t){return '<td style="padding:10px 8px;vertical-align:top;border-bottom:1px solid #dce5eb;word-break:normal;overflow-wrap:anywhere">'+t+'</td>';};
    var muted=function(t){return '<span style="color:#64748b;font-size:12px">'+escape(t)+'</span>';};
    var html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px 8px;background:#f3f6f8"><div style="max-width:900px;margin:auto;padding:20px 16px;background:#fff;font-family:Arial,Microsoft YaHei,sans-serif;color:#172b3a;line-height:1.5">'+
      '<h1 style="margin:0 0 4px;font-size:24px">港股晨报 · '+escape(day.slice(5))+'</h1><p style="margin:0 0 16px;font-size:12px;color:#64748b">'+escape(basis)+'<br>资料核验至 '+escape(stamp)+'</p>';
    if(notice||availability)html+='<p style="font-size:13px;color:#985415">'+escape([notice,availability].filter(Boolean).join(' '))+'</p>';
    html+='<p style="margin:8px 0;font-size:14px"><b>市场</b> '+escape(market)+'<br><b>较上版</b> '+escape(change)+'</p>'+
      '<div style="background:#edf4f7;padding:12px 14px;margin:14px 0"><b style="font-size:14px">先看这'+focus.length+'件事</b>'+focus.map(function(x){return '<p style="margin:6px 0;font-size:13px">• '+escape(x)+'</p>';}).join('')+'</div>'+
      '<table aria-label="16只证券简报" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px"><thead style="background:#f3f6f8"><tr>'+th('股票',17)+th('昨收 / 涨跌',12)+th('近期情况',26)+th('区间与点位',23)+th('今天看什么',22)+'</tr></thead><tbody>';
    rows.forEach(function(r,i){html+='<tr'+(i%2?' style="background:#fafcfd"':'')+'>'+td('<b>'+escape(r.name)+'</b><br>'+muted(r.symbol.slice(3)))+
      td('<b>'+escape(r.price)+'</b><br>'+muted(r.delta))+td(escape(r.recent))+
      td(r.levels.map(function(t,j){return j?muted(t):escape(t);}).join('<br>'))+
      td('<span style="font-size:11px;color:#64748b">'+escape(r.decision)+'</span> '+escape(r.watch))+'</tr>';});
    html+='</tbody></table><p style="font-size:12px;color:#64748b;margin:14px 0 8px">'+escape(note)+'</p>'+links.html;
    if(fault)html+='<p style="font-size:12px;color:#985415">行情状态：'+escape(fault)+'</p>';
    html+='</div></body></html>';
    return {subject:day.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1年$2月$3日')+'港股晨报',text:lines.join('\n'),html:html,researchFresh:fresh,errors:errors,format:'compact-v1'};
  }
  function renderAlert(events) {
    var lines=['价格达到研究条件。请先核对下列经营与资金前提，再决定是否操作。'];
    events.forEach(function(e){lines.push('',e.symbol+'：'+money(e.price)+'港元；第'+e.level+'级线 '+money(e.threshold),
      '触发类型：'+({INITIAL_STATE:'初始状态',RULE_UPDATED:'规则更新',CROSSED:'价格穿越'}[e.reason]||e.reason),
      '报价时间：'+new Date(e.quoteTime+8*3600000).toISOString().replace('T',' ').replace('Z',' +08:00'),
      '普通股息率假设：'+percent(e.ordinaryYield)+'；估值版本：'+e.ruleVersion,
      '方向：'+(e.direction==='up'?'上涨至持仓复核价':'下跌至考虑买入的复核价'),
      '建议：'+(e.action||'结合最新研究复核'),
      '执行前提：'+(e.condition||'基本面未失效，现金、仓位及费用已核对'),
      '资金安排：'+(e.budgetNote||'以用户确认现金和整手为准；到价不代表自动交易'),
      e.kind==='income_watch'?'条件含义：假设普通派息维持（'+e.dividendPeriod+'），达到税费前收息门槛；不是公司合理价或买入指令。':'估值区间：'+money(e.fairValue.low)+'–'+money(e.fairValue.high),
      '依据：'+e.rationale,'失效条件：'+e.invalidation,'风险：'+(e.risk||'以最新研究卡为准'));
      if(e.exDividend)lines.push('今日除净：价格变化含机械除息影响，不能直接当作价值改善。');
      (e.sources||[]).forEach(function(u){lines.push(u);});});
    return {subject:parts(events[0].createdAt).day+' 港股到价提醒｜'+events.map(function(e){return e.symbol.slice(3);}).join('、'),text:lines.join('\n')};
  }
  return {version:VERSION,symbols:symbols,parts:parts,marketDay:marketDay,session:session,previousDay:previousDay,dueBrief:dueBrief,
    dgm:dgm,dcf:dcf,impliedGrowth:impliedGrowth,incomePrice:incomePrice,ruleValid:ruleValid,ruleBookValid:ruleBookValid,watchRule:watchRule,ruleLevels:ruleLevels,priceRuleId:priceRuleId,quoteOnlyScope:quoteOnlyScope,
    validateQuote:validateQuote,normalizeQuote:normalizeQuote,normalizeCloses:normalizeCloses,closingInfo:closingInfo,quoteHealth:quoteHealth,evaluate:evaluate,validateResearch:validateResearch,
    renderBrief:renderBrief,renderAlert:renderAlert,quoteClose:quoteClose,escape:escape,decisionMetrics:decisionMetrics,portfolioMetrics:portfolioMetrics};
})();
