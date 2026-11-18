const {test}=require('node:test');
const {actionResearch}=require('./fixtures/research.cjs');
const assert=require('node:assert/strict');
const {loadCloud}=require('../tools/load-cloud.cjs');
const crypto=require('node:crypto');

function cloud(options={}) {
 const props=new Map([['OTHER_SENTINEL','unchanged'],['WARREN_OWNER_EMAIL','owner@example.org'],['WARREN_RECIPIENT_EMAIL','alerts@example.org']]), files=new Map(), drafts=new Map(), sent=[];
 const triggers=[{getHandlerFunction:()=> 'otherJob'}]; let serial=0;
 function makeFile(name,text){const id='file-'+(++serial);const f={getId:()=>id,getName:()=>name,setContent:v=>{text=v;},getBlob:()=>({getDataAsString:()=>text})};files.set(name,f);return f;}
 const folder={getId:()=> 'warren-folder',getFilesByName:n=>{let remaining=files.has(n)?(options.duplicateName===n?2:1):0;return {hasNext:()=>remaining>0,next:()=>{remaining--;return files.get(n);}};},createFile:makeFile};
 const services={
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.has(k)?props.get(k):null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
  Session:{getEffectiveUser:()=>({getEmail:()=>options.owner||'owner@example.org'})},
  DriveApp:{createFolder:()=>folder,getFolderById:()=>folder,getFileById:id=>{const f=[...files.values()].find(f=>f.getId()===id);if(!f)throw Error('DRIVE_NOT_FOUND');return f;}},
  Utilities:{newBlob:s=>({getBytes:()=>Buffer.from(s)}),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(a,s)=>[...crypto.createHash(a).update(s).digest()],getUuid:()=>crypto.randomUUID()},
  ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased:()=>({everyMinutes:()=>({create:()=>triggers.push({getHandlerFunction:()=>handler})})})}),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1)},
  MailApp:{getRemainingDailyQuota:()=>options.quota??100},
  GmailApp:{createDraft:(recipient,subject,text)=>{if(options.failDraft)throw Error('temporary');const id='draft-'+(++serial),d={getId:()=>id,send:()=>{if(options.failSend)throw Error('unknown');sent.push({recipient,subject,text,at:options.now||Date.now()});return {getId:()=> 'sent-'+sent.length};}};drafts.set(id,d);return d;},getDraft:id=>drafts.get(id)||null,search:()=>sent.map((m,i)=>({getMessages:()=>[{getSubject:()=>m.subject,getPlainBody:()=>m.text,getDate:()=>new Date(m.at),getTo:()=>m.recipient,getId:()=>'sent-'+(i+1)}]}))},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  console:{log:()=>{}}
 };
 if(options.fetch)services.UrlFetchApp={fetch:(url,opt)=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(options.fetch(url,opt))})};
 if(options.now)services.Date=class extends Date {constructor(...args){super(...(args.length?args:[options.now]));}static now(){return options.now;}};
 const context=loadCloud(['WarrenConfig','WarrenCore','WarrenNews','WarrenApp'], services);
 return {app:context.WarrenApp,core:context.WarrenCore,props,files,sent,triggers,options,write:(n,v)=>files.has(n)?files.get(n).setContent(JSON.stringify(v)):makeFile(n,JSON.stringify(v)),read:n=>JSON.parse(files.get(n).getBlob().getDataAsString())};
}
test('initialization is additive and keeps unrelated properties and triggers',()=>{const c=cloud();c.app.initialize();assert.equal(c.props.get('OTHER_SENTINEL'),'unchanged');assert.equal(c.triggers.length,1);assert.equal(c.read('research.json').status,'research_pending');assert.equal(c.app.status().enabled,false);});
test('setup email has one durable send across repeated calls',()=>{const c=cloud();assert.equal(c.app.testMail().status,'sent');assert.equal(c.app.testMail().status,'sent');assert.equal(c.sent.length,1);assert.equal(c.sent[0].recipient,'alerts@example.org');});
test('sending quota reserve leaves the message pending',()=>{const c=cloud({quota:20});assert.equal(c.app.testMail().status,'pending');assert.equal(c.sent.length,0);assert.equal(c.app.status().outbox.length,1);});
test('changing the delivery address requires a new setup confirmation and discards pending tests for the old address',()=>{
 const c=cloud();c.app.testMail();
 c.props.set('WARREN_RECIPIENT_EMAIL','new@example.org');
 assert.throws(()=>c.app.start(),/WARREN_VERIFY_MAIL_FIRST/);
 c.options.quota=20;assert.equal(c.app.testMail().status,'pending');
 const [key]=c.app.status().outbox;
 c.props.set('WARREN_RECIPIENT_EMAIL','final@example.org');c.options.quota=100;
 assert.equal(c.app.testMail().status,'sent');c.app.start();
 assert.equal(c.read('mail-'+key+'.json').status,'expired');
 assert.deepEqual(c.sent.map(m=>m.recipient),['alerts@example.org','final@example.org']);
});
test('a temporary draft failure can recover without losing mail',()=>{const c=cloud({failDraft:true});assert.equal(c.app.testMail().status,'pending');c.options.failDraft=false;assert.equal(c.app.testMail().status,'sent');assert.equal(c.sent.length,1);});
test('ambiguous mail acceptance is not retried blindly',()=>{const c=cloud({failSend:true});assert.equal(c.app.testMail().status,'sending');c.options.failSend=false;assert.equal(c.app.testMail().status,'delivery_uncertain');assert.equal(c.sent.length,0);});
test('outbox index lost after persisting a message is repaired',()=>{const c=cloud({quota:20});c.app.testMail();c.props.set('WARREN_OUTBOX','[]');c.options.quota=100;assert.equal(c.app.testMail().status,'sent');assert.equal(c.sent.length,1);});
test('start and stop only manage Warren trigger, with duplicate prevention',()=>{const c=cloud();c.app.testMail();c.app.start();c.app.start();assert.equal(c.triggers.length,2);assert.equal(c.app.status().triggerCount,1);c.app.stop();assert.equal(c.triggers.length,1);assert.equal(c.triggers[0].getHandlerFunction(),'otherJob');});
test('cloud scheduling requires a real accepted mail test',()=>{const c=cloud({quota:20});c.app.testMail();assert.throws(()=>c.app.start(),/WARREN_VERIFY_MAIL_FIRST/);});
test('different effective account cannot initialize or send',()=>{const c=cloud({owner:'other@example.com'});assert.throws(()=>c.app.testMail(),/WARREN_WRONG_ACCOUNT/);assert.equal(c.sent.length,0);});
test('a new installation requires an explicit owner and one recipient before creating files or mail',()=>{
 const c=cloud();
 c.props.delete('WARREN_OWNER_EMAIL');
 assert.throws(()=>c.app.testMail(),/WARREN_OWNER_EMAIL_REQUIRED/);
 c.props.set('WARREN_OWNER_EMAIL','owner@example.org');
 c.props.delete('WARREN_RECIPIENT_EMAIL');
 assert.throws(()=>c.app.initialize(),/WARREN_RECIPIENT_EMAIL_REQUIRED/);
 c.props.set('WARREN_RECIPIENT_EMAIL','one@example.org,two@example.org');
 assert.throws(()=>c.app.testMail(),/WARREN_RECIPIENT_EMAIL_INVALID/);
 assert.equal(c.files.size,0);
 assert.equal(c.sent.length,0);
});
test('the configured folder works in Apps Script text and legacy JSON-string formats',()=>{
 for(const value of ['warren-folder','"warren-folder"']){
   const c=cloud();c.props.set('WARREN_ROOT',value);
   assert.equal(c.app.initialize().rootId,'warren-folder');
   assert.equal(c.props.get('WARREN_ROOT'),value);
 }
});
test('the optional model probe and an initial setup do not need a host-specific adapter',()=>{
 const c=cloud();c.app.initialize();
 assert.equal(c.app.probeAi().error,'WARREN_MODEL_ADAPTER_NOT_CONFIGURED');
 assert.equal(c.app.status().enabled,false);assert.equal(c.sent.length,0);
});
test('unpublished research sends one clearly marked four-column pending brief without marking research published',()=>{
 const c=morning();c.app.tick();c.options.now+=60000;c.app.tick();
 assert.equal(c.sent.length,1);assert.match(c.sent[0].subject,/待补/);assert.match(c.sent[0].text,/估值逻辑与价位/);
 assert.equal(c.app.status().lastBrief,null);assert.equal(c.app.status().lastBriefDelivery.status,'sent');
 assert.equal(c.files.has('2026-11-18-research.json'),false);
});
test('cloud report is not sent on a verified exchange holiday',()=>{const c=cloud({now:Date.parse('2026-12-25T09:30:10+08:00')});c.app.testMail();c.app.start();c.app.tick();assert.equal(c.sent.length,1);});
test('malformed risk dates and unsupported sources cannot send a risk email',()=>{const c=cloud({now:Date.parse('2026-11-11T12:00:00+08:00')});c.app.testMail();c.app.start();c.files.get('risk-inbox.json').setContent(JSON.stringify({events:[{id:'x',title:'x',text:'x',asOf:'bad',sources:['https://www.hkexnews.hk/']},{id:'y',title:'y',text:'y',asOf:'2026-11-11T10:59:00+08:00',sources:['http://bad.example/'] }]}));c.app.tick();assert.equal(c.sent.length,1);});

