/* Standalone public-source check. Never writes the investment research snapshot. */
var WarrenNews = (function () {
  'use strict';
  var minute=60000, hour=60*minute;
  var feeds=['披露易','金管局','03416分派','03417分派'];
  var hkex='https://www1.hkexnews.hk';
  function hkTime(ms){return new Date(ms+8*hour).toISOString().slice(0,16).replace('T',' ');}
  function getJson(url){
    var fund=url.indexOf('https://www.globalxetfs.com.hk/')===0;
    var response=UrlFetchApp.fetch(url,{muteHttpExceptions:true,headers:{Accept:fund?'text/html':'application/json','Cache-Control':'no-cache'}});
    if(response.getResponseCode()!==200)throw Error('HTTP '+response.getResponseCode());
    var content=response.getContentText('UTF-8').replace(/^\uFEFF/,'');
    return fund?content:JSON.parse(content);
  }
  function check(value,code){if(!value)throw Error(code);}
  function clean(value){return typeof value==='string'?value.trim():'';}
  function filingTime(value){
    var match=/^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)$/.exec(value);
    if(!match)return NaN;
    var local=match[3]+'-'+match[2]+'-'+match[1]+' '+match[4]+':'+match[5];
    var ms=Date.parse(local.replace(' ','T')+':00+08:00');
    return isFinite(ms)&&hkTime(ms)===local?ms:NaN;
  }
  function listings(from,until,now,fetch){
    var codes=WarrenCore.symbols.map(function(s){return s.symbol.slice(3);});
    var entries=[],seen={},page=1,last=1,oldest=Infinity,generation;
    do {
      var data=fetch(hkex+'/ncms/json/eds/lcisehk7relsdc_'+page+'.json');
      check(data&&Array.isArray(data.newsInfoLst)&&data.newsInfoLst.length,'EMPTY_LIST');
      last=Number(data.maxNumOfFile);
      check(Number.isInteger(last)&&last>=page,'INVALID_PAGINATION');
      var generated=Number(data.genDate);
      check(Number.isFinite(generated)&&generated>=from&&generated<=now+5*minute,'STALE_FEED');
      check(generation===undefined||generation===generated,'CHANGED_DURING_READ');
      generation=generated;
      data.newsInfoLst.forEach(function(row){
        var published=filingTime(row&&row.relTime);
        check(Number.isFinite(published)&&published<=oldest&&Array.isArray(row.stock),'INVALID_FILING');
        oldest=published;
        if(published<from||published>until)return;
        var watched=row.stock.map(function(s){return s&&s.sc;}).filter(function(code){return codes.indexOf(code)>=0;});
        if(!watched.length)return;
        check(clean(row.title)&&/^\/listedco\/listconews\/[A-Za-z0-9_./%-]+$/.test(row.webPath)&&row.webPath.indexOf('..')<0,'INVALID_FILING_LINK');
        if(!seen[row.webPath]){
          seen[row.webPath]=true;
          entries.push({title:clean(row.title),codes:watched,url:hkex+row.webPath,publishedAt:hkTime(published)});
        }
      });
      if(oldest<=from)break;
      if(page===last){check(until-from<7*24*hour,'INCOMPLETE_WINDOW');break;}
      check(++page<=18,'PAGINATION_LIMIT');
    }while(true);
    return {items:entries,feedGeneratedAt:hkTime(generation)};
  }
  function monetary(from,until,now,fetch){
    var data=fetch('https://api.hkma.gov.hk/public/press-releases?lang=sc&pagesize=100');
    var records=data&&data.result&&data.result.records;
    check(data&&data.header&&data.header.success===true&&Array.isArray(records)&&records.length,'EMPTY_LIST');
    var firstDay=hkTime(from).slice(0,10),lastDay=hkTime(until).slice(0,10);
    var reached=false,previous='9999-12-31',items=[];
    records.forEach(function(r){
      check(r&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.date<=previous&&clean(r.title)&&/^https:\/\/www\.hkma\.gov\.hk\/[A-Za-z0-9/_%.?=&-]+$/.test(r.link),'INVALID_RELEASE');
      previous=r.date;
      if(r.date<firstDay){reached=true;return;}
      // Date-only releases found after cutoff cannot be placed in this morning's snapshot.
      if(r.date>lastDay||(r.date===lastDay&&now>until))return;
      items.push({title:clean(r.title),url:r.link,publishedAt:r.date});
    });
    check(reached||records.length<100,'INCOMPLETE_WINDOW');
    return {items:items};
  }
  function distribution(code,slug){
    return function(from,until,now,fetch){
      var page=fetch('https://www.globalxetfs.com.hk/cn/funds/'+slug+'/');
      var anchor=/<a\b[^>]*\bhref=["'](https:\/\/investments\.miraeasset\.com\.hk\/docs\/notices\/[^"'< >]+\.pdf)["'][^>]*>\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*[-–－]\s*([^<>]*分派公告[^<>]*)<\/a>/gi;
      var match,found=false,items=[],seen={};
      while((match=anchor.exec(page))!==null){
        if(match[1].split('/').pop().indexOf(code.slice(1))<0)continue;
        found=true;
        var day=match[2]+'-'+('0'+match[3]).slice(-2)+'-'+('0'+match[4]).slice(-2);
        if(day<hkTime(from).slice(0,10)||day>hkTime(until).slice(0,10)||(day===hkTime(until).slice(0,10)&&now>until)||seen[match[1]])continue;
        seen[match[1]]=true;
        items.push({title:clean(match[5]),url:match[1],publishedAt:day});
      }
      check(found,'FUND_DISCLOSURES_UNREADABLE');
      return {items:items};
    };
  }
  function collect(now,calendar,fetch,clock){
    fetch=fetch||getJson;
    var day=WarrenCore.parts(now).day,prior=WarrenCore.previousDay(day,calendar);
    check(prior,'UNKNOWN_CALENDAR');
    var from=Date.parse(prior+'T09:15:00+08:00'),until=Math.min(now,Date.parse(day+'T09:15:00+08:00'));
    var readers=[listings,monetary,distribution('03416','hscei-covered-call-etf'),distribution('03417','hang-seng-tech-covered-call-active-etf')];
    var hardCutoff=Date.parse(day+'T09:15:00+08:00');
    var sources=readers.map(function(reader,index){
      try{
        var s=reader(from,until,now,fetch),end=clock?clock():now;
        if(index>0&&end>hardCutoff)s.items=s.items.filter(function(item){return item.publishedAt!==day;});
        s.ok=true;s.name=feeds[index];s.checkedAt=new Date(end).toISOString();return s;
      }catch(e){return {ok:false,name:feeds[index],items:[],error:String(e.message||'READ_FAILED').slice(0,100),checkedAt:new Date(clock?clock():now).toISOString()};}
    });
    return {day:day,checkedAt:new Date(now).toISOString(),cutoff:new Date(until).toISOString(),from:new Date(from).toISOString(),sources:sources};
  }
  function key(day){return day+'-morning-sources.json';}
  function refresh(now,calendar,read,write){
    var p=WarrenCore.parts(now);
    if(p.minute<520||p.minute>600)return;
    var old;
    try{old=read(key(p.day),null);}catch(e){old=null;}
    var last=old&&Date.parse(old.checkedAt);
    var cutoff=Date.parse(p.day+'T09:15:00+08:00');
    var usable=old&&old.day===p.day&&Array.isArray(old.sources)&&old.sources.length===feeds.length&&old.sources.every(function(s,i){
      return s&&s.name===feeds[i]&&Array.isArray(s.items)&&s.items.every(function(item){return item&&typeof item.title==='string';})&&
        isFinite(Date.parse(s.checkedAt))&&WarrenCore.parts(Date.parse(s.checkedAt)).day===p.day;
    });
    if(usable&&last<=now&&((last>=cutoff&&old.sources.every(function(s){return s.ok&&!s.lastFailureAt;}))||
       (now-last<5*minute&&!(last<cutoff&&now>=cutoff))))return;
    var snapshot=collect(now,calendar,getJson,Date.now);
    snapshot.sources=snapshot.sources.map(function(s,i){
      var earlier=usable&&old.sources[i];
      if(!s.ok&&earlier&&earlier.name===s.name&&earlier.ok&&Date.parse(earlier.checkedAt)<=now){
        return Object.assign({},earlier,{lastFailureAt:s.checkedAt,error:s.error});
      }
      // Keep today's date-only releases actually seen before cutoff.
      if(i>0&&s.ok&&earlier&&earlier.ok){
        earlier.items.filter(function(r){return r.publishedAt===p.day;}).forEach(function(r){
          if(!s.items.some(function(x){return x.url===r.url;}))s.items.push(r);
        });
      }
      return s;
    });
    write(key(p.day),snapshot);
  }
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function attach(report,now,read){
    var day=WarrenCore.parts(now).day,snapshot;
    try{snapshot=read(key(day),null);}catch(e){snapshot=null;}
    var lines=[],html=[];
    if(snapshot&&snapshot.day===day&&Date.parse(snapshot.checkedAt)<=now&&Number.isFinite(Date.parse(snapshot.from))&&
       Date.parse(snapshot.from)<Date.parse(snapshot.cutoff)&&Date.parse(snapshot.cutoff)<=Math.min(now,Date.parse(day+'T09:15:00+08:00'))&&Array.isArray(snapshot.sources)){
      feeds.forEach(function(name,i){
        var s=snapshot.sources[i];
        if(!s||s.name!==name||!s.ok||!Array.isArray(s.items)||!isFinite(Date.parse(s.checkedAt))||WarrenCore.parts(Date.parse(s.checkedAt)).day!==day||Date.parse(s.checkedAt)>now){
          lines.push(name+'未完成核验');html.push(esc(lines[lines.length-1]));return;
        }
        var priorDate=String(snapshot.from||'').slice(0,10),until=Date.parse(snapshot.cutoff);
        var items=s.items.filter(function(item){return item&&clean(item.title)&&typeof item.publishedAt==='string'&&
          (i===0?/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(item.publishedAt)&&item.publishedAt>=hkTime(Date.parse(snapshot.from))&&item.publishedAt<=hkTime(until):
            /^\d{4}-\d\d-\d\d$/.test(item.publishedAt)&&item.publishedAt>=priorDate&&item.publishedAt<=day)&&
          (i===0?/^https:\/\/www1\.hkexnews\.hk\/listedco\/listconews\//:i===1?/^https:\/\/www\.hkma\.gov\.hk\//:/^https:\/\/investments\.miraeasset\.com\.hk\/docs\/notices\//).test(item.url);});
        var head=name+' '+hkTime(Date.parse(s.checkedAt)).slice(11)+'核验'+(s.lastFailureAt?'（后续重查失败）':'');
        if(i===1)head+='，按公布日期检索';
        if(!items.length){head+=s.items.length?'，条目未通过校验':'，所查窗口未见相关公告';lines.push(head);html.push(esc(head));return;}
        var material=/分派|分配|股息|業績|盈利|須予公布|關連交易|主要交易|收購|出售|利率|流动性|基准债券/;
        items.sort(function(a,b){return Number(material.test(b.title))-Number(material.test(a.title))||b.publishedAt.localeCompare(a.publishedAt);});
        var top=items[0],title=(Array.isArray(top.codes)?top.codes.join('/')+' ':'')+top.title,phrase=head+'，'+items.length+'条，'+top.publishedAt+' ';
        lines.push(phrase+title+' '+top.url);html.push(esc(phrase)+'<a href="'+esc(top.url)+'">'+esc(title)+'</a>');
      });
    }else{lines.push('盘前官方资讯未完成核验');html.push(esc(lines[0]));}
    var asText='官方资讯｜'+lines.join('。'),asHtml='<br><b>官方资讯</b> '+html.join('。');
    if(report.text.indexOf('\n较上版：')>=0)report.text=report.text.replace('\n较上版：',function(){return '\n'+asText+'\n较上版：';});else report.text+='\n'+asText;
    if(report.html.indexOf('<br><b>较上版</b>')>=0)report.html=report.html.replace('<br><b>较上版</b>',function(m){return asHtml+m;});
    else if(report.html.indexOf('</body>')>=0)report.html=report.html.replace('</body>',function(){return '<p>'+asHtml.slice(4)+'</p></body>';});
    else report.html='<p>'+asHtml.slice(4)+'</p>'+report.html;
    return report;
  }
  return {collect:collect,refresh:refresh,attach:attach};
})();
