/* Point-in-time evening research checks, shared by Apps Script and the local CLI. */
var WarrenEveningCore = (function () {
  'use strict';
  const universe = warrenUniverse();
  const symbols = universe.map(entry => entry.symbol);
  const funds = new Set(universe.filter(entry => entry.sector === 'fund').map(entry => entry.symbol));
  const kinds = new Set(['cash_flow','driver','balance_sheet','distribution','contract','fund_nav','fund_return','fund_strategy']);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const secureLink = value => text(value) && /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:[/?#][^\s]*)?$/i.test(value);
  const hkDate = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  function inEvening(ms) {
    return Number.isFinite(ms) && new Date(ms + 8 * 3600000).toISOString().slice(11,16) >= '21:30';
  }
  function calendarDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }
  function timestamp(value) {
    if (!text(value) || !calendarDay(value.slice(0, 10)) ||
        !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) return NaN;
    return Date.parse(value);
  }
  function cutoffDay(value) {
    if (calendarDay(value)) return value;
    const t = timestamp(value);
    return Number.isFinite(t) ? hkDate(t) : null;
  }
  function checkedToday(at, env) {
    const t = timestamp(at);
    return inEvening(t) && hkDate(t) === env.date && t <= env.time;
  }
  function classification(kind, metric, isFund) {
    if (!kinds.has(kind)) return 'unclassified';
    const isPayoutOrMarketValue = /股息|派息|分红|股利|分派|股价|资产净值|单位净值|dividend|distribution|\b(?:nav|dpu|dps|share price)\b/i.test(metric);
    if (kind === 'cash_flow' && isPayoutOrMarketValue) return 'invalid_cash_metric';
    if (kind === 'driver' && isPayoutOrMarketValue) return 'invalid_operating_metric';
    if (isFund && kind === 'cash_flow') return 'invalid_cash_metric';
    if (!isFund && kind.startsWith('fund_')) return 'invalid_fund_metric';
    return kind;
  }
  function coordinates(symbol, row, period) {
    return JSON.stringify([symbol,row.asset,row.metric,row.unit,period,row.basis || '']);
  }
  function forecastKey(symbol, row) {
    return JSON.stringify([coordinates(symbol,row,row.targetPeriod),row.asOf,row.source]);
  }
  function inspectSources(raw, env) {
    return (Array.isArray(raw) ? raw : []).map(item => {
      const s = item || {};
      const valid = secureLink(s.source) && text(s.detail) && checkedToday(s.checkedAt,env) &&
        ['updated','no_change','unavailable'].includes(s.outcome);
      return Object.assign({},s,{valid:valid,checkedSuccessfully:valid && s.outcome !== 'unavailable'});
    });
  }
  function newForecast(row, card, env, ledger, previousKeys) {
    const f = row || {};
    const asOfDay = cutoffDay(f.asOf);
    const kind = classification(f.kind,f.metric,funds.has(card.symbol));
    if (![f.asset,f.metric,f.unit,f.targetPeriod,f.basis,f.reason].every(text) || !secureLink(f.source) ||
        !['cash_flow','driver','balance_sheet','fund_return','fund_strategy'].includes(kind) ||
        !number(f.value) || !number(f.tolerance) || f.tolerance < 0 ||
        !calendarDay(f.periodEnd) || !asOfDay || asOfDay > env.date ||
        (Number.isFinite(timestamp(f.asOf)) && timestamp(f.asOf) > env.time)) return 'invalid_forecast';
    const id = forecastKey(card.symbol,f);
    if (ledger.has(id)) {
      const old = ledger.get(id);
      const unchanged = ['periodEnd','kind','value','tolerance','reason'].every(k => old[k] === f[k]);
      return unchanged ? (previousKeys.has(id) ? 'already_frozen' : 'duplicate_forecast') : 'frozen_forecast_conflict';
    }
    // A first-seen hypothesis can never be backdated by its submitter.
    if (env.date >= f.periodEnd) return 'too_late_to_freeze';
    ledger.set(id,Object.assign({},f,{symbol:card.symbol,firstFrozenAt:env.asOf}));
    return 'frozen';
  }
  function inspectCheck(row, card, env, history, scored, priorForecasts, seen, conflicts, sourceChecks) {
    const c = row || {};
    const kind = classification(c.kind,c.metric,funds.has(card.symbol));
    const result = Object.assign({},c,{classification:kind,issues:[],comparison:'not_scored'});
    const bad = result.issues;
    const id = coordinates(card.symbol,c,c.period);
    if (conflicts.has(id)) bad.push('conflicting_measurement');
    if (![c.asset,c.metric,c.unit,c.period,c.note].every(text)) bad.push('missing_definition');
    if (!secureLink(c.source)) bad.push('invalid_source_link');
    const actualSource = sourceChecks.get(c.source);
    if (!actualSource) bad.push('missing_source_read');
    else if (!actualSource.checkedSuccessfully) bad.push('source_read_failed');
    if (!checkedToday(c.checkedAt,env)) bad.push('not_checked_this_evening');
    const release = cutoffDay(c.publishedAt);
    const checkTime = timestamp(c.checkedAt);
    const releaseTime = timestamp(c.publishedAt);
    if (!release || release > env.date || (Number.isFinite(releaseTime) && releaseTime > checkTime)) bad.push('unavailable_disclosure_date');
    if (c.periodEnd !== undefined && (!calendarDay(c.periodEnd) || (release && c.periodEnd > release))) bad.push('period_after_disclosure');
    if (c.actual === null || c.actual === undefined) bad.push('no_reported_actual');
    else if (!number(c.actual)) bad.push('invalid_actual');
    if (kind.startsWith('invalid_')) bad.push(kind);
    if (bad.length) { result.evidence = 'unavailable'; return result; }
    if (seen.has(id)) {
      result.issues.push('duplicate_measurement');
      result.evidence = 'unavailable';
      return result;
    }
    seen.add(id);
    const old = history.get(id);
    if (old && release < old.release) {
      result.evidence = 'older_than_known_disclosure';
      return result;
    }
    if (old && old.actual === c.actual && old.kind === kind) result.evidence = 'already_recorded';
    else if (old && release <= old.release) {
      result.evidence = 'conflicting_sources';
      result.issues.push('conflicting_measurement');
      return result;
    } else if (old) result.evidence = 'restated';
    else result.evidence = release === env.date ? 'published_today' : 'historical_baseline';
    if (result.evidence !== 'already_recorded' || release > old.release) {
      history.set(id,{id:id,symbol:card.symbol,asset:c.asset,metric:c.metric,unit:c.unit,period:c.period,
        basis:c.basis || null,actual:c.actual,kind:kind,release:release,source:c.source,firstSeen:old ? old.firstSeen : env.date});
    }
    if (c.prior) result.priorStatus = 'reported_reference_only';
    if (result.evidence === 'already_recorded' || ['unclassified','distribution','fund_nav','contract'].includes(kind)) return result;
    if (!text(c.basis) || !calendarDay(c.periodEnd)) return result;
    // Compare every eligible vintage; retain their individual miss/hit histories.
    const matching = priorForecasts.get(id) || [];
    const comparisons = [];
    for (const f of matching) {
      const frozen = timestamp(f.firstFrozenAt);
      if (f.kind !== kind || f.periodEnd !== c.periodEnd || !Number.isFinite(frozen) ||
          hkDate(frozen) >= c.periodEnd || hkDate(frozen) >= release) continue;
      const eventId = JSON.stringify([forecastKey(card.symbol,f),release,c.actual]);
      if (scored.has(eventId)) continue;
      const delta = c.actual - f.value;
      const item = {eventId:eventId,symbol:card.symbol,asset:c.asset,metric:c.metric,kind:kind,
        targetPeriod:c.period,unit:c.unit,basis:c.basis,actual:c.actual,predicted:f.value,tolerance:f.tolerance,
        delta:delta,outcome:Math.abs(delta) <= f.tolerance + Number.EPSILON * Math.max(1,Math.abs(c.actual),Math.abs(f.value)) ? 'within_tolerance' : 'outside_tolerance',
        frozenAt:f.firstFrozenAt,forecastSource:f.source,disclosure:c.source,publishedAt:c.publishedAt,reviewedOn:env.date};
      scored.set(eventId,item);
      comparisons.push(item);
    }
    if (comparisons.length) { result.comparison = 'scored'; result.comparisons = comparisons; }
    return result;
  }
  function evaluate(input, previous) {
    if (!input || !calendarDay(input.date) || !inEvening(timestamp(input.asOf)) || hkDate(timestamp(input.asOf)) !== input.date)
      throw Error('INVALID_EVENING_AUDIT_DATE');
    const env = {date:input.date,asOf:input.asOf,time:timestamp(input.asOf)};
    const cards = input.securities;
    if (!Array.isArray(cards) || cards.length !== symbols.length || !symbols.every(s => cards.some(c => c && c.symbol === s)))
      throw Error('EXPECTED_ALL_16_UNIQUE_SECURITIES');
    if (previous && (previous.kind !== 'evening_asset_audit' || previous.schemaVersion !== 1 ||
        !Number.isFinite(timestamp(previous.asOf)) || !calendarDay(previous.date) || previous.date >= env.date ||
        hkDate(timestamp(previous.asOf)) !== previous.date ||
        !['evidenceHistory','forecastLedger','scoreHistory'].every(k => Array.isArray(previous[k]))))
      throw Error('INVALID_PREVIOUS_EVENING_AUDIT');
    const prior = previous || {};
    const history = new Map((prior.evidenceHistory || []).map(h => [h.id,h]));
    const scoreHistory = new Map((prior.scoreHistory || []).map(h => [h.eventId,h]));
    const ledger = new Map();
    const priorForecasts = new Map();
    for (const f of prior.forecastLedger || []) {
      ledger.set(forecastKey(f.symbol,f),f);
      const id = coordinates(f.symbol,f,f.targetPeriod);
      if (!priorForecasts.has(id)) priorForecasts.set(id,[]);
      priorForecasts.get(id).push(f);
    }
    const previousKeys = new Set(ledger.keys());
    const seen = new Set();
    const summary = {securities:cards.length,securitiesWithSuccessfulSourceChecks:0,securitiesWithSourceFailures:0,
      publishedToday:0,historicalBaselines:0,repeatedObservations:0,restatements:0,
      unavailableChecks:0,cashFlowObservations:0,newForecasts:0,forecastIssues:0,scored:0,misses:0,cashFlowComparisons:0};
    const securities = cards.map(card => {
      if (!text(card.name) || !text(card.method) || !text(card.next) || !Array.isArray(card.gaps) ||
          !card.gaps.every(text) || !Array.isArray(card.checks) || (!card.checks.length && !card.gaps.length))
        throw Error('INCOMPLETE_SECURITY_CARD ' + card.symbol);
      const sourceChecks = inspectSources(card.sourceChecks,env);
      if (sourceChecks.some(s => s.checkedSuccessfully)) summary.securitiesWithSuccessfulSourceChecks++;
      if (sourceChecks.some(s => !s.checkedSuccessfully)) summary.securitiesWithSourceFailures++;
      const latestSource = new Map();
      for (const s of sourceChecks) {
        const earlier = latestSource.get(s.source);
        if (!earlier || !(timestamp(s.checkedAt) < timestamp(earlier.checkedAt))) latestSource.set(s.source,s);
      }
      const measurements = new Map(), conflicts = new Set();
      for (const c of card.checks) {
        if (!c || !number(c.actual)) continue;
        const key = coordinates(card.symbol,c,c.period);
        if (measurements.has(key) && measurements.get(key) !== c.actual) conflicts.add(key);
        measurements.set(key,c.actual);
      }
      const checks = card.checks.map(c => inspectCheck(c,card,env,history,scoreHistory,priorForecasts,seen,conflicts,latestSource));
      for (const c of checks) {
        const counters = {published_today:'publishedToday',historical_baseline:'historicalBaselines',already_recorded:'repeatedObservations',
          restated:'restatements',unavailable:'unavailableChecks',conflicting_sources:'unavailableChecks'};
        if (counters[c.evidence]) summary[counters[c.evidence]]++;
        if (['historical_baseline','published_today','restated','already_recorded'].includes(c.evidence) && c.classification === 'cash_flow') summary.cashFlowObservations++;
        for (const v of c.comparisons || []) {
          summary.scored++;
          if (v.outcome === 'outside_tolerance') summary.misses++;
          if (v.kind === 'cash_flow') summary.cashFlowComparisons++;
        }
      }
      const forecasts = (card.forecasts || []).map(f => {
        const status = newForecast(f,card,env,ledger,previousKeys);
        if (status === 'frozen') summary.newForecasts++;
        if (!['frozen','already_frozen'].includes(status)) summary.forecastIssues++;
        return Object.assign({},f,{status:status});
      });
      return Object.assign({},card,{sourceChecks:sourceChecks,checks:checks,forecasts:forecasts});
    });
    return {schemaVersion:1,kind:'evening_asset_audit',date:env.date,asOf:env.asOf,previousDate:prior.date || null,
      summary:summary,securities:securities,forecastLedger:Array.from(ledger.values()),
      evidenceHistory:Array.from(history.values()),scoreHistory:Array.from(scoreHistory.values())};
  }
  return {evaluate:evaluate,symbols:symbols.slice()};
})();