function closeFixture(failOne=false){const calls=[],now=Date.parse('2026-11-13T08:00:00+08:00');const c=cloud({now,fetch:(url,opt)=>{
 calls.push(url);assert.ok(url.startsWith('https://webapi.futunn.com/api/v1.0/quote/'));
 if(url.includes('/trading-days?'))return {data:{trading_days:[{time:'2026-11-12',trade_date_type:'WHOLE'},{time:'2026-11-13',trade_date_type:'WHOLE'}]}};
 assert.match(url,/cur-kline\?num=5&ktype=2&autype=0$/);const symbol=decodeURIComponent(url.split('/quote/')[1].split('/')[0]);
 if(failOne&&symbol==='HK.03416')return {data:{kline_list:[]}};
 return {data:{kline_list:[{code:symbol,date:20261112,close_price:7.715,last_close_price:7.8}]}};
 }});c.app.initialize();c.props.set('WARREN_FUTU',JSON.stringify({accessToken:'synthetic-test-only',expiresAt:now+3600000}));return {c,calls};}
test('cloud backfill persists all sixteen explicitly unadjusted daily closes',()=>{const {c,calls}=closeFixture();const r=c.app.verifyCloses();assert.equal(r.received,16);assert.equal(r.complete,true);assert.equal(c.read('2026-11-12-close-data.json').quotes['HK.03416'].price,7.715);assert.equal(calls.length,17);assert.equal(c.sent.length,0);});
test('one failed daily bar does not erase successful closes or claim full coverage',()=>{const {c}=closeFixture(true);const r=c.app.verifyCloses();assert.equal(r.received,15);assert.equal(r.complete,false);assert.equal(r.errors['HK.03416'],'FUTU_DAILY_CLOSE_MISSING');});

