'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCloud} = require('../tools/load-cloud.cjs');
const crypto = require('node:crypto');
const {symbols} = require('../tools/evening-asset-audit.cjs');
const folderId = 'example-research-folder';
const inputName = day => day + '-evening-asset-input.json';
const learningName = day => day + '-evening-learning-input.json';
const reportName = day => day + '-evening-asset-audit.json';
const day = '2026-11-18';

function eveningCloud() {
  const files = [], properties = new Map([['WARREN_ROOT',JSON.stringify(folderId)],['WARREN_OWNER_EMAIL','owner@example.org'],['WARREN_RECIPIENT_EMAIL','alerts@example.org']]), handlers = ['otherJob','warrenTick'], sent = [];
  const hooks = {afterList:null, failPointerSave:false, busy:false, failMail:false, lockHeld:false};
  let time = Date.parse(day+'T22:20:00+08:00');
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  function add(name, body) {
    const file = {id:String(files.length+1),name,raw:body,trash:false,
      getId(){return this.id;},getName(){return this.name;},isTrashed(){return this.trash;},getBlob(){return {getDataAsString:()=>this.raw};}};
    files.push(file);
    return file;
  }
  const folder = {getFilesByName(name) {
    if (hooks.afterList) hooks.afterList(name);
    const list=files.filter(f=>!f.trash&&f.name===name);
    return {hasNext:()=>list.length>0,next:()=>list.shift()};
  },searchFiles(query) {
    assert.equal(query,"trashed = false and title contains '-evening-asset-audit.json'");
    const list=files.filter(f=>!f.trash&&f.name.includes('-evening-asset-audit.json'));
    return {hasNext:()=>list.length>0,next:()=>list.shift()};
  },createFile:add};
  const props = {getProperty:key=>properties.get(key)??null,setProperty(key,value) {
    if (hooks.failPointerSave && key==='WARREN_EVENING_ARCHIVE_V1') {
      hooks.failPointerSave=false;
      throw Error('temporary property failure');
    }
    properties.set(key,value);
  }};
  const context = loadCloud(['WarrenConfig','WarrenEveningCore','WarrenEveningApp'], {
    Date:ClockDate,console,Session:{getEffectiveUser:()=>({getEmail:()=> 'owner@example.org'})}, DriveApp:{getFolderById(id){assert.equal(id,folderId);return folder;},getFileById:id=>{
      const file=files.find(f=>f.id===id);if(!file)throw Error('file unavailable');return file;}},
    LockService:{getScriptLock:()=>({tryLock:()=>!hooks.busy&&!hooks.lockHeld&&(hooks.lockHeld=true),releaseLock:()=>{hooks.lockHeld=false;}})},
    PropertiesService:{getScriptProperties:()=>props},
    MailApp:{sendEmail(...args){sent.push(args);if(hooks.failMail)throw Error('ambiguous send');}},
    WarrenLearning:{evaluate:(input,report,previous,packet)=>({fixture:'verified learning',summary:{},
      receivedDcf:packet.securities.filter(item=>item.dcf).map(item=>item.symbol)})},
    ScriptApp:{getProjectTriggers:()=>handlers.map(h=>({getHandlerFunction:()=>h})),
      newTrigger(handler){return {timeBased(){return this;},everyMinutes(n){assert.equal(n,30);return this;},create(){handlers.push(handler);}};}},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(algorithm,raw,encoding)=>Array.from(crypto.createHash(algorithm).update(raw,encoding).digest()),
      formatDate(date,zone,format) {assert.equal(zone,'Asia/Hong_Kong');const local=new Date(date.getTime()+8*3600000).toISOString();
        return format==='yyyy-MM-dd'?local.slice(0,10):local.slice(11,16).replace(':','');}}
  });
  const app=context.WarrenEveningApp;
  function input(d=day, changes={}) {
    return {date:d,asOf:d+'T21:45:00+08:00',securities:symbols.map(symbol=>({symbol,name:symbol,method:'reported cash sources',
      checks:[],gaps:['awaiting next cash statement'],next:'next reporting period',
      sourceChecks:[{source:'https://example.org/filings',checkedAt:d+'T21:40:00+08:00',outcome:'no_change',detail:'Filing index checked.'}]})),...changes};
  }
  function putLearning(d) {
    return files.find(f=>!f.trash&&f.name===learningName(d)) ||
      add(learningName(d),JSON.stringify({date:d,asOf:d+'T21:45:00+08:00',securities:[]}));
  }
  function put(d) {putLearning(d);return add(inputName(d),JSON.stringify(input(d)));}
  return {app,files,hooks,properties,sent,handlers,add,input,put,putLearning,
    clock(when){time=Date.parse(when);return app.clock(new ClockDate());}};
}
test('nightly installation coexists with other scheduled jobs, stays single across retries',()=>{
  const c=eveningCloud();
  assert.equal(c.app.install().triggers,1);assert.equal(c.app.install().triggers,1);
  assert.deepEqual(c.handlers,['otherJob','warrenTick','warrenEveningClock']);
  c.handlers.push('warrenEveningClock');assert.throws(()=>c.app.install(),/MULTIPLE_EVENING_TRIGGERS/);
  assert.equal(c.sent.length,0);
});
test('cloud clock respects HK evening and midnight, deduplicates gap notifications and recovers a late input',()=>{
  const c=eveningCloud();
  assert.equal(c.clock(day+'T21:29:00+08:00').status,'outside_evening_window');
  assert.equal(c.clock(day+'T22:00:00+08:00').error,'INPUT_MISSING');
  assert.equal(c.sent.length,0);
  assert.equal(c.clock(day+'T23:30:00+08:00').status,'pending');
  assert.equal(c.clock('2026-11-19T00:30:00+08:00').date,day);
  assert.equal(c.sent.length,1);
  c.put(day);
  const sealed=c.clock('2026-11-19T01:00:00+08:00');
  assert.equal(sealed.status,'sealed');
  assert.equal(c.clock('2026-11-19T02:00:00+08:00').reportId,sealed.reportId);
  assert.equal(c.files.filter(f=>f.name===reportName(day)).length,1);
  assert.equal(c.sent.length,1);
});
test('missing recipient prevents evening installation and missing-data emails without marking them delivered',()=>{
 const c=eveningCloud();
 c.properties.delete('WARREN_RECIPIENT_EMAIL');
 assert.throws(()=>c.app.install(),/WARREN_RECIPIENT_EMAIL_REQUIRED/);
 const waiting=c.clock(day+'T23:30:00+08:00');
 assert.match(waiting.notificationError,/WARREN_RECIPIENT_EMAIL_REQUIRED/);
 assert.equal(c.properties.has('WARREN_EVENING_LAST_NOTICE'),false);
 assert.equal(c.sent.length,0);
});
test('zero direct sources cannot be sealed, a partial set is preserved as gaps and a retry can recover',()=>{
  const c=eveningCloud(),d=c.input();
  c.putLearning(day);
  for(const s of d.securities) s.sourceChecks[0].outcome='unavailable';
  const f=c.add(inputName(day),JSON.stringify(d));
  const pending=c.clock(day+'T23:31:00+08:00');
  assert.match(pending.error,/NO_VALID_SOURCE_CHECKS/);assert.equal(c.app.status().archive,null);
  assert.equal(c.sent.length,1);
  d.securities[0].sourceChecks[0].outcome='no_change';f.raw=JSON.stringify(d);
  const sealed=c.clock(day+'T23:45:00+08:00');assert.equal(sealed.status,'sealed');
  assert.equal(sealed.summary.securitiesWithSuccessfulSourceChecks,1);
  assert.equal(sealed.summary.securitiesWithSourceFailures,15);
});
test('rejects a wrong date, future completion, duplicate input or duplicate archive without replacing files',()=>{
  const c=eveningCloud(), bad=c.add(inputName(day),JSON.stringify(c.input('2026-11-17')));
  assert.match(c.app.runNow().error,/WRONG_DATE_OR_FUTURE_INPUT/);
  bad.raw=JSON.stringify(c.input(day,{asOf:day+'T23:50:00+08:00'}));
  assert.match(c.app.runNow().error,/WRONG_DATE_OR_FUTURE_INPUT/);
  bad.raw=JSON.stringify(c.input());const dupe=c.put(day);
  assert.match(c.app.runNow().error,/DUPLICATE_FILE/);dupe.trash=true;
  const unrelated=c.add(reportName(day),'other file contents');
  assert.match(c.app.runNow().error,/ARCHIVE_NAME_CONFLICT/);
  assert.equal(unrelated.raw,'other file contents');assert.equal(c.app.status().archive,null);
});
test('an input ID replaced between checks, including identical bytes, does not produce a sealed night',()=>{
  const c=eveningCloud(), old=c.put(day);
  let reads=0;
  c.hooks.afterList=name=>{
    if(name===inputName(day)&&++reads===2) {old.trash=true;c.add(name,old.raw);}
  };
  assert.match(c.app.runNow().error,/INPUT_CHANGED_DURING_AUDIT/);
  assert.equal(c.app.status().archive,null);
  assert.equal(c.files.filter(f=>f.name===reportName(day)).length,0);
});
test('learning input must be available, unchanged and attributed by ID and digest in the sealed two-input report',()=>{
  const c=eveningCloud();
  c.add(inputName(day),JSON.stringify(c.input()));
  assert.equal(c.app.runNow().status,'pending');assert.equal(c.app.status().archive,null);
  const first=c.putLearning(day);
  let reads=0;
  c.hooks.afterList=name=>{
    if(name===learningName(day)&&++reads===2){first.trash=true;c.add(name,first.raw);}
  };
  assert.equal(c.app.runNow().status,'pending');assert.equal(c.app.status().archive,null);
  assert.equal(c.files.filter(f=>f.name===reportName(day)).length,0);
  c.hooks.afterList=null;
  const current=c.putLearning(day), done=c.app.runNow();assert.equal(done.status,'sealed');
  const stored=JSON.parse(c.files.find(f=>f.id===done.reportId).raw);
  assert.equal(stored.learning.fixture,'verified learning');
  assert.equal(stored.receipt.learningInputId,current.id);
  assert.equal(stored.receipt.learningDigest,crypto.createHash('sha256').update(current.raw).digest('hex'));
  current.raw+=' ';
  assert.equal(c.app.runNow().status,'pending');
});
test('a report created before a transient pointer failure is reused by the next tick',()=>{
  const c=eveningCloud();c.put(day);c.hooks.failPointerSave=true;
  assert.equal(c.app.runNow().status,'pending');assert.equal(c.app.status().archive,null);
  const recovered=c.app.runNow();assert.equal(recovered.status,'sealed');
  assert.equal(c.files.filter(f=>f.name===reportName(day)).length,1);
  assert.equal(c.app.status().archive.id,recovered.reportId);
});
test('changed sealed input, edited archive or trashed archive cannot enter the next forecast ledger',()=>{
  const c=eveningCloud(), inp=c.put(day), original=inp.raw, first=c.app.runNow();
  const record=c.files.find(f=>f.id===first.reportId), originalReport=record.raw;
  inp.raw=original+' ';assert.match(c.app.runNow().error,/SEALED_INPUT_CHANGED/);
  inp.raw=original;record.raw=originalReport+' ';assert.match(c.app.runNow().error,/ARCHIVE_CHANGED/);
  c.put('2026-11-19');
  assert.match(c.clock('2026-11-19T22:00:00+08:00').error,/ARCHIVE_CHANGED/);
  record.raw=originalReport;record.trash=true;
  assert.match(c.app.runNow().error,/ARCHIVE_TRASHED/);
  record.trash=false;const second=c.app.runNow();
  assert.equal(second.status,'sealed');
  const verified=JSON.parse(c.files.find(f=>f.id===second.reportId).raw);
  assert.equal(verified.receipt.previousId,first.reportId);
  assert.equal(verified.previousDate,day);
});
test('a busy lock causes no mutation and an ambiguous email failure never blindly sends twice',()=>{
  const c=eveningCloud(),originalProperties=Array.from(c.properties);c.hooks.busy=true;
  assert.equal(c.clock(day+'T23:30:00+08:00').status,'busy');
  assert.deepEqual(Array.from(c.properties),originalProperties);assert.equal(c.sent.length,0);
  c.hooks.busy=false;c.hooks.failMail=true;
  assert.match(c.clock(day+'T23:30:30+08:00').notificationError,/ambiguous/);
  c.hooks.failMail=false;c.clock(day+'T23:45:00+08:00');assert.equal(c.sent.length,1);
});
test('losing the stored archive pointer cannot reset the forecast ledger as a fresh first night',()=>{
  const c=eveningCloud();c.put(day);assert.equal(c.app.runNow().status,'sealed');
  c.properties.delete('WARREN_EVENING_ARCHIVE_V1');
  c.put('2026-11-19');
  const blocked=c.clock('2026-11-19T22:00:00+08:00');
  assert.match(blocked.error,/MISSING_ARCHIVE_POINTER/);
  assert.equal(c.app.status().archive,null);
  assert.equal(c.files.filter(f=>f.name===reportName('2026-11-19')).length,0);
});
test('each reverse-valuation input independently matches the dated, final, unadjusted HKD broker close',()=>{
  const validSymbol='HK.06823', disputed='HK.00220', price=8.51;
  const observed=Date.parse(day+'T17:30:00+08:00');
  function bar(symbol,value) {
    return {symbol,date:day,price:value,final:true,autype:0,source:'Futu日K（不复权）',fetchedAt:observed};
  }
  for (const [label,override,currency] of [
    ['matching bar',{},'HKD'], ['wrong symbol',{symbol:'HK.00288'},'HKD'], ['prior date',{date:'2026-11-17'},'HKD'],
    ['different close',{price:8.50},'HKD'], ['adjusted',{autype:1},'HKD'], ['unconfirmed',{final:false},'HKD'],
    ['wrong currency',{},'CNY'], ['unverified origin',{source:'manual spreadsheet'},'HKD'],
    ['nonpositive close',{price:0},'HKD']
  ]) {
    const c=eveningCloud();c.put(day);
    const packet=c.putLearning(day),p=JSON.parse(packet.raw);
    p.securities=[{symbol:validSymbol,dcf:{price:12.52,priceDate:day,currency:'HKD'}},
      {symbol:disputed,dcf:{price:label==='nonpositive close'?0:price,priceDate:day,currency}}];packet.raw=JSON.stringify(p);
    const snapshot={date:day,autype:0,complete:true,fetchedAt:observed,quotes:{
      [validSymbol]:bar(validSymbol,12.52),[disputed]:{...bar(disputed,price),...override}
    }};
    const official=c.add(day+'-close-data.json',JSON.stringify(snapshot));
    const sealed=c.app.runNow();assert.equal(sealed.status,'sealed',label);
    const result=JSON.parse(c.files.find(f=>f.id===sealed.reportId).raw);
    const shouldMatch=label==='matching bar';
    assert.equal(result.summary.securitiesWithSuccessfulSourceChecks,16,label);
    assert.deepEqual(result.learning.receivedDcf,shouldMatch?[validSymbol,disputed]:[validSymbol],label);
    assert(result.learning.closingChecks.every(x=>x.fileId===official.id&&x.date===day),label);
    assert.equal(result.learning.closingChecks.find(x=>x.symbol===disputed).matched,shouldMatch,label);
  }
});
test('a broker close retrieved after the study cutoff cannot be used as contemporaneous evidence',()=>{
  const c=eveningCloud();c.put(day);
  const packet=c.putLearning(day),p=JSON.parse(packet.raw),symbol='HK.06823';
  p.securities=[{symbol,dcf:{price:12.52,priceDate:day,currency:'HKD'}}];packet.raw=JSON.stringify(p);
  const late=Date.parse(p.asOf)+1;
  c.add(day+'-close-data.json',JSON.stringify({date:day,autype:0,fetchedAt:late,quotes:{[symbol]:{symbol,date:day,
    final:true,autype:0,source:'Futu日K（不复权）',fetchedAt:late,price:12.52}}}));
  const sealed=c.app.runNow();assert.equal(sealed.status,'sealed');
  const result=JSON.parse(c.files.find(f=>f.id===sealed.reportId).raw);
  assert.equal(result.learning.closingChecks[0].matched,false);
  assert.deepEqual(result.learning.receivedDcf,[]);
  assert.equal(result.summary.securitiesWithSuccessfulSourceChecks,16);
});
test('missing or ambiguous closing archives only withhold price-based learning and leave operations intact',()=>{
  for(const duplicate of [false,true]) {
    const c=eveningCloud();c.put(day);
    const packet=c.putLearning(day),p=JSON.parse(packet.raw);
    p.securities=[{symbol:'HK.06823',dcf:{price:12.52,priceDate:day,currency:'HKD'}}];packet.raw=JSON.stringify(p);
    if(duplicate) {
      c.add(day+'-close-data.json','{}');c.add(day+'-close-data.json','{}');
    }
    const sealed=c.app.runNow();assert.equal(sealed.status,'sealed');
    const result=JSON.parse(c.files.find(f=>f.id===sealed.reportId).raw);
    assert.deepEqual(result.learning.receivedDcf,[]);
    assert.equal(result.learning.closingChecks[0].matched,false);
    assert.match(result.learning.closingChecks[0].reason,duplicate?/DUPLICATE_FILE/:/ARCHIVE_MISSING/);
    assert.equal(result.summary.securitiesWithSuccessfulSourceChecks,16);
    assert.equal(c.sent.length,0);
  }
});
