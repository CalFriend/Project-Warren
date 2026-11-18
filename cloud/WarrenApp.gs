/* Google-hosted research, market data and mail delivery. */
var WarrenApp = (function () {
  'use strict';
  var BASE='https://webapi.futunn.com', PREFIX='WARREN_';
  function p(){return PropertiesService.getScriptProperties();}
  function get(key,fallback){var v=p().getProperty(PREFIX+key);return v===null?fallback:JSON.parse(v);}
  function put(key,value){var text=JSON.stringify(value);if(Utilities.newBlob(text).getBytes().length>8000)throw Error('WARREN_PROPERTY_TOO_LARGE');p().setProperty(PREFIX+key,text);}
  function account(){WarrenConfig.checkOwner();}
  function sha(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
  function root(){return DriveApp.getFolderById(WarrenConfig.rootId(true));}
  function file(name){var it=root().getFilesByName(name);return it.hasNext()?it.next():null;}
  function read(name,fallback){var f=file(name);return f?JSON.parse(f.getBlob().getDataAsString('UTF-8')):fallback;}
  function optionalRead(name,fallback){
    try{return read(name,fallback)||fallback;}catch(e){return fallback;}
  }
  function researchInput(preflightDay){
    var id=preflightDay?null:get('RESEARCH_FILE_ID',null),f,name=preflightDay?preflightDay+'-preflight-research.json':'research.json';
    try{
      if(id)f=DriveApp.getFileById(id);
      else{
        var matches=root().getFilesByName(name);
        if(!matches.hasNext())return {data:null,error:'RESEARCH_FILE_MISSING'};
        f=matches.next();
        if(matches.hasNext())return {data:null,error:'RESEARCH_FILE_AMBIGUOUS'};
      }
      var raw=f.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/,'').trim();
      if(!raw)return {data:null,error:'RESEARCH_FILE_EMPTY',id:f.getId()};
      var data=JSON.parse(raw);
      if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID');
      if(!id&&!preflightDay)put('RESEARCH_FILE_ID',f.getId());
      return {data:data,error:null,id:f.getId()};
    }catch(e){return {data:null,error:'RESEARCH_FILE_UNREADABLE',id:id};}
  }
  function write(name,data){var content=JSON.stringify(data,null,2),f=file(name);if(f)f.setContent(content);else f=root().createFile(name,content,'application/json');return f;}
  function state(){return get('STATE',{briefDay:null,lastTick:null,lastSuccess:null,error:null});}
  function save(s){put('STATE',s);}
  function briefSeed(){var now=Date.now();return {schemaVersion:1,date:WarrenCore.parts(now).day,asOf:new Date(now).toISOString(),status:'research_pending',
    summary:['等待第一份有来源的研究和估值复核。'],
    macro:{view:'长期框架已建立；当前市场基准待原始数据核验。',change:'首次建立',counterEvidence:'初始研究未完成'},
    securities:WarrenCore.symbols.map(function(s){return {symbol:s.symbol,name:s.name,action:'待研究',thesis:'待建立有来源的长期判断',change:'首次建立',valuation:null};}),events:[],sources:[]};}
  function initialize(){
    account();
    var mail=WarrenConfig.mail();
    if(!WarrenConfig.rootId(false)){var f=DriveApp.createFolder('Project Warren');put('ROOT',f.getId());}
    if(!get('RESEARCH_FILE_ID',null)&&!file('research.json'))write('research.json',briefSeed());
    if(!file('risk-inbox.json'))write('risk-inbox.json',{schemaVersion:1,events:[],disabledSymbols:[]});
    if(!file('settings.json'))write('settings.json',{schemaVersion:1,timezone:'Asia/Shanghai',briefTime:'09:30',cutoffTime:'09:15',
      recipient:mail.recipient,senderName:mail.name,pollMinutes:1,quoteMaxAgeSeconds:120,mailReserve:20,maxWarrenRecipientsPerDay:30,
      universe:WarrenCore.symbols,calendarSource:'https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf'});
    if(p().getProperty(PREFIX+'ENABLED')===null)put('ENABLED',false);
    if(p().getProperty(PREFIX+'STATE')===null)save(state());
    publishStatus();return status();
  }
  function status(){
    account();var s=state(),auth=get('FUTU',null),input=researchInput(),research=input.data,now=Date.now(),cal=get('CALENDAR',null);
    var choice=selectMorning(input,get('LATEST_QUOTES',{}),now,cal,briefOptions(now,cal));
    return {version:WarrenCore.version,enabled:get('ENABLED',false),quoteVerified:get('QUOTE_VERIFIED',false),
      recipient:WarrenConfig.mail().recipient,timezone:'Asia/Shanghai',briefTime:'09:30',cutoffTime:'09:15',pollMinutes:1,
      rootId:WarrenConfig.rootId(false),researchFileId:input.id||null,researchReadError:input.error||null,morningCheck:s.morningCheck||null,riskReadError:s.riskReadError||null,riskInboxFileId:file('risk-inbox.json')?file('risk-inbox.json').getId():null,statusFileId:file('service-status.json')?file('service-status.json').getId():null,
      hasFutuAuthorization:!!auth,accessExpiresAt:auth?auth.expiresAt:null,reauthorizeBy:auth?auth.reauthorizeBy:null,
      triggerCount:ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='warrenTick';}).length,
      lastTick:s.lastTick,lastSuccess:s.lastSuccess,lastBrief:s.briefDay,lastBriefDelivery:s.lastBriefDelivery||null,researchFresh:!choice.errors.length,
      selectedMorningSource:choice.errors.length?null:choice.source,selectedMorningAsOf:choice.errors.length?null:choice.input.data.asOf,
      sourceReadError:s.newsError||null,error:s.error,quoteError:s.quoteError||null,mailTests:get('MAIL_TESTS',[]),
      aiProbe:get('AI_PROBE',null),authorizationCheck:get('AUTH_CHECK',null),outbox:get('OUTBOX',[]),
      quoteCheck:get('QUOTE_CHECK',null),quoteHealth:s.quoteHealth||null,closingCheck:get('CLOSE_CHECK',null),
      research:research?{status:research.status,version:research.version||null,asOf:research.asOf,
        enabledPriceRules:(Array.isArray(research.securities)?research.securities:[]).filter(function(c){return c&&WarrenCore.ruleValid(c.valuation,WarrenCore.parts(Date.now()).day);}).length,
        enabledUpwardRules:(Array.isArray(research.securities)?research.securities:[]).filter(function(c){return c&&WarrenCore.ruleValid(c.upsideValuation,WarrenCore.parts(Date.now()).day);}).length}:null};
  }
  function publishStatus(){var s=status();write('service-status.json',s);return s;}
  function request(path,options){
    var opt=Object.assign({muteHttpExceptions:true,followRedirects:false},options||{}),r;
    try{r=UrlFetchApp.fetch(BASE+path,opt);}catch(e){throw Error('FUTU_NETWORK_UNAVAILABLE');}
    var code=r.getResponseCode(),data;
    try{data=JSON.parse(r.getContentText());}catch(e){throw Error('FUTU_INVALID_RESPONSE');}
    if(code<200||code>=300)throw Error('FUTU_HTTP_'+code);
    if(data.ret_code!==undefined&&data.ret_code!==0)throw Error('FUTU_API_'+String(data.ret_code).replace(/[^0-9-]/g,''));
    return data;
  }
  function accessToken(){
    var auth=get('FUTU',null);if(!auth)throw Error('FUTU_AUTHORIZATION_NEEDED');
    if(auth.expiresAt>Date.now()+300000)return auth.accessToken;
    var data=request('/oauth2/token',{method:'post',payload:{grant_type:'refresh_token',refresh_token:auth.refreshToken,client_id:auth.clientId}});
    if(!data.access_token||!Number.isFinite(data.expires_in))throw Error('FUTU_TOKEN_RESPONSE_INVALID');
    validateScope(data.scope||auth.scope);auth.accessToken=data.access_token;auth.expiresAt=Date.now()+data.expires_in*1000;
    if(data.refresh_token)auth.refreshToken=data.refresh_token;
    put('FUTU',auth);return auth.accessToken;
  }
  function validateScope(scope){var permitted=WarrenCore.quoteOnlyScope(scope);
    put('AUTH_CHECK',{at:new Date().toISOString(),permitted:permitted,scopes:String(scope||'').split(/\s+/).filter(Boolean).map(function(s){return s.indexOf('accid:')===0?'accid:[redacted]':s.replace(/[^a-z:_*-]/gi,'').slice(0,50);})});
    if(!permitted)throw Error('FUTU_QUOTE_ONLY_SCOPE_REQUIRED');}
  function api(path,body){if(path.indexOf('/api/v1.0/quote/')!==0)throw Error('WARREN_QUOTE_ENDPOINTS_ONLY');var options={headers:{Authorization:'Bearer '+accessToken()}};if(body){options.method='post';options.contentType='application/json';options.payload=JSON.stringify(body);}return request(path,options);}
  function authorize(){
    account();initialize();var client=get('FUTU_CLIENT',null);
    var redirect='https://script.google.com/macros/d/'+ScriptApp.getScriptId()+'/usercallback';
    if(!client){client=request('/oauth2/register',{method:'post',contentType:'application/json',payload:JSON.stringify({redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_name:'Project Warren Quotes',scope:'quote:read'})});
      if(!client.client_id)throw Error('FUTU_CLIENT_REGISTRATION_FAILED');put('FUTU_CLIENT',{client_id:client.client_id});}
    var verifier=(Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,''),nonce=Utilities.getUuid();
    var challenge=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,verifier)).replace(/=+$/,'');
    var token=ScriptApp.newStateToken().withMethod('warrenFutuCallback').withArgument('warren_nonce',nonce).withTimeout(3600).createToken();
    put('FUTU_PENDING',{clientId:client.client_id,redirect:redirect,verifier:verifier,nonce:nonce,state:token,expiresAt:Date.now()+3600000});
    var query={client_id:client.client_id,code_challenge:challenge,code_challenge_method:'S256',redirect_uri:redirect,response_type:'code',state:token,scope:'quote:read'};
    var url=BASE+'/oauth2/authorize/confirm?'+Object.keys(query).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(query[k]);}).join('&');
    var message={subject:'港股监控｜连接富途只读行情',text:'请打开以下富途官方授权链接，登录并仅选择行情读取（quote:read）。不要选择交易、持仓或自选修改权限。授权完成后系统会核验16只证券的行情权限。\n\n'+url+'\n\n链接一小时内有效。你的登录密码由富途处理，不会写入研究资料。'};
    var queued=queue('authorize-'+nonce,message);drain();var delivered=read('mail-'+queued.key+'.json',queued);
    return {authorizationEmailSent:delivered.status==='sent',deliveryStatus:delivered.status,expiresAt:Date.now()+3600000};
  }
  function callback(e){
    account();var pending=get('FUTU_PENDING',null),param=e&&e.parameter||{};
    if(!pending||pending.expiresAt<Date.now()||param.warren_nonce!==pending.nonce||!param.code)throw Error('FUTU_CALLBACK_INVALID');
    if(param.state&&param.state!==pending.state)throw Error('FUTU_CALLBACK_STATE_MISMATCH');
    var data=request('/oauth2/token',{method:'post',payload:{grant_type:'authorization_code',code:param.code,client_id:pending.clientId,redirect_uri:pending.redirect,code_verifier:pending.verifier}});
    try{validateScope(data.scope);}catch(scopeError){publishStatus();return HtmlService.createHtmlOutput('<h2>行情授权尚未接通</h2><p>富途返回了非预期权限。请重新打开邮件链接，只保留“查看行情”，取消自选管理、账户查询和交易权限。系统没有保存这组访问凭据。</p><p>权限类型：'+WarrenCore.escape(get('AUTH_CHECK',{}).scopes.join(' '))+'</p>');}
    if(!data.access_token||!data.refresh_token||!Number.isFinite(data.expires_in))throw Error('FUTU_TOKEN_RESPONSE_INVALID');
    put('FUTU',{clientId:pending.clientId,accessToken:data.access_token,refreshToken:data.refresh_token,scope:data.scope,expiresAt:Date.now()+data.expires_in*1000,reauthorizeBy:Date.now()+14*86400000});
    p().deleteProperty(PREFIX+'FUTU_PENDING');put('QUOTE_VERIFIED',false);
    var result=verifyQuotes();publishStatus();
    return HtmlService.createHtmlOutput('<h2>富途行情已连接</h2><p>已返回'+result.received+'只证券。实时权限和报价时效仍会持续核验。研究价位只有通过复核后才启用。</p>');
  }
  function calendar(now){
    var day=WarrenCore.parts(now).day,c=get('CALENDAR',null);
    if(c&&c.start<=day&&c.end>=day&&now-c.fetchedAt<86400000)return c;
    if(!get('FUTU',null))return c;
    var start=new Date(now-20*86400000).toISOString().slice(0,10),end=new Date(now+40*86400000).toISOString().slice(0,10);
    var data=api('/api/v1.0/quote/trading-days?market=HK&start='+start+'&end='+end);
    if(!data.data||!Array.isArray(data.data.trading_days))throw Error('FUTU_CALENDAR_INVALID');
    c={start:start,end:end,days:data.data.trading_days,fetchedAt:now};put('CALENDAR',c);return c;
  }
  function quotes(){var result=api('/api/v1.0/quote/stock-quote',{code_list:WarrenCore.symbols.map(function(s){return s.symbol;})});
    if(!result.data||!Array.isArray(result.data.quote_list))throw Error('FUTU_QUOTES_INVALID');
    var fetchedAt=Date.now(),map={};result.data.quote_list.forEach(function(x){var q=WarrenCore.normalizeQuote(x,fetchedAt);if(WarrenCore.symbols.some(function(s){return s.symbol===q.symbol;}))map[q.symbol]=q;});
    put('LATEST_QUOTES',map);return map;}
  function ensureCloses(day,now,cal,force){
    if(!day||!get('FUTU',null))return null;
    var name=day+'-close-data.json',saved=optionalRead(name,null);
    if(saved&&(saved.date!==day||saved.autype!==0||!saved.quotes||typeof saved.quotes!=='object'))saved=null;
    var validBar=function(q,s){return q&&q.symbol===s.symbol&&q.date===day&&q.autype===0&&q.final===true&&Number.isFinite(q.price)&&q.price>0&&Number.isFinite(q.fetchedAt)&&q.fetchedAt<=now;};
    if(!force&&saved&&WarrenCore.symbols.every(function(s){return validBar(saved.quotes[s.symbol],s);}))return saved;
    if(!force&&saved&&!saved.complete&&saved.fetchedAt<=now&&now-saved.fetchedAt<60000)return saved;
    var result={date:day,fetchedAt:now,autype:0,quotes:saved&&saved.quotes||{},errors:{},complete:false};
    WarrenCore.symbols.forEach(function(s){
      try{var response=api('/api/v1.0/quote/'+encodeURIComponent(s.symbol)+'/cur-kline?num=5&ktype=2&autype=0');
        if(!response.data||!Array.isArray(response.data.kline_list))throw Error('FUTU_DAILY_BARS_INVALID');
        var close=WarrenCore.normalizeCloses(s.symbol,response.data.kline_list,now,cal)[day];
        if(!close)throw Error('FUTU_DAILY_CLOSE_MISSING');result.quotes[s.symbol]=close;
      }catch(e){result.errors[s.symbol]=safeCode(e);}
    });
    WarrenCore.symbols.forEach(function(s){if(!validBar(result.quotes[s.symbol],s))delete result.quotes[s.symbol];});
    result.complete=WarrenCore.symbols.every(function(s){return validBar(result.quotes[s.symbol],s);});
    write(name,result);put('CLOSE_CHECK',{date:day,received:Object.keys(result.quotes).length,errors:result.errors,at:now});return result;
  }
  function verifyCloses(){account();var now=Date.now(),cal=calendar(now),day=WarrenCore.previousDay(WarrenCore.parts(now).day,cal);var result=ensureCloses(day,now,cal,true);return result?{date:day,received:Object.keys(result.quotes).length,errors:result.errors,complete:result.complete}:null;}
  function verifyQuotes(){account();calendar(Date.now());var map=quotes(),missing=WarrenCore.symbols.filter(function(s){return !map[s.symbol];}).map(function(s){return s.symbol;});
    var invalid=Object.keys(map).filter(function(k){var q=map[k];return !Number.isFinite(q.price)||q.price<=0||!Number.isFinite(q.time)||q.time<=0||typeof q.suspension!=='boolean'||typeof q.status!=='string';});
    var result={received:Object.keys(map).length,missing:missing,invalid:invalid,verifiedAt:new Date().toISOString(),realtimeVerified:false};
    // A successful snapshot outside market hours does not establish a realtime entitlement.
    put('QUOTE_VERIFIED',missing.length===0&&invalid.length===0);put('QUOTE_CHECK',result);write('latest-quotes.json',{fetchedAt:new Date().toISOString(),quotes:map,check:result});return result;}
  function queue(id,message){var key=sha(id).slice(0,24),name='mail-'+key+'.json',existing=read(name,null);
    if(existing){
      // A queued but unsubmitted draft can be rebuilt from the latest successful read.
      if(/^morning-/.test(id)&&existing.status==='pending'&&(existing.text!==message.text||existing.html!==message.html)){
        existing.subject=message.subject;existing.text=message.text;existing.html=message.html;
        delete existing.draftId;write(name,existing);
      }
      if(existing.status!=='sent'){var repair=get('OUTBOX',[]);if(repair.indexOf(key)<0){repair.push(key);put('OUTBOX',repair);}}return existing;}
    var record={id:id,key:key,status:'pending',recipient:WarrenConfig.mail().recipient,createdAt:Date.now(),attempts:0,subject:message.subject,text:message.text,html:message.html||null};
    if(message.watch)record.watch=message.watch;
    write(name,record);var ids=get('OUTBOX',[]);if(ids.indexOf(key)<0)ids.push(key);put('OUTBOX',ids);return record;}
  function reconcile(record){
    var recipient=record.recipient||WarrenConfig.mail().recipient;
    var threads=GmailApp.search('in:sent newer_than:2d to:'+recipient+' subject:"'+record.subject.replace(/["\\]/g,'')+'"',0,20);
    var normal=function(t){return String(t).replace(/\r/g,'').trim();};
    for(var i=0;i<threads.length;i++){var messages=threads[i].getMessages();for(var j=0;j<messages.length;j++){var m=messages[j];
      if(m.getDate().getTime()>=record.createdAt-60000&&m.getSubject()===record.subject&&normal(m.getPlainBody())===normal(record.text)&&addressedTo(m,recipient))return m.getId();}}
    return null;
  }
  function addressedTo(message,recipient){
    return String(message.getTo()).split(',').some(function(item){
      var match=item.match(/<([^<>]+)>/);return (match?match[1]:item).trim().toLowerCase()===recipient;
    });
  }
  function morningMailKind(record){
    var m=String(record.id).match(/^morning-(?:(verified|pending)-)?(\d{4}-\d{2}-\d{2})$/);
    return m?{type:m[1]||'legacy',day:m[2]}:null;
  }
  function sentFullBrief(day){
    var recipient=WarrenConfig.mail().recipient;
    var title=day.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1年$2月$3日')+'港股晨报';
    var threads=GmailApp.search('in:sent newer_than:2d to:'+recipient+' subject:"'+title+'"',0,30);
    for(var i=0;i<threads.length;i++){
      var messages=threads[i].getMessages();
      for(var j=0;j<messages.length;j++){
        var m=messages[j],sub=m.getSubject();
        if(sub.indexOf(title)!==0||/待补|资料未齐/.test(sub)||WarrenCore.parts(m.getDate().getTime()).day!==day||!addressedTo(m,recipient))continue;
        var body=m.getPlainBody();
        if(/研究状态：资料未完成或已过期|资料核验待补/.test(body)||!['估值逻辑与价位','分红参考','近期事实与建议'].every(function(v){return body.indexOf(v)>=0;}))continue;
        // Explicit verification date is required, including the independent correction format.
        var monthDay=String(+day.slice(5,7))+'/'+String(+day.slice(8));
        if(body.indexOf('资料截止 '+day)<0&&body.indexOf(monthDay+'资料复核至')<0&&body.indexOf('核验日期 '+day)<0&&body.indexOf('资料复核至 '+day)<0)continue;
        return {id:m.getId(),at:m.getDate().getTime()};
      }
    }
    return null;
  }
  function drain(candidate,watch,s){
    var ids=get('OUTBOX',[]),remaining=[],checkedWatch,now=Date.now(),day=WarrenCore.parts(now).day,count=get('MAIL_COUNT',{day:day,count:0});if(count.day!==day)count={day:day,count:0};
    ids.forEach(function(key){
      var name='mail-'+key+'.json',r=read(name,null);if(!r||r.status==='sent'||r.status==='expired')return;
      var kind=morningMailKind(r);
      if(r.status==='sending'||r.status==='delivery_uncertain') {var found=reconcile(r);if(found){r.status='sent';r.messageId=found;r.reconciledAt=now;write(name,r);return;}
        // Unknown acceptance must be reviewed; never blindly replay an ambiguous send.
        if(r.status!=='delivery_uncertain'){r.status='delivery_uncertain';write(name,r);}
        if(!kind||kind.day===day)remaining.push(key);return;}
      if(kind&&(kind.day!==day||kind.type==='legacy'||WarrenCore.parts(now).minute>690)){
        r.status='expired';write(name,r);return;
      }
      if(kind&&(!candidate||key!==candidate.key)){remaining.push(key);return;}
      if(/^price-|^valuation-change-/.test(r.id)){
        if(!r.watch||(r.watch.type==='price'&&now-r.createdAt>120000)){r.status='expired';write(name,r);return;}
        if(!watch){remaining.push(key);return;}
        if(checkedWatch===undefined){
          var risk=optionalRead('risk-inbox.json',null);
          checkedWatch=risk&&Array.isArray(risk.events)&&Array.isArray(risk.disabledSymbols)?valuationWatch(activeRuleBook(researchInput(),s,Date.now()),risk.disabledSymbols,Date.now()):null;
          if(checkedWatch){checkedWatch.quotes=watch.quotes;checkedWatch.calendar=watch.calendar;}
        }
        if(!checkedWatch){remaining.push(key);return;}
        if(!applicableNotice(r.watch,checkedWatch,Date.now())){r.status='expired';write(name,r);return;}
      }
      if(count.count>=30||MailApp.getRemainingDailyQuota()<=20){remaining.push(key);return;}
      if(r.attempts>=3&&!kind){remaining.push(key);return;}
      if(kind){
        var dispatch=WarrenCore.parts(Date.now());
        if(dispatch.day!==kind.day||dispatch.minute>690){r.status='expired';write(name,r);return;}
        if(dispatch.minute>=585&&dispatch.minute<600){remaining.push(key);return;}
        if(kind.type==='verified'){
          var reread=researchInput(candidate.source==='preflight'?kind.day:null);
          if(!reread.data||reread.id!==candidate.sourceId||sha(JSON.stringify(reread.data))!==candidate.digest){remaining.push(key);return;}
          if(candidate.source==='preflight'){
            var primary=researchInput(),ctx=candidate.validationContext;
            if(!morningErrors(primary,ctx.latest,Date.now(),ctx.calendar,ctx.options).length){remaining.push(key);return;}
          }
        }
      }
      var draft;
      var mail=WarrenConfig.mail();
      if(r.recipient!==mail.recipient){
        if(/^setup-test-/.test(r.id)){r.status='expired';write(name,r);return;}
        // An unsent draft may have been created for a previous installation address.
        delete r.draftId;r.recipient=mail.recipient;
      }
      try{draft=r.draftId?GmailApp.getDraft(r.draftId):GmailApp.createDraft(mail.recipient,r.subject,r.text,{name:mail.name,replyTo:mail.replyTo||undefined,htmlBody:r.html||undefined});if(!draft)throw Error('DRAFT_MISSING');r.draftId=draft.getId();}
      catch(e){r.attempts++;r.error='DRAFT_FAILED';write(name,r);remaining.push(key);return;}
      r.status='sending';r.attempts++;write(name,r);
      try{var sent=draft.send();r.messageId=sent.getId();r.sentAt=Date.now();r.status='sent';count.count++;put('MAIL_COUNT',count);write(name,r);}
      catch(e){r.error='SEND_RESULT_UNCERTAIN';write(name,r);remaining.push(key);}
    });put('OUTBOX',remaining);
  }
  function probeAi(){
    account();var nonce=Utilities.getUuid().slice(0,8),start=Date.now();
    var model=WarrenConfig.setting('MODEL_NAME');
    if(!model||typeof WarrenModelAdapter==='undefined'||typeof WarrenModelAdapter.call!=='function')return {passed:false,error:'WARREN_MODEL_ADAPTER_NOT_CONFIGURED'};
    var body={model:model,messages:[{role:'system',content:'仅返回用户给出的校验码，不添加解释。'},{role:'user',content:nonce}],max_tokens:128};
    var response,text;
    try{response=WarrenModelAdapter.call(body);text=response.choices[0].message.content.trim();if(text!==nonce)throw Error('WARREN_AI_PROBE_FAILED');}
    catch(e){var failure={passed:false,at:new Date().toISOString(),milliseconds:Date.now()-start,error:safeCode(e),model:model,syntheticOnly:true};put('AI_PROBE',failure);publishStatus();return failure;}
    var result={passed:true,at:new Date().toISOString(),milliseconds:Date.now()-start,model:model,syntheticOnly:true};
    put('AI_PROBE',result);publishStatus();return result;
  }
  function testMail(){
    account();initialize();var recipient=WarrenConfig.mail().recipient,id='setup-test-'+WarrenCore.version+'-'+sha(recipient).slice(0,12);
    var result=queue(id,{subject:'港股晨报与提醒｜云端连接测试',text:'这是港股研究与提醒系统的连接测试。\n\n接收邮箱：'+recipient+'\n晨报：港股交易日北京时间09:30，信息截止09:15。\n正式提醒使用经过复核的研究版本。'});
    drain();result=read('mail-'+result.key+'.json',result);put('MAIL_TESTS',[{id:id,recipient:recipient,status:result.status,messageId:result.messageId||null,sentAt:result.sentAt||null}]);publishStatus();return {status:result.status,messageId:result.messageId||null};
  }
  function start(){account();initialize();
    var recipient=WarrenConfig.mail().recipient;
    if(!get('MAIL_TESTS',[]).some(function(t){return t.status==='sent'&&t.recipient===recipient;}))throw Error('WARREN_VERIFY_MAIL_FIRST');
    var triggers=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='warrenTick';});
    if(triggers.length>1)throw Error('WARREN_DUPLICATE_TRIGGERS');
    if(!triggers.length)ScriptApp.newTrigger('warrenTick').timeBased().everyMinutes(1).create();
    put('ENABLED',true);publishStatus();return status();}
  function stop(){account();put('ENABLED',false);ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='warrenTick';}).forEach(function(t){ScriptApp.deleteTrigger(t);});publishStatus();return status();}
  function morningErrors(input,latest,now,cal,options){
    var day=WarrenCore.parts(now).day,prior=WarrenCore.previousDay(day,cal);
    var errors=WarrenCore.validateResearch(input.data,day,now,options);
    if(input.error)errors.unshift(input.error);
    if(input.data&&(!input.data.briefing||input.data.briefing.format!=='decision-v3'))errors.push('MORNING_FORMAT_INVALID');
    var hasClose=WarrenCore.symbols.some(function(stock){
      var id=stock.symbol,bar=options.closingBars[id],q=latest[id],snapshot=options.closingQuotes[id];
      return WarrenCore.closingInfo(q&&q.symbol===id?q:null,snapshot&&snapshot.symbol===id?snapshot:null,day,prior,now,cal,bar&&bar.symbol===id?bar:null).usable;
    });
    if(!hasClose)errors.push('NO_VERIFIED_PREVIOUS_CLOSE');
    return errors;
  }
  function selectMorning(primary,latest,now,cal,options){
    var primaryErrors=morningErrors(primary,latest,now,cal,options);
    var choice={input:primary,source:'primary',errors:primaryErrors,primaryErrors:primaryErrors,backupErrors:null};
    if(!primaryErrors.length)return choice;
    var backup=researchInput(WarrenCore.parts(now).day),backupErrors=morningErrors(backup,latest,now,cal,options);
    choice.backupErrors=backupErrors;
    if(!backupErrors.length){choice.input=backup;choice.source='preflight';choice.errors=[];}
    return choice;
  }
  function annotateSource(report,choice){
    if(choice.errors.length)return;
    var name=choice.source==='preflight'?'独立盘前复核':'主研究快照';
    var link='https://drive.google.com/open?id='+encodeURIComponent(choice.input.id);
    report.researchSource={kind:choice.source,fileId:choice.input.id,asOf:choice.input.data.asOf};
    report.text+='\n研究来源：'+name+' '+link;
    var line='<p>研究来源：<a href="'+link+'">'+name+'</a></p>';
    report.html=report.html.includes('</body>')?report.html.replace('</body>',line+'</body>'):report.html+line;
  }
  function prepareMorning(input,latest,now,cal,s){
    var today=WarrenCore.parts(now),day=today.day;
    if(today.minute<570||today.minute>690||s.briefDay===day&&s.researchFresh)return null;
    var prior=WarrenCore.previousDay(day,cal);
    try{ensureCloses(prior,now,cal,false);}catch(e){s.closeReadError=safeCode(e);}
    var primary=input,options=briefOptions(now,cal),choice=selectMorning(input,latest,now,cal,options),errors=choice.errors;
    input=choice.input;
    s.morningCheck={date:day,checkedAt:new Date(now).toISOString(),asOf:input.data&&input.data.asOf||null,source:choice.source,fileId:input.id||null,
      primaryErrors:choice.primaryErrors.slice(0,6),backupErrors:choice.backupErrors&&choice.backupErrors.slice(0,6),errors:errors.slice(0,8),status:errors.length?'waiting':'verified'};
    s.researchFresh=false;
    // The independent 09:45 researcher gets the first opportunity to send a correction.
    if(today.minute>=585&&today.minute<600){s.morningCheck.status='awaiting_independent_check';return null;}
    if(today.minute>=600){
      var delivered=sentFullBrief(day);
      if(delivered){s.briefDay=day;s.researchFresh=true;s.morningCheck.status='confirmed_sent';
        s.lastBriefQueue=null;s.lastBriefDelivery={status:'sent',sentAt:delivered.at,messageId:delivered.id};return null;}
    }
    if(errors.length&&s.pendingNoticeDay===day)return null;
    options.validationErrors=errors;
    var health=s.quoteError||'行情按证券核验',report=WarrenCore.renderBrief(input.data,latest,now,cal,health,options);
    if(!errors.length&&(!report.researchFresh||report.format!=='decision-v3'))throw Error('WARREN_RENDER_VERIFICATION_FAILED');
    if(errors.length&&(report.researchFresh||report.format!=='decision-v3'))throw Error('WARREN_PENDING_RENDER_FAILED');
    annotateSource(report,choice);
    WarrenNews.attach(report,Date.now(),read);
    var type=errors.length?'pending':'verified';
    // Freeze validated inputs before queuing. Incomplete reads cannot become today's research archive.
    var archive=null;
    if(!errors.length){archive=write(day+'-research.json',input.data);write(day+'-brief.json',report);}
    else write(day+'-brief-pending.json',report);
    var record=queue('morning-'+type+'-'+day,report);
    return {key:record.key,type:type,source:choice.source,sourceId:input.id||null,digest:errors.length?null:sha(JSON.stringify(input.data)),
      asOf:input.data&&input.data.asOf,archiveId:archive&&archive.getId(),primaryDigest:choice.source==='preflight'&&primary.data?sha(JSON.stringify(primary.data)):null,
      validationContext:{latest:latest,calendar:cal,options:options}};
  }
  function confirmMorning(candidate,s,day){
    if(!candidate)return;
    var record=read('mail-'+candidate.key+'.json',null);
    if(!record)return;
    s.lastBriefQueue=record.key;
    s.lastBriefDelivery={status:record.status,sentAt:record.sentAt||record.reconciledAt||null,messageId:record.messageId||null,kind:candidate.type};
    if(record.status!=='sent')return;
    if(candidate.type==='pending'){s.pendingNoticeDay=day;s.morningCheck.status='waiting';return;}
    if(candidate.source==='preflight')s.ruleReceipt={day:day,asOf:candidate.asOf,archiveId:candidate.archiveId,sourceId:candidate.sourceId,digest:candidate.digest,primaryDigest:candidate.primaryDigest};
    else if(s.ruleReceipt&&Date.parse(candidate.asOf)>=Date.parse(s.ruleReceipt.asOf))delete s.ruleReceipt;
    s.briefDay=day;s.researchFresh=true;s.morningCheck.status='confirmed_sent';
  }
  function activeRuleBook(input,s,now){
    var main=WarrenCore.ruleBookValid(input.data,now)?input.data:null,receipt=s.ruleReceipt;
    if(!main||s.ruleWatermark&&Date.parse(main.asOf)<Date.parse(s.ruleWatermark))return null;
    if(!receipt||receipt.superseded){
      if(receipt&&Date.parse(main.asOf)<Date.parse(receipt.asOf))return null;
      s.ruleWatermark=main.asOf;return main;
    }
    // A changed primary with a newer, verified timestamp is authoritative, including a withdrawal.
    if(main&&Date.parse(main.asOf)>=Date.parse(receipt.asOf)){
      if(!receipt.primaryDigest||sha(JSON.stringify(main))!==receipt.primaryDigest){
        receipt.superseded=true;s.ruleWatermark=main.asOf;return main;
      }
      // A rejected morning primary of the same/newer date may contain an explicit withdrawal.
      return null;
    }
    if(!receipt.primaryDigest||sha(JSON.stringify(main))!==receipt.primaryDigest){receipt.superseded=true;return null;}
    if(receipt.day!==WarrenCore.parts(now).day)return null;
    try{
      var archived=JSON.parse(DriveApp.getFileById(receipt.archiveId).getBlob().getDataAsString('UTF-8'));
      var source=researchInput(receipt.day);
      if(!source.data||source.id!==receipt.sourceId||sha(JSON.stringify(source.data))!==receipt.digest||
        !WarrenCore.ruleBookValid(archived,now)||archived.date!==receipt.day||archived.asOf!==receipt.asOf||sha(JSON.stringify(archived))!==receipt.digest)return null;
      return archived;
    }catch(e){return null;}
  }
  function valuationWatch(data,blocks,now){
    if(!data)return null;
    var day=WarrenCore.parts(now).day,bySymbol={};
    data.securities.forEach(function(card){
      var down=WarrenCore.watchRule(card,'valuation',day,blocks,data.date),up=WarrenCore.watchRule(card,'upsideValuation',day,blocks,data.date);
      var block=blocks.filter(function(b){return typeof b==='string'?b===card.symbol:b&&b.symbol===card.symbol;})[0];
      bySymbol[card.symbol]={card:card,down:down,up:up,block:block,levels:[WarrenCore.ruleLevels(down),WarrenCore.ruleLevels(up)]};
    });
    return {rows:bySymbol,asOf:data.asOf,day:day,quotes:{},calendar:null};
  }
  function auditValuations(){
    account();var lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('WARREN_VALUATION_AUDIT_BUSY');
    try{
      var now=Date.now(),input=researchInput(),s=state(),data=activeRuleBook(input,s,now),risk=optionalRead('risk-inbox.json',null);
      var riskReady=!!(risk&&Array.isArray(risk.events)&&Array.isArray(risk.disabledSymbols)),watch=riskReady&&valuationWatch(data,risk.disabledSymbols,now);
      if(watch&&!get('VALUATION_LEDGER',null)){syncValuations(watch);save(s);}
      var ledger=get('VALUATION_LEDGER',null),row=watch&&watch.rows['HK.01052'];
      return {version:WarrenCore.version,source:!data?null:data===input.data?'primary':'confirmed_preflight',asOf:data&&data.asOf||null,
        riskReady:riskReady,tracked:watch?Object.keys(watch.rows).length:0,baseline:ledger?Object.keys(ledger.rows).length:0,
        yuexiu:row?{down:row.levels[0],up:row.levels[1]}:null,revision:ledger&&ledger.revision||0};
    }finally{lock.releaseLock();}
  }
  function applicableNotice(guard,watch,now){
    var row=watch.rows[guard.symbol];if(!row)return false;
    if(guard.type==='valuation')return JSON.stringify(row.levels)===guard.levels;
    var rule=row[guard.side],q=watch.quotes[guard.symbol];
    return !!rule&&WarrenCore.priceRuleId(rule)===guard.levels&&WarrenCore.validateQuote(q,now,watch.calendar)===null&&
      (guard.side==='up'?q.price>=guard.threshold:q.price<=guard.threshold);
  }
  function describeLevels(levels){
    var down=levels[0],up=levels[1],fair=down||up;if(!fair)return '暂停或暂无已核价位';
    return '合理价值 '+fair[2]+'–'+fair[4]+(fair[3]===null?'':'（基准 '+fair[3]+'）')+'港元'+
      (down?'，分批复核 '+down[0]+' / '+down[1]:'，暂无下行线')+(up?'，上行复核 '+up[0]+' / '+up[1]:'');
  }
  function syncValuations(watch){
    if(!watch)return;
    var ledger=get('VALUATION_LEDGER',null),first=!ledger,changed=first;
    if(first)ledger={revision:0,rows:{}};
    Object.keys(watch.rows).forEach(function(symbol){
      var row=watch.rows[symbol],old=ledger.rows[symbol],next=row.levels;
      if(JSON.stringify(old)===JSON.stringify(next))return;
      if(!first&&old){
        var current=row.down||row.up,c=row.card,reason=c.change||c.decision&&c.decision.caveat||current&&current.rationale||'价格规则暂停，等待复核';
        if(!current){
          var expired=[c.valuation,c.upsideValuation].some(function(r){return r&&r.validUntil&&r.validUntil<watch.day;});
          reason=row.block?'风险档案已暂停该证券的价位。'+(row.block.reason||''):expired?'原估值已超过复核期限。':'最新研究撤回或尚未核准原价位。'+reason;
        }
        var action=current?(current.action||'先核对经营、期限与仓位条件'):'暂停使用原价位，等待新研究';
        var fingerprint=JSON.stringify(next),title=(c.name||symbol)+'（'+symbol.slice(3)+'）';
        queue('valuation-change-'+symbol+'-'+(++ledger.revision)+'-'+sha(fingerprint).slice(0,10),{
          subject:'港股估值调整｜'+title,text:title+'\n原判断：'+describeLevels(old)+'\n新判断：'+describeLevels(next)+
          '\n研究资料时间：'+watch.asOf+'\n复核原因：'+reason+
          '\n下一步：'+action+(current?'\n依据：'+current.rationale+'\n失效条件：'+current.invalidation+'\n'+current.sources.join('\n'):''),
          watch:{type:'valuation',symbol:symbol,levels:fingerprint}});
      }
      ledger.rows[symbol]=next;changed=true;
    });
    if(changed)put('VALUATION_LEDGER',ledger);
  }
  function evaluateWatchedQuotes(watch,now){
    var events=[];
    Object.keys(watch.quotes).forEach(function(symbol){
      var row=watch.rows[symbol];if(!row)return;
      ['down','up'].forEach(function(side){
        var rule=row[side];if(!rule)return;
        var stateKey=(side==='down'?'Q_':'Q_UP_')+symbol,prior=get(stateKey,null),key=WarrenCore.priceRuleId(rule);
        var effective=Object.assign({},rule,{version:key});
        if(prior&&prior.version===rule.version)prior=Object.assign({},prior,{version:key});
        var evaluated=WarrenCore.evaluate(watch.quotes[symbol],effective,prior,now,watch.calendar);
        if(evaluated.event){
          evaluated.event.ruleVersion=rule.version;
          var msg=WarrenCore.renderAlert([evaluated.event]);msg.watch={type:'price',symbol:symbol,side:side,threshold:evaluated.event.threshold,levels:key};
          queue('price-'+evaluated.event.id,msg);events.push(evaluated.event);
        }
        if(evaluated.state&&evaluated.state!==prior)put(stateKey,evaluated.state);
      });
    });
    return events;
  }
  function tick(){
    if(!get('ENABLED',false))return;
    account();var now=Date.now(),parts=WarrenCore.parts(now);
    // Other scheduled jobs may hold the same project lock.
    var lock=LockService.getScriptLock();if(!lock.tryLock(50))return;
    var s=state();s.lastTick=new Date(now).toISOString();
    try{
      var cal=get('CALENDAR',null);
      if(get('FUTU',null)&&parts.minute>=550&&parts.minute<=1055){try{cal=calendar(now);}catch(calendarError){s.quoteError=safeCode(calendarError);}}
      var dayType=WarrenCore.marketDay(parts.day,cal);
      if(dayType==='CLOSED'){save(s);if(parts.minute%60===0)publishStatus();return;}
      if(dayType==='UNKNOWN'){s.error='TRADING_CALENDAR_UPDATE_REQUIRED';save(s);if(parts.minute%60===0)publishStatus();return;}
      if(parts.minute>=520&&parts.minute<=600){
        try{WarrenNews.refresh(now,cal,read,write);s.newsError=null;}catch(newsError){s.newsError=safeCode(newsError);}
      }
      if(parts.minute<550||parts.minute>1055){save(s);if(parts.minute%60===0)publishStatus();return;}
      var input=researchInput(),research=input.data,latest=get('LATEST_QUOTES',{}),events=[],auth=get('FUTU',null),riskInbox=optionalRead('risk-inbox.json',null);
      var riskReady=riskInbox&&Array.isArray(riskInbox.events)&&Array.isArray(riskInbox.disabledSymbols);
      if(!riskReady)riskInbox={events:[],disabledSymbols:WarrenCore.symbols};
      s.riskReadError=riskReady?null:'RISK_FILE_UNREADABLE';
      var ruleBook=activeRuleBook(input,s,now),watch=valuationWatch(ruleBook,riskInbox.disabledSymbols,now);
      (riskInbox.events||[]).forEach(function(e){
        if(!e||!e.id||!e.title||!e.text||!Array.isArray(e.sources)||!e.sources.length||e.sources.some(function(u){return !/^https:\/\//.test(u);}))return;
        if(!e.asOf||isNaN(Date.parse(e.asOf))||Date.parse(e.asOf)>now||now-Date.parse(e.asOf)>86400000)return;
        queue('risk-'+e.id,{subject:parts.day+' 港股重要变化｜'+e.title,text:e.text+'\n\n资料截止：'+e.asOf+'\n'+e.sources.join('\n')});
      });
      if(auth&&auth.reauthorizeBy-now<86400000&&s.authNotice!==auth.reauthorizeBy){queue('auth-expiry-'+auth.reauthorizeBy,{subject:'港股监控｜富途授权即将到期',text:'富途行情授权预计24小时内到期，需要重新连接。当前运行记录已标记此状态；授权失效后价格提醒会暂停，晨报会显示行情故障。'});s.authNotice=auth.reauthorizeBy;}
      if(auth&&parts.minute>=560&&parts.minute<=975&&!(parts.minute>730&&parts.minute<780)){
        try{cal=calendar(now);latest=quotes();var checkedAt=Date.now();s.quoteHealth=WarrenCore.quoteHealth(latest,checkedAt,cal);
          if(!s.quoteExportAt||checkedAt-s.quoteExportAt>=300000){write('latest-quotes.json',{fetchedAt:new Date(checkedAt).toISOString(),quotes:latest,health:s.quoteHealth});s.quoteExportAt=checkedAt;}
          var inSession=['CONTINUOUS','CLOSING_AUCTION'].indexOf(WarrenCore.session(now,cal))>=0;
          if(Object.keys(latest).length!==WarrenCore.symbols.length)throw Error('FUTU_QUOTES_INCOMPLETE');
          if(inSession&&Object.keys(latest).every(function(k){return WarrenCore.validateQuote(latest[k],checkedAt,cal)!==null;}))throw Error('FUTU_PRICE_TIMESTAMPS_STALE');
          if(watch){watch.quotes=latest;watch.calendar=cal;}
          if(s.quoteFailureNotice){queue('quote-recovery-'+s.quoteFailureNotice,{subject:'港股监控｜行情连接已恢复',text:'行情接口已恢复。价格触发仍逐条检查报价时间与证券状态；停机期间的短暂触价无法补报。'});s.quoteFailureNotice=null;}
          s.quoteError=null;s.quoteFailureSince=null;
        }catch(e){s.quoteError=safeCode(e);if(!s.quoteFailureSince)s.quoteFailureSince=now;
          if(now-s.quoteFailureSince>=300000&&!s.quoteFailureNotice){queue('quote-failure-'+s.quoteFailureSince,{subject:'港股监控｜行情检查异常',text:'行情检查连续5分钟未恢复，原因：'+s.quoteError+'。受影响证券的到价提醒暂停；请暂用富途App核对。系统恢复后会另发一次通知。'});s.quoteFailureNotice=s.quoteFailureSince;}}
      }
      var candidate=prepareMorning(input,latest,now,cal,s);
      // Never dispatch the displaced primary during the tick that promotes a preflight.
      if(candidate&&candidate.type==='verified'&&candidate.source==='preflight')watch=null;
      if(watch&&riskReady){syncValuations(watch);events=evaluateWatchedQuotes(watch,Date.now());}
      if(events.length)write('events-'+Date.now()+'.json',events);
      if(parts.minute>=1050&&s.snapshotDay!==parts.day){ensureCloses(parts.day,now,cal,false);write(parts.day+'-close-snapshot.json',{asOf:new Date(now).toISOString(),quotes:latest,research:research,riskInbox:riskInbox});s.snapshotDay=parts.day;}
      drain(candidate,riskReady?watch:null,s);confirmMorning(candidate,s,parts.day);
      s.lastSuccess=new Date().toISOString();s.error=null;save(s);
      if(parts.minute%15===0||parts.minute>=570&&parts.minute<575)publishStatus();
    }catch(e){s.error=safeCode(e);save(s);}
    finally{lock.releaseLock();}
  }
  function safeCode(e){return String(e&&e.message||'UNKNOWN').replace(/[^A-Z0-9_-]/g,'').slice(0,80)||'WARREN_OPERATION_FAILED';}
  function briefOptions(now,cal){var prior=WarrenCore.previousDay(WarrenCore.parts(now).day,cal),snapshot=prior?optionalRead(prior+'-close-snapshot.json',null):null;
    var bars=prior&&optionalRead(prior+'-close-data.json',null),risk=optionalRead('risk-inbox.json',null);
    var previous=prior&&optionalRead(prior+'-research.json',null);
    return {researchUrl:WarrenConfig.setting('RESEARCH_URL'),planUrl:WarrenConfig.setting('PLAN_URL'),
      previousResearch:previous&&previous.date<=prior&&previous.status==='published'&&Array.isArray(previous.securities)?previous:null,closingQuotes:snapshot&&snapshot.quotes||optionalRead('latest-quotes.json',{}).quotes||{},closingBars:bars&&bars.date===prior&&bars.autype===0&&bars.quotes||{},
      disabledSymbols:risk&&Array.isArray(risk.events)&&Array.isArray(risk.disabledSymbols)?risk.disabledSymbols:WarrenCore.symbols};}
  function preview(){account();initialize();var now=Date.now(),cal=get('CALENDAR',null),input=researchInput(),latest=get('LATEST_QUOTES',{}),options=briefOptions(now,cal);
    var choice=selectMorning(input,latest,now,cal,options);options.validationErrors=choice.errors;
    var report=WarrenCore.renderBrief(choice.input.data,latest,now,cal,'预览',options);annotateSource(report,choice);
    WarrenNews.attach(report,Date.now(),read);
    var f=file('morning-preview.html');if(f)f.setContent(report.html);else f=root().createFile('morning-preview.html',report.html,'text/html');
    return {fileId:f.getId(),researchFresh:report.researchFresh,format:report.format,textCharacters:report.text.length};}
  function auditMorning(){
    account();
    var now=Date.now(),day=WarrenCore.parts(now).day,cal=get('CALENDAR',null),input=researchInput(),options=briefOptions(now,cal);
    var quotesNow=get('LATEST_QUOTES',{}),source=WarrenNews.collect(now,cal,undefined,Date.now);
    var choice=selectMorning(input,quotesNow,now,cal,options);input=choice.input;options.validationErrors=choice.errors;
    var report=WarrenCore.renderBrief(input.data,quotesNow,now,cal,'预览',options);annotateSource(report,choice);
    WarrenNews.attach(report,Date.now(),function(){return source;});
    var inspect=source.sources.map(function(s){return {source:s.name,ok:s.ok,count:s.items.length,error:s.error||null,
      codes:s.items.reduce(function(all,item){return all.concat(item.codes||[]);},[]).filter(function(code,i,all){return all.indexOf(code)===i;})};});
    return {version:WarrenCore.version,day:day,asOf:input.data&&input.data.asOf||null,researchFresh:report.researchFresh,
      researchSource:choice.source,researchFileId:input.id||null,primaryErrors:choice.primaryErrors.slice(0,4),backupErrors:choice.backupErrors&&choice.backupErrors.slice(0,4),
      status:report.subject,errors:report.errors.filter(function(e,i,arr){return arr.indexOf(e)===i;}).slice(0,6),format:report.format,
      official:inspect,newsInBoth:report.text.indexOf('官方资讯')>=0&&report.html.indexOf('官方资讯')>=0,
      coreTable:report.html.indexOf('16只证券决策表')>=0,serviceEnabled:get('ENABLED',false),
      triggers:ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='warrenTick';}).length};
  }
  return {auditValuations:auditValuations,auditMorning:auditMorning,initialize:initialize,status:status,publishStatus:publishStatus,authorize:authorize,callback:callback,verifyQuotes:verifyQuotes,verifyCloses:verifyCloses,
    testMail:testMail,probeAi:probeAi,start:start,stop:stop,tick:tick,preview:preview};
})();

function warrenInitialize(){console.log(JSON.stringify(WarrenApp.initialize()));}
function warrenAuditMorning(){console.log(JSON.stringify(WarrenApp.auditMorning()));}
function warrenAuditValuations(){console.log(JSON.stringify(WarrenApp.auditValuations()));}
function warrenStatus(){console.log(JSON.stringify(WarrenApp.publishStatus()));}
function warrenTestEmail(){console.log(JSON.stringify(WarrenApp.testMail()));}
function warrenProbeModel(){console.log(JSON.stringify(WarrenApp.probeAi()));}
function warrenAuthorizeFutu(){console.log(JSON.stringify(WarrenApp.authorize()));}
function warrenFutuCallback(e){return WarrenApp.callback(e);}
function warrenVerifyQuotes(){console.log(JSON.stringify(WarrenApp.verifyQuotes()));}
function warrenVerifyCloses(){console.log(JSON.stringify(WarrenApp.verifyCloses()));}
function warrenStart(){console.log(JSON.stringify(WarrenApp.start()));}
function warrenStop(){console.log(JSON.stringify(WarrenApp.stop()));}
function warrenTick(){WarrenApp.tick();}
function warrenPreview(){console.log(JSON.stringify(WarrenApp.preview()));}