test('cloud persists independent up/down alert states and applies risk blocks to both directions',()=>{
 const d=actionResearch();
 let price=15;const c=cloud({now:Date.parse('2026-11-16T10:00:00+08:00'),fetch:url=>{
  if(url.includes('trading-days'))return {data:{trading_days:[{time:'2026-11-16',trade_date_type:'WHOLE'}]}};
  assert.ok(url.includes('stock-quote'));
  return {data:{quote_list:d.securities.map(s=>({code:s.symbol,last_price:s.symbol==='HK.06823'?price: s.price,data_time:c.options.now,data_date:'2026-11-16',prev_close_price:s.price,sec_status:'NORMAL',suspension:false}))}};
 }});
 c.app.testMail();c.app.start();c.files.get('research.json').setContent(JSON.stringify(d));
 c.props.set('WARREN_STATE',JSON.stringify({briefDay:'2026-11-16',researchFresh:true}));
 c.props.set('WARREN_FUTU',JSON.stringify({accessToken:'synthetic-test-only',expiresAt:c.options.now+3600000,reauthorizeBy:c.options.now+86400000*7}));
 c.app.tick();assert.equal(c.sent.length,2);assert.match(c.sent[1].text,/上涨至持仓复核价/);
 c.options.now+=60000;c.app.tick();assert.equal(c.sent.length,2);
 c.files.get('risk-inbox.json').setContent(JSON.stringify({events:[],disabledSymbols:[{symbol:'HK.06823'}]}));
 price=9;c.options.now+=60000;c.app.tick();assert.equal(c.sent.length,3);assert.match(c.sent[2].text,/风险档案已暂停/);
 c.files.get('risk-inbox.json').setContent(JSON.stringify({events:[],disabledSymbols:[]}));
 c.options.now+=60000;c.app.tick();assert.equal(c.sent.length,5);assert.equal(c.sent.filter(m=>/方向：下跌/.test(m.text)).length,1);
 assert.ok(c.props.has('WARREN_Q_HK.06823'));assert.ok(c.props.has('WARREN_Q_UP_HK.06823'));
 assert.equal(c.app.status().research.enabledUpwardRules,3);
});

