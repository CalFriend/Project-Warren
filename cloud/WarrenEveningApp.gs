/* Independent clock and Drive records for the nightly operating-asset audit. */
var WarrenEveningApp = (function () {
  'use strict';
  var zone = 'Asia/Hong_Kong';
  var handler = 'warrenEveningClock';
  var pointerKey = 'WARREN_EVENING_ARCHIVE_V1';
  var statusKey = 'WARREN_EVENING_STATUS_V1';

  function hash(raw) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  }
  function single(folder, name) {
    var files = folder.getFilesByName(name);
    if (!files.hasNext()) return null;
    var f = files.next();
    if (files.hasNext()) throw Error('DUPLICATE_FILE ' + name);
    return f;
  }
  function readRaw(file) { return file.getBlob().getDataAsString('UTF-8'); }
  function readInput(folder, date, learning) {
    var f = single(folder, date + (learning ? '-evening-learning-input.json' : '-evening-asset-input.json'));
    if (!f) throw Error(learning ? 'LEARNING_INPUT_MISSING' : 'INPUT_MISSING');
    var raw = readRaw(f), data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (data.date !== date || !Number.isFinite(Date.parse(data.asOf)) || Date.parse(data.asOf) > Date.now() + 60000)
      throw Error('WRONG_DATE_OR_FUTURE_INPUT');
    return { id:f.getId(), digest:hash(raw), data:data };
  }
  function archive(pointer) {
    var f = DriveApp.getFileById(pointer.id);
    if(f.isTrashed()) throw Error('ARCHIVE_TRASHED');
    var raw = readRaw(f);
    if (hash(raw) !== pointer.digest) throw Error('ARCHIVE_CHANGED');
    var data = JSON.parse(raw);
    if (data.kind !== 'evening_asset_audit' || data.date !== pointer.date) throw Error('WRONG_ARCHIVE');
    return data;
  }
  function confirmClosingPrices(folder, packet) {
    var checks=[], cache={};
    packet.securities.forEach(function (entry) {
      var m=entry.dcf;
      if (!m) return;
      var valid=false, reason=null, fileId=null;
      try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(m.priceDate)) throw Error('INVALID_PRICE_DATE');
        if (!cache[m.priceDate]) {
          var f=single(folder,m.priceDate+'-close-data.json');
          if (!f) throw Error('OFFICIAL_CLOSE_ARCHIVE_MISSING');
          cache[m.priceDate]={data:JSON.parse(readRaw(f)),id:f.getId()};
        }
        var snapshot=cache[m.priceDate], bar=snapshot.data.quotes[entry.symbol];
        fileId=snapshot.id;
        valid=snapshot.data.date===m.priceDate && snapshot.data.autype===0 &&
          Number.isFinite(snapshot.data.fetchedAt) && snapshot.data.fetchedAt<=Date.parse(packet.asOf) &&
          bar && bar.symbol===entry.symbol && bar.source==='Futu日K（不复权）' && bar.final===true &&
          bar.autype===0 && bar.date===m.priceDate && Number.isFinite(bar.price) && bar.price>0 &&
          bar.price===m.price && m.currency==='HKD';
        if (!valid) throw Error('PRICE_DISAGREES_WITH_ARCHIVE');
      } catch(err) { reason=String(err.message||err); }
      checks.push({symbol:entry.symbol,date:m.priceDate,fileId:fileId,matched:!!valid,reason:reason});
      if (!valid) delete entry.dcf;
    });
    return checks;
  }
  function commit(folder, date, props) {
    var input = readInput(folder, date);
    var packet = readInput(folder, date, true);
    if (!Array.isArray(packet.data.securities) || Utilities.formatDate(new Date(packet.data.asOf), zone, 'yyyy-MM-dd') !== date ||
      Utilities.formatDate(new Date(packet.data.asOf), zone, 'HHmm') < '2130') throw Error('INVALID_LEARNING_INPUT');
    var old = JSON.parse(props.getProperty(pointerKey) || 'null');
    if (!old) {
      var sealedFiles = folder.searchFiles("trashed = false and title contains '-evening-asset-audit.json'");
      while (sealedFiles.hasNext()) {
        var match = /^(\d{4}-\d{2}-\d{2})-evening-asset-audit\.json$/.exec(sealedFiles.next().getName());
        if (match && match[1] !== date) throw Error('MISSING_ARCHIVE_POINTER');
      }
    }
    if (old && old.date > date) throw Error('ARCHIVE_NEWER_THAN_REQUEST');
    if (old && old.date === date) {
      var done = archive(old);
      if (done.receipt.inputId !== input.id || done.receipt.inputDigest !== input.digest) throw Error('SEALED_INPUT_CHANGED');
      if (done.receipt.learningInputId !== packet.id || done.receipt.learningDigest !== packet.digest) throw Error('SEALED_LEARNING_INPUT_CHANGED');
      return { status:'sealed', date:date, reportId:old.id, coverage:done.coverage, summary:done.summary, learning:done.learning.summary };
    }
    var previous = old ? archive(old) : null;
    var report = WarrenEveningCore.evaluate(input.data, previous);
    if (!report.summary.securitiesWithSuccessfulSourceChecks) throw Error('NO_VALID_SOURCE_CHECKS');
    report.coverage = report.summary.unavailableChecks || report.summary.securitiesWithSourceFailures ||
      report.summary.securitiesWithSuccessfulSourceChecks < report.summary.securities ? 'partial' : 'all_submitted_checks_read';
    var closingChecks = confirmClosingPrices(folder,packet.data);
    report.learning = WarrenLearning.evaluate(input.data,report,previous,packet.data);
    report.learning.closingChecks = closingChecks;
    report.receipt = { inputId:input.id, inputDigest:input.digest, learningInputId:packet.id, learningDigest:packet.digest,
      previousId:old ? old.id : null, previousDigest:old ? old.digest : null };
    var out = JSON.stringify(report, null, 2);
    var name = date + '-evening-asset-audit.json';
    var f = single(folder, name);
    if (f && readRaw(f) !== out) throw Error('ARCHIVE_NAME_CONFLICT');
    var reread = readInput(folder, date);
    if (reread.id !== input.id || reread.digest !== input.digest) throw Error('INPUT_CHANGED_DURING_AUDIT');
    var learningReread=readInput(folder,date,true);
    if (learningReread.id !== packet.id || learningReread.digest !== packet.digest) throw Error('LEARNING_INPUT_CHANGED_DURING_AUDIT');
    if (!f) f = folder.createFile(name, out, 'application/json');
    var checked = single(folder, name);
    if (!checked || checked.getId() !== f.getId() || readRaw(checked) !== out) throw Error('ARCHIVE_READBACK_FAILED');
    props.setProperty(pointerKey, JSON.stringify({ date:date, id:f.getId(), digest:hash(out) }));
    return { status:'sealed', date:date, reportId:f.getId(), coverage:report.coverage, summary:report.summary, learning:report.learning.summary };
  }
  function alertMissing(props, date, error) {
    var key = 'WARREN_EVENING_LAST_NOTICE';
    if (props.getProperty(key) === date) return;
    var recipient=WarrenConfig.mail().recipient;
    // Reserve this day before dispatch to avoid duplicating an ambiguously accepted message.
    props.setProperty(key, date);
    MailApp.sendEmail(recipient, date + ' 港股晚审待补',
      '今晚的逐资产现金流核验尚未形成可读的封存结果。原因 ' + error +
      '。上一期报告保留原日期，系统会在随后检查时重试。');
  }
  function process(date, notify) {
    WarrenConfig.checkOwner();
    var folderId=WarrenConfig.rootId(true);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return {status:'busy', date:date};
    var props = PropertiesService.getScriptProperties(), result;
    try {
      try { result = commit(DriveApp.getFolderById(folderId), date, props); }
      catch (err) {
        result = {status:'pending', date:date, error:String(err.message || err).slice(0,350)};
        if (notify) {
          try { alertMissing(props, date, result.error); }
          catch (mailError) { result.notificationError=String(mailError.message || mailError).slice(0,160); }
        }
      }
      result.checkedAt = new Date().toISOString();
      props.setProperty(statusKey, JSON.stringify(result));
      return result;
    } finally { lock.releaseLock(); }
  }
  function clock(now) {
    var day = Utilities.formatDate(now, zone, 'yyyy-MM-dd'), hm = Utilities.formatDate(now, zone, 'HHmm');
    if (hm >= '2130') return process(day, hm >= '2330');
    if (hm < '0830') {
      var yesterday = Utilities.formatDate(new Date(now.getTime() - 86400000), zone, 'yyyy-MM-dd');
      return process(yesterday, true);
    }
    return {status:'outside_evening_window'};
  }
  function install() {
    WarrenConfig.checkOwner();
    WarrenConfig.rootId(true);
    WarrenConfig.mail();
    var active = ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction() === handler;});
    if (active.length > 1) throw Error('MULTIPLE_EVENING_TRIGGERS');
    if (!active.length) ScriptApp.newTrigger(handler).timeBased().everyMinutes(30).create();
    return status();
  }
  function status() {
    WarrenConfig.checkOwner();
    var props=PropertiesService.getScriptProperties();
    return {handler:handler, intervalMinutes:30, zone:zone, triggers:ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction() === handler;}).length,
      last:JSON.parse(props.getProperty(statusKey)||'null'), archive:JSON.parse(props.getProperty(pointerKey)||'null')};
  }
  return {clock:clock,install:install,status:status,runNow:function(){return process(Utilities.formatDate(new Date(), zone,'yyyy-MM-dd'), false);}};
})();

function warrenEveningInstall(){console.log(JSON.stringify(WarrenEveningApp.install()));}
function warrenEveningClock(){return WarrenEveningApp.clock(new Date());}
function warrenEveningRunNow(){console.log(JSON.stringify(WarrenEveningApp.runNow()));}
function warrenEveningStatus(){console.log(JSON.stringify(WarrenEveningApp.status()));}