function morning(options={}){
 const c=cloud({now:Date.parse('2026-11-18T09:30:10+08:00'),...options});
 c.app.initialize();c.props.set('WARREN_ENABLED','true');
 const quotes=Object.fromEntries(c.core.symbols.map(s=>[s.symbol,{symbol:s.symbol,date:'2026-11-17',price:9,prevClose:8.9,autype:0,final:true,fetchedAt:Date.parse('2026-11-17T17:30:00+08:00')}]));
 c.write('2026-11-17-close-data.json',{date:'2026-11-17',autype:0,quotes,complete:true});
 return c;
}
function currentResearch(){
 const d=actionResearch();
 d.date='2026-11-18';d.asOf='2026-11-18T08:45:00+08:00';d.briefing.asOf=d.asOf;
 d.briefing.market='测试已重新核查交易所披露。';d.sources[0].checkedAt=d.asOf;
 d.securities.forEach(c=>{c.brief.asOf=d.asOf;c.decision.asOf=d.asOf;});return d;
}
test('blank, corrupt, and non-object Drive reads cannot publish; first valid replacement publishes exactly once',()=>{
 for(const raw of ['', '{bad','null','[1]']){
  const c=morning(),f=c.files.get('research.json');f.setContent(raw);c.app.tick();
  assert.equal(c.sent.length,1);assert.match(c.sent[0].subject,/待补/);
  assert.ok(c.app.status().researchReadError);assert.equal(c.files.has('2026-11-18-research.json'),false);
  c.options.now+=60000;c.write('research.json',currentResearch());c.app.tick();c.app.tick();
  assert.equal(c.sent.length,2);assert.doesNotMatch(c.sent[1].subject,/待补/);assert.match(c.sent[1].text,/测试已重新核查/);
  assert.equal(c.read('2026-11-18-research.json').date,'2026-11-18');assert.equal(c.app.status().lastBrief,'2026-11-18');
 }
});
test('quota-delayed morning mail is revalidated before dispatch when input is replaced',()=>{
 const c=morning({quota:20});c.write('research.json',currentResearch());c.app.tick();assert.equal(c.sent.length,0);
 c.options.quota=100;c.options.now+=60000;c.files.get('research.json').setContent('');c.app.tick();
 assert.equal(c.sent.length,1);assert.match(c.sent[0].subject,/待补/);assert.doesNotMatch(c.sent[0].text,/测试已重新核查/);
 const d=currentResearch();d.briefing.market='经复核后换用第二版测试新闻。';c.write('research.json',d);c.app.tick();
 assert.equal(c.sent.length,2);assert.match(c.sent[1].text,/第二版测试新闻/);assert.doesNotMatch(c.sent[1].text,/测试已重新核查/);
});
test('news and safe rows remain available when prior-day close coverage is partial; zero coverage stays pending',()=>{
 const c=morning(),d=currentResearch();c.write('research.json',d);
 const bars=c.read('2026-11-17-close-data.json');const one=bars.quotes['HK.06823'];bars.quotes={};c.write('2026-11-17-close-data.json',bars);c.app.tick();
 assert.match(c.sent[0].subject,/待补/);assert.equal(c.files.has('2026-11-18-research.json'),false);
 bars.quotes={'HK.06823':one};c.write('2026-11-17-close-data.json',bars);c.options.now+=60000;c.app.tick();assert.equal(c.sent.length,2);
 assert.match(c.sent[1].text,/估值逻辑与价位/);assert.doesNotMatch(c.sent[1].subject,/待补/);
});
test('on a later trading day no undelivered obsolete morning, including a legacy queue record, can escape',()=>{
 const c=morning({quota:20}),d=currentResearch();c.write('research.json',d);c.app.tick();
 const key='legacy-queue';c.write('mail-'+key+'.json',{id:'morning-2026-11-18',key,status:'pending',attempts:0,subject:'obsolete',text:'obsolete'});
 const ids=JSON.parse(c.props.get('WARREN_OUTBOX'));c.props.set('WARREN_OUTBOX',JSON.stringify([...ids,key]));
 c.options.now=Date.parse('2026-11-19T09:31:00+08:00');c.options.quota=100;c.app.tick();
 assert.equal(c.sent.length,1);assert.match(c.sent[0].subject,/19日港股晨报.*待补/);
 for(const id of [...ids,key])assert.equal(c.read('mail-'+id+'.json').status,'expired');
});
test('after the independent check a delivered verified four-column correction suppresses another dispatch',()=>{
 const c=morning();c.app.tick();c.write('research.json',currentResearch());
 c.options.now=Date.parse('2026-11-18T09:47:00+08:00');c.app.tick();assert.equal(c.sent.length,1);
 c.sent.push({recipient:'alerts@example.org',subject:'2026年11月18日港股晨报｜原版四栏更正',at:c.options.now,text:'11/18资料复核至 09:47 核验日期 2026-11-18 股票 / 昨收 | 估值逻辑与价位 | 分红参考 | 近期事实与建议'});
 c.options.now=Date.parse('2026-11-18T10:02:00+08:00');c.app.tick();assert.equal(c.sent.length,2);assert.equal(c.app.status().lastBrief,'2026-11-18');
});
test('after the independent check a missing verified original can still recover and a stale delivered original does not count',()=>{
 const c=morning();c.app.tick();c.write('research.json',currentResearch());
 c.sent.push({recipient:'alerts@example.org',subject:'2026年11月18日港股晨报',at:c.options.now,text:'资料截止 2026-11-17 08:43 估值逻辑与价位 分红参考 近期事实与建议 研究状态：资料未完成或已过期'});
 c.options.now=Date.parse('2026-11-18T10:01:00+08:00');c.app.tick();c.app.tick();
 assert.equal(c.sent.length,3);assert.match(c.sent[2].text,/测试已重新核查/);
});
test('a source replacement between preparation and dispatch is caught by the last read',()=>{
 const c=morning(),old=currentResearch(),changed=currentResearch();changed.briefing.market='最新修正已经核实。';
 c.write('research.json',old);const f=c.files.get('research.json'),read=f.getBlob;let loads=0;
 f.getBlob=()=>{if(++loads===2)f.setContent(JSON.stringify(changed));return read();};
 c.app.tick();assert.equal(c.sent.length,0);assert.equal(c.app.status().lastBrief,null);
 c.options.now+=60000;c.app.tick();assert.equal(c.sent.length,1);assert.match(c.sent[0].text,/最新修正已经核实/);
});
test('loss of the known Drive ID cannot silently adopt a different identically named research file',()=>{
 const c=morning();c.files.delete('research.json');c.write('research.json',currentResearch());c.app.tick();
 assert.equal(c.sent.length,1);assert.match(c.sent[0].subject,/待补/);assert.ok(c.app.status().researchReadError);
 assert.equal(c.files.has('2026-11-18-research.json'),false);
});
test('a legacy compact snapshot cannot replace the approved four-column mail format',()=>{
 const c=morning(),d=currentResearch();d.briefing.format='compact-v1';c.write('research.json',d);c.app.tick();
 assert.equal(c.sent.length,1);assert.match(c.sent[0].subject,/待补/);assert.match(c.sent[0].text,/估值逻辑与价位/);
 assert.equal(c.app.status().lastBrief,null);
});
const preflight='2026-11-18-preflight-research.json';
test('a verified independent snapshot replaces the entire rejected primary only in the morning brief',()=>{
 const c=morning(),partial=currentResearch(),backup=currentResearch();partial.securities.pop();partial.briefing.market='不得混入';backup.briefing.market='独立核实的公告。';
 c.write('research.json',partial);c.write(preflight,backup);c.app.tick();
 assert.equal(c.sent.length,1);assert.match(c.sent[0].text,/独立盘前复核/);assert.match(c.sent[0].text,/独立核实的公告/);
 assert.doesNotMatch(c.sent[0].text,/不得混入/);assert.equal(c.read('research.json').securities.length,15);
 assert.equal(c.read('2026-11-18-brief.json').researchSource.fileId,c.files.get(preflight).getId());
 assert.equal(c.app.status().morningCheck.source,'preflight');
});
test('the current complete primary takes precedence and duplicate fallback filenames never select an arbitrary file',()=>{
 const c=morning({duplicateName:preflight}),fallback=currentResearch();fallback.briefing.market='备援内容。';c.write(preflight,fallback);c.app.tick();
 assert.match(c.sent[0].subject,/待补/);assert.ok(c.app.status().morningCheck.backupErrors.includes('RESEARCH_FILE_AMBIGUOUS'));
 c.options.duplicateName=null;c.write('research.json',currentResearch());c.options.now+=60000;c.app.tick();
 assert.match(c.sent[1].text,/主研究快照/);assert.doesNotMatch(c.sent[1].text,/备援内容/);
});
test('a preflight ID changed between prepare and send, even with identical content, is rejected',()=>{
 const c=morning(),backup=currentResearch();c.write(preflight,backup);const f=c.files.get(preflight),getBlob=f.getBlob;
 f.getBlob=()=>{c.files.delete(preflight);c.write(preflight,backup);return getBlob();};c.app.tick();assert.equal(c.sent.length,0);
 c.options.now+=60000;c.app.tick();assert.equal(c.sent.length,1);assert.match(c.sent[0].text,/独立盘前复核/);
 assert.equal(c.read('2026-11-18-brief.json').researchSource.fileId,c.files.get(preflight).getId());
});
test('a stale or wrong-date backup cannot make either the official brief or audit look current',()=>{
 const c=morning(),backup=currentResearch();backup.date='2026-11-17';c.write(preflight,backup);c.app.tick();
 assert.match(c.sent[0].subject,/待补/);assert.ok(c.app.status().morningCheck.backupErrors.includes('RESEARCH_NOT_TODAY'));
 assert.equal(c.app.auditMorning().researchFresh,false);assert.equal(c.app.preview().researchFresh,false);
});

// Synthetic numbers are used only to exercise the watch transitions and mail delivery.
function yuexiuTestRule(data){
 const row=data.securities.find(c=>c.symbol==='HK.01052'),sample=data.securities.find(c=>c.symbol==='HK.06823').valuation;
 row.valuation={...sample,version:'synthetic-only',first:2.3,second:2,fairValue:{low:2.6,base:3,high:3.5},rationale:'合成回归样例',action:'核对交通量'};
 row.change='样例：新的经营数据改变现金流估计。';return row;
}
const valueMail=c=>c.sent.filter(m=>m.subject.startsWith('港股估值调整')&&m.subject.includes('01052'));
test('a new, revised or withdrawn range sends durable actionable notices without a quote; versions and unchanged retries are silent',()=>{
 const c=morning({now:Date.parse('2026-11-18T10:10:00+08:00')}),d=currentResearch();
 c.props.set('WARREN_STATE',JSON.stringify({briefDay:d.date,researchFresh:true}));c.write('research.json',d);
 const baseline=c.app.auditValuations();assert.equal(baseline.baseline,16);assert.equal(baseline.yuexiu.down,null);assert.equal(c.sent.length,0);
 const row=yuexiuTestRule(d);c.write('research.json',d);c.app.tick();c.app.tick();
 assert.equal(valueMail(c).length,1);assert.equal(valueMail(c)[0].recipient,'alerts@example.org');
 assert.match(valueMail(c)[0].text,/原判断：暂停.*\n新判断：合理价值 2.6–3.5/);assert.match(valueMail(c)[0].text,/核对交通量/);assert.match(valueMail(c)[0].text,/2026-11-18T08:45/);
 row.valuation.version='tomorrow-formatting';c.write('research.json',d);c.app.tick();assert.equal(valueMail(c).length,1);
 row.valuation.fairValue.high=3.7;c.write('research.json',d);c.app.tick();assert.equal(valueMail(c).length,2);assert.match(valueMail(c)[1].text,/新判断：合理价值 2.6–3.7/);
 row.valuation=null;c.write('research.json',d);c.app.tick();c.app.tick();assert.equal(valueMail(c).length,3);assert.match(valueMail(c)[2].text,/最新研究撤回/);
});
test('verified fallback drives watch only after frozen archive, source identity and dispatch are confirmed; later primary withdrawal wins permanently',()=>{
 const c=morning({now:Date.parse('2026-11-18T09:29:10+08:00')}),old=actionResearch(),d=currentResearch();
 c.write('research.json',old);c.app.tick();assert.equal(c.sent.length,0);yuexiuTestRule(d);c.write(preflight,d);c.options.now+=60000;c.app.tick();
 assert.equal(c.sent.length,1);assert.match(c.sent[0].text,/独立盘前复核/);c.options.now+=60000;c.app.tick();assert.equal(valueMail(c).length,1);
 assert.equal(c.app.auditValuations().source,'confirmed_preflight');assert.equal(c.read('research.json').date,old.date);
 const archive=c.read('2026-11-18-research.json');archive.securities.pop();c.write('2026-11-18-research.json',archive);assert.equal(c.app.auditValuations().source,null);
 c.write('2026-11-18-research.json',d);c.files.get(preflight).setContent('');assert.equal(c.app.auditValuations().source,null);c.write(preflight,d);
 c.options.now+=60000;const newer=currentResearch();newer.asOf='2026-11-18T09:32:00+08:00';c.write('research.json',newer);c.app.tick();
 assert.equal(c.app.auditValuations().source,'primary');assert.equal(valueMail(c).length,2);assert.match(valueMail(c)[1].text,/暂停使用原价位/);
 c.write('research.json',old);c.options.now+=60000;c.app.tick();assert.equal(c.app.auditValuations().source,null);assert.equal(valueMail(c).length,2);
});
test('expired or missing inputs never release queued valuation activation; newer rollback to last active range requires fresh evidence',()=>{
 const c=morning({quota:20,now:Date.parse('2026-11-18T10:10:00+08:00')}),d=currentResearch();
 c.props.set('WARREN_STATE',JSON.stringify({briefDay:d.date,researchFresh:true}));c.write('research.json',d);c.app.tick();
 const row=yuexiuTestRule(d);c.write('research.json',d);c.app.tick();assert.equal(c.app.status().outbox.length,1);
 c.files.get('research.json').setContent('');c.options.quota=100;c.app.tick();assert.equal(c.sent.length,0);
 row.valuation.validUntil='2026-11-17';c.write('research.json',d);c.app.tick();assert.equal(valueMail(c).length,1);
 assert.match(valueMail(c)[0].text,/超过复核期限/);assert.doesNotMatch(valueMail(c)[0].text,/新判断：合理价值/);
});
test('unchanged previous primary cannot provide a fallback once its confirmed trading date ends',()=>{
 const c=morning(),old=actionResearch(),d=currentResearch();
 c.write('research.json',old);yuexiuTestRule(d);c.write(preflight,d);c.app.tick();
 assert.equal(c.app.auditValuations().source,'confirmed_preflight');c.options.now=Date.parse('2026-11-19T09:11:00+08:00');
 assert.equal(c.app.auditValuations().source,null);c.app.tick();assert.equal(valueMail(c).length,0);
});
test('price mail waiting on quota expires and daily rule reissue cannot repeat an already triggered price',()=>{
 const d=currentResearch(),c=morning({now:Date.parse('2026-11-18T10:11:00+08:00'),quota:20,fetch:url=>{
   if(url.includes('trading-days'))return {data:{trading_days:[{time:d.date,trade_date_type:'WHOLE'}]}};
   return {data:{quote_list:d.securities.map(s=>({code:s.symbol,last_price:s.symbol==='HK.06823'?15:s.price,data_time:c.options.now,data_date:d.date,prev_close_price:s.price,sec_status:'NORMAL',suspension:false}))}};
 }});
 c.write('research.json',d);c.props.set('WARREN_STATE',JSON.stringify({briefDay:d.date,researchFresh:true}));
 c.props.set('WARREN_FUTU',JSON.stringify({accessToken:'synthetic-test-only',expiresAt:c.options.now+3600000,reauthorizeBy:c.options.now+86400000*7}));
 c.app.tick();assert.equal(c.app.status().outbox.length,1);const key=c.app.status().outbox[0];
 d.securities.find(s=>s.symbol==='HK.06823').upsideValuation.version='daily-republication';c.write('research.json',d);
 c.options.quota=100;c.options.now+=180000;c.app.tick();assert.equal(c.sent.length,0);assert.equal(c.read('mail-'+key+'.json').status,'expired');
});
test('final read catches newly disabled security before its pending range activation can leave',()=>{
 const d=currentResearch(),c=morning({now:Date.parse('2026-11-18T10:11:00+08:00')});
 c.write('research.json',d);c.props.set('WARREN_STATE',JSON.stringify({briefDay:d.date,researchFresh:true}));c.app.auditValuations();
 yuexiuTestRule(d);c.write('research.json',d);
 const risk=c.files.get('risk-inbox.json'),before=risk.getBlob;let reads=0;
 risk.getBlob=()=>{if(++reads===2)risk.setContent(JSON.stringify({events:[],disabledSymbols:['HK.01052']}));return before();};
 c.app.tick();assert.equal(c.sent.length,0);c.app.tick();assert.equal(valueMail(c).length,1);assert.match(valueMail(c)[0].text,/风险档案已暂停/);
});
