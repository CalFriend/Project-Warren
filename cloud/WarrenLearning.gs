/* Point-in-time valuation diagnostics. All prices and hypotheses are research only. */
var WarrenLearning = (function () {
  'use strict';
  const hasText = x => typeof x === 'string' && x.trim().length > 0;
  const finite = Number.isFinite;
  const validUrl = x => hasText(x) && /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(x);
  const policy = {trainingPeriods:3, forwardPeriods:2, retryAfterNewPeriods:3,
    candidate:'original_plus_half_training_median_signed_error', autoPublish:false};
  const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
    finite(Date.parse(x+'T00:00:00Z')) && new Date(x+'T00:00:00Z').toISOString().slice(0,10) === x;
  const instant = x => hasText(x) && date(x.slice(0,10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(x) ? Date.parse(x) : NaN;
  const hkDay = t => new Date(t + 28800000).toISOString().slice(0,10);
  const checkedThisEvening=(t,env)=>finite(t)&&t<=env.time&&hkDay(t)===env.date&&
    new Date(t+28800000).toISOString().slice(11,16)>='21:30';
  const flag = (status,reason) => ({status:status,reason:reason});
  const badCash = why => flag('insufficient_evidence',why);
  const sector = new Map(warrenUniverse().map(entry => [entry.symbol, entry.sector]));
  const bank = s => sector.get(s) === 'bank';
  const fund = s => sector.get(s) === 'fund';

  function operatingCash(symbol,c,env) {
    if (bank(symbol) || fund(symbol)) return flag('not_applicable',bank(symbol)?'use_regulatory_capital_and_roe':'use_fund_nav_and_total_return');
    if (!c) return badCash('cash_bridge_missing');
    const stamp=instant(c.checkedAt);
    if (!checkedThisEvening(stamp,env) || !validUrl(c.source) ||
        !hasText(c.period) || !['HKD','CNY','USD'].includes(c.currency) || c.scale!=='million' ||
        !['parent','group'].includes(c.scope) || typeof c.annual!=='boolean' || !finite(c.amount) ||
        (c.shares!==undefined && (!finite(c.shares) || c.shares<=0))) return badCash('cash_definition_source_or_units_missing');
    if (c.annual && (/(?:H[12]|Q[1-4]|半年|季度|[1-9]M)\b/i.test(c.period) && !/TTM|滚动|trailing/i.test(c.period)))
      return badCash('partial_period_cannot_be_annual_cash');
    if (!Array.isArray(c.included) || !Array.isArray(c.deductions)) return badCash('reconciliation_missing');
    const items=new Set(c.included);
    const validId = x => ['maintenance','interest','tax','minorities','leases','workingCapital'].includes(x);
    if (items.size!==c.included.length || !c.included.every(validId)) return badCash('invalid_included_items');
    let cash=c.amount, status, capexUsed=null;
    if (c.mode==='aff') {
      if (c.deductions.length || c.maintenanceCapex!==undefined || c.totalCapex!==undefined)
        return badCash('adjusted_cash_cannot_be_deducted_again');
      if (!['maintenance','interest','leases','tax'].every(x=>items.has(x)) ||
          (c.scope==='parent'&&!items.has('minorities')))
        return badCash('aff_to_ordinary_owners_unreconciled');
      status=c.scope==='parent'?'verified_aff_bridge':'issuer_aff_proxy';
    } else if (c.mode==='operating') {
      if (items.has('maintenance') || (c.maintenanceCapex!==undefined && (!finite(c.maintenanceCapex) || c.maintenanceCapex<0)) ||
          (c.totalCapex!==undefined && (!finite(c.totalCapex) || c.totalCapex<0)) ||
          (finite(c.maintenanceCapex) && finite(c.totalCapex) && c.maintenanceCapex>c.totalCapex))
        return badCash('capital_spending_duplicate_or_inconsistent');
      for (const d of c.deductions) {
        if (!d || !validId(d.id) || d.id==='maintenance' || items.has(d.id) ||
            !finite(d.amount) || d.amount<0 || !hasText(d.note)) return badCash('duplicate_or_unreconciled_deduction');
        items.add(d.id);
        cash-=d.amount;
      }
      capexUsed=finite(c.maintenanceCapex)?c.maintenanceCapex:c.totalCapex;
      if (!finite(capexUsed)) return badCash('missing_capital_spending');
      cash-=capexUsed;
      const ownersReconciled=c.scope==='parent' && ['interest','tax','minorities','leases'].every(x=>items.has(x));
      status=!finite(c.maintenanceCapex)?'after_all_capex_proxy':ownersReconciled?'owner_earnings':'after_maintenance_proxy';
    } else return badCash('unknown_cash_method');
    if (!finite(cash)) return badCash('invalid_cash_result');
    const eligible=c.annual && ['owner_earnings','verified_aff_bridge'].includes(status) && finite(c.shares) && cash>0;
    return {status:status,scope:c.scope,period:c.period,currency:c.currency,scale:c.scale,annual:c.annual,
      start:c.amount,capexUsed:capexUsed,deductions:c.deductions,alreadyIncluded:c.included,value:cash,
      sharesMillion:finite(c.shares)?c.shares:null,perUnit:eligible?cash/c.shares:null,eligibleForDcf:eligible,
      groupPerUnitProxy:status==='issuer_aff_proxy'&&c.annual&&cash>0&&finite(c.shares)?cash/c.shares:null,
      source:c.source,additionalSources:Array.isArray(c.sources)?c.sources.filter(validUrl):[],checkedAt:c.checkedAt};
  }
  function calculateValue(cash,g,m) {
    let pv=0;
    const span=m.mode==='finite'?m.rightYears:m.years;
    for (let t=1;t<=span;t++) pv+=cash*Math.pow((1+g)/(1+m.rate),t);
    const terminal=m.mode==='finite'?0:cash*Math.pow((1+g)/(1+m.rate),span)*(1+m.terminalGrowth)/(m.rate-m.terminalGrowth);
    return {value:pv+terminal,terminalPortion:terminal};
  }
  function reverse(symbol,cash,m,env) {
    if (fund(symbol)||bank(symbol)) return flag('not_applicable','use_sector_specific_model');
    const conditional=cash.status==='issuer_aff_proxy'&&finite(cash.groupPerUnitProxy)&&m&&
      finite(m.assumedOwnerShare)&&m.assumedOwnerShare>0&&m.assumedOwnerShare<=1;
    if (!m||(!cash.eligibleForDcf&&!conditional)) return flag('insufficient_evidence','annual_attributable_per_unit_cash_or_model_missing');
    const cashUnit=conditional?cash.groupPerUnitProxy*m.assumedOwnerShare:cash.perUnit;
    if (!date(m.priceDate) || !validUrl(m.priceSource) || !finite(m.price) || m.price<=0 ||
        m.priceDate>env.date || Date.parse(env.date)-Date.parse(m.priceDate)>4*86400000 ||
        m.currency!==cash.currency) return flag('insufficient_evidence','price_date_currency_or_source_mismatch');
    const weekend=[0,6].includes(new Date(env.date+'T00:00:00Z').getUTCDay());
    if (m.priceDate!==env.date && !(weekend && new Date(m.priceDate+'T00:00:00Z').getUTCDay()===5) &&
        !(m.previousTradingClose===true && validUrl(m.calendarSource)))
      return flag('insufficient_evidence','prior_close_requires_trading_calendar_confirmation');
    if (!['perpetual','finite'].includes(m.mode)||!Array.isArray(m.growth)||m.growth.length!==3 ||
        !m.growth.every((g,i)=>finite(g)&&g> -1&&g<=2&&(i===0||g>m.growth[i-1])) ||
        !finite(m.rate)||m.rate<=0 || m.rate>1 || m.years!==5) return flag('insufficient_evidence','scenario_or_discount_inputs_invalid');
    if ((m.mode==='finite' && (!Number.isInteger(m.rightYears)||m.rightYears<1||m.rightYears>100||
        (m.terminalGrowth!==undefined && m.terminalGrowth!==0))) ||
        (m.mode==='perpetual' && (['HK.01052','HK.00177','HK.00883'].includes(symbol) ||
          !finite(m.terminalGrowth)||m.terminalGrowth<=-1||m.terminalGrowth>=m.rate)))
      return flag('insufficient_evidence','asset_expiry_or_terminal_assumption_invalid');
    if (m.mode==='finite') {
      if (!date(m.rightEndsOn) || !validUrl(m.rightSource)) return flag('insufficient_evidence','approved_expiry_or_source_missing');
      const lastFullPayment=new Date(env.date+'T00:00:00Z');
      lastFullPayment.setUTCFullYear(lastFullPayment.getUTCFullYear()+m.rightYears);
      if (lastFullPayment.toISOString().slice(0,10)>m.rightEndsOn)
        return flag('insufficient_evidence','cash_projection_exceeds_approved_right');
    }
    const costs=Object.assign({},m);
    const scenarios=m.growth.map((g,i)=>Object.assign({case:['stress','central','improved'][i],annualGrowth:g},calculateValue(cashUnit,g,m)));
    // Only report an implied growth within this numeric search domain. It is not a probability interval.
    const lo=-0.95,hi=2;
    const book={inputs:costs,scenarios:scenarios,perUnitCash:cashUnit,searchGrowthBounds:[lo,hi],
      cashBasis:conditional?'assumed_share_of_issuer_group_aff':'attributable_owner_cash',
      assumedOwnerShare:conditional?m.assumedOwnerShare:null,authorizedForTrading:false};
    if (m.price<calculateValue(cashUnit,lo,m).value || m.price>calculateValue(cashUnit,hi,m).value)
      return Object.assign(book,flag('no_solution_in_bounds','outside_growth_search_domain'));
    let left=lo,right=hi;
    for (let i=0;i<90;i++) {
      const middle=(left+right)/2;
      if (calculateValue(cashUnit,middle,m).value<m.price) left=middle;
      else right=middle;
    }
    return Object.assign(book,{status:conditional?'conditional_proxy_sensitivity':'research_sensitivity',impliedAnnualGrowth:(left+right)/2,
      terminalPolicy:m.mode==='finite'?'zero_at_contract_expiry':'continuing_only_after_explicit_years'});
  }
  function cycle(symbol,c,env) {
    if (fund(symbol)||bank(symbol)) return flag('not_applicable','use_sector_specific_model');
    if (!c) return flag('insufficient_evidence','comparable_multiyear_series_missing');
    const at=instant(c.checkedAt);
    if (!hasText(c.metric)||!hasText(c.unit)||!hasText(c.note)||!validUrl(c.source)||!checkedThisEvening(at,env)||
        !Array.isArray(c.history) || c.history.length<5)
      return flag('insufficient_evidence','cycle_definitions_or_history_missing');
    const rows=c.history.slice().sort((a,b)=>a.year-b.year);
    const currentYear=Number(env.date.slice(0,4));
    if (!rows.every((r,i)=>Number.isInteger(r.year)&&r.year>=1900&&r.year<=currentYear&&finite(r.value) &&
        (r.unit===undefined||r.unit===c.unit) && (i===0||rows[i-1].year+1===r.year) &&
        (r.end===undefined?r.year<currentYear:date(r.end)&&Number(r.end.slice(0,4))===r.year&&r.end<env.date)))
      return flag('insufficient_evidence','years_not_completed_consecutive_and_comparable');
    const values=rows.map(r=>r.value).sort((a,b)=>a-b);
    function quantile(p) {
      const pos=(values.length-1)*p, i=Math.floor(pos);
      return values[i]+(pos-i)*(values[Math.ceil(pos)]-values[i]);
    }
    return {status:'historical_driver_range',metric:c.metric,unit:c.unit,source:c.source,checkedAt:c.checkedAt,
      fromYear:rows[0].year,toYear:rows[rows.length-1].year,periods:rows.length,
      lowerQuartile:quantile(.25),median:quantile(.5),upperQuartile:quantile(.75),method:'linear_interpolated_quantiles',
      role:'observed_driver_reference_only',note:c.note,history:rows};
  }
  const signature = x => [x.symbol,x.asset,x.metric,x.unit,x.basis||''];
  const key = x => JSON.stringify(signature(x));
  const observationKey = (x,period) => JSON.stringify(signature(x).concat(period));
  const segment = p => hasText(p)?p.replace(/^\d{4}/,''):'';
  const compYear = p => hasText(p)&&/^\d{4}(?:-|$)/.test(p)?Number(p.slice(0,4)):NaN;
  const signed = (model,actual) => actual-model;
  function freezeControls(report,old,env) {
    const controls = new Map((old.benchmarks||[]).map(x=>[x.observation,x]));
    const history=report.evidenceHistory||[];
    // Choose the earliest original forecast, and use at most one comparison per realised period.
    const forecasts=(report.forecastLedger||[]).slice().sort((a,b)=>instant(a.firstFrozenAt)-instant(b.firstFrozenAt) ||
      String(a.asOf).localeCompare(String(b.asOf)) || String(a.source).localeCompare(String(b.source)));
    for (const f of forecasts) {
      const id=observationKey(f,f.targetPeriod);
      if (controls.has(id)||!date(f.periodEnd)||f.periodEnd<=env.date||!finite(instant(f.firstFrozenAt))||
          instant(f.firstFrozenAt)>env.time || !finite(f.value)||!f.basis) continue;
      const orig=hkDay(instant(f.firstFrozenAt));
      const years=compYear(f.targetPeriod);
      const historyRows=history.filter(h=>key(h)===key(f)&&h.kind===f.kind&&finite(h.actual)&&
        date(h.release)&&date(h.firstSeen)&&h.firstSeen<=orig&&h.release<=orig&&
        compYear(h.period)<years&&segment(h.period)===segment(f.targetPeriod));
      historyRows.sort((a,b)=>compYear(b.period)-compYear(a.period)||b.release.localeCompare(a.release));
      const anchor=historyRows[0];
      if (!anchor) continue;
      const lead=years-compYear(anchor.period);
      controls.set(id,{observation:id,symbol:f.symbol,asset:f.asset,metric:f.metric,kind:f.kind,unit:f.unit,basis:f.basis,
        targetPeriod:f.targetPeriod,periodEnd:f.periodEnd,leadYears:lead,group:JSON.stringify(signature(f).concat(segment(f.targetPeriod),lead)),
        frozenAt:env.asOf,originalFrozenAt:f.firstFrozenAt,originalAsOf:f.asOf,originalSource:f.source,predicted:f.value,
        baseline:anchor.actual,baselinePeriod:anchor.period,baselineSource:anchor.source});
    }
    return Array.from(controls.values());
  }
  function learn(report,benchmarks,old,env) {
    const byPeriod=new Map(benchmarks.map(x=>[x.observation,x]));
    const samples=new Map((old.samples||[]).map(s=>[s.observation,s]));
    const unpaired=new Map((old.unpairedScores||[]).map(s=>[s.observation,s]));
    const firstVintages=new Map();
    const vintages=(report.forecastLedger||[]).slice().sort((a,b)=>instant(a.firstFrozenAt)-instant(b.firstFrozenAt)||
      String(a.asOf).localeCompare(String(b.asOf))||String(a.source).localeCompare(String(b.source)));
    for (const f of vintages) {
      const id=observationKey(f,f.targetPeriod);
      if (!firstVintages.has(id)) firstVintages.set(id,f);
    }
    // Fix the first public release previously seen. Subsequent restatements remain in the audit ledger.
    const history=(report.scoreHistory||[]).slice().sort((a,b)=>String(a.publishedAt).localeCompare(String(b.publishedAt))||
      String(a.reviewedOn).localeCompare(String(b.reviewedOn))||String(a.eventId).localeCompare(String(b.eventId)));
    for (const s of history) {
      const id=observationKey(s,s.targetPeriod), b=byPeriod.get(id);
      if (!b) {
        const f=firstVintages.get(id), release=s.publishedAt?.slice(0,10);
        if (!unpaired.has(id)&&f&&s.predicted===f.value&&s.frozenAt===f.firstFrozenAt&&s.forecastSource===f.source&&
            finite(instant(f.firstFrozenAt))&&finite(s.actual)&&finite(s.predicted)&&date(release)&&release<=env.date&&
            hkDay(instant(f.firstFrozenAt))<release && date(f.periodEnd)&&hkDay(instant(f.firstFrozenAt))<f.periodEnd) {
          const error=signed(s.predicted,s.actual);
          unpaired.set(id,{observation:id,symbol:s.symbol,asset:s.asset,metric:s.metric,unit:s.unit,basis:s.basis,
            targetPeriod:s.targetPeriod,actual:s.actual,predicted:s.predicted,publishedAt:s.publishedAt,source:s.disclosure,
            originalError:error,absOriginal:Math.abs(error),status:'without_prospective_comparable_control'});
        }
        continue;
      }
      if (samples.has(id)||!finite(s.actual)||s.predicted!==b.predicted||s.forecastSource!==b.originalSource ||
          s.frozenAt!==b.originalFrozenAt || !date(s.publishedAt?.slice(0,10)) ||
          hkDay(instant(b.frozenAt))>=s.publishedAt.slice(0,10) || env.date<s.publishedAt.slice(0,10)) continue;
      const error=signed(b.predicted,s.actual), naiveError=signed(b.baseline,s.actual);
      samples.set(id,{observation:id,group:b.group,originalError:error,naiveError:naiveError,absOriginal:Math.abs(error),
        absNaive:Math.abs(naiveError),actual:s.actual,predicted:b.predicted,baseline:b.baseline,publishedAt:s.publishedAt,
        targetPeriod:b.targetPeriod,source:s.disclosure});
    }
    const priorTracks=new Map((old.tracks||[]).map(x=>[x.group,x]));
    const groups=new Map();
    for (const b of benchmarks) {
      if (!groups.has(b.group)) groups.set(b.group,[]);
      groups.get(b.group).push(b);
    }
    const values=Array.from(samples.values()), tracks=[];
    const avg=(list,field)=>list.length?list.reduce((sum,x)=>sum+x[field],0)/list.length:null;
    for (const [group,positions] of groups) {
      const rows=values.filter(x=>x.group===group),first=positions[0],prior=priorTracks.get(group);
      const originalMAE=avg(rows,'absOriginal'),naiveMAE=avg(rows,'absNaive');
      const archive=(prior?.candidateHistory||[]).slice();
      let candidate=prior?.candidate?JSON.parse(JSON.stringify(prior.candidate)):null;
      // If a candidate fails, require a fresh training set before trying a later version.
      if (candidate?.status==='not_supported' && rows.filter(x=>!candidate.seenWhenClosed.includes(x.observation)).length>=policy.retryAfterNewPeriods) {
        archive.push(candidate);candidate=null;
      }
      const lastClosed=archive.length?archive[archive.length-1].seenWhenClosed:[];
      const training=rows.filter(x=>!lastClosed.includes(x.observation));
      if (!candidate && training.length>=policy.trainingPeriods) {
        const errors=training.map(r=>r.originalError).sort((a,b)=>a-b);
        const mid=(errors.length-1)/2, correction=(errors[Math.floor(mid)]+errors[Math.ceil(mid)])/4;
        const adjustedMAE=errors.reduce((sum,e)=>sum+Math.abs(e-correction),0)/errors.length;
        if (finite(correction) && correction!==0 && adjustedMAE<avg(training,'absOriginal')) {
          candidate={version:archive.length+1,rule:policy.candidate,adjustment:correction,unit:first.unit,nominatedOn:env.date,
            enrolled:[],status:'awaiting_forward_evidence',trainingPeriods:training.map(x=>x.targetPeriod),
            trainingOriginalMAE:avg(training,'absOriginal'),trainingNaiveMAE:avg(training,'absNaive'),trainingCandidateMAE:adjustedMAE};
        }
      }
      if (candidate && candidate.status==='awaiting_forward_evidence') {
        // Pre-register the first two still-open periods. Late enrolment after period-end is forbidden.
        for (const b of positions.slice().sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd))) {
          if (candidate.enrolled.length>=policy.forwardPeriods) break;
          if (b.periodEnd<=env.date||samples.has(b.observation)||candidate.enrolled.some(x=>x.observation===b.observation)) continue;
          candidate.enrolled.push({observation:b.observation,registeredAt:env.asOf,targetPeriod:b.targetPeriod,
            originalPrediction:b.predicted,naivePrediction:b.baseline,candidatePrediction:b.predicted+candidate.adjustment});
        }
        const forward=[];
        for (const e of candidate.enrolled) {
          const s=samples.get(e.observation);
          if (s && hkDay(instant(e.registeredAt))<s.publishedAt.slice(0,10)) forward.push({
            absOriginal:Math.abs(s.actual-e.originalPrediction),absNaive:Math.abs(s.actual-e.naivePrediction),
            absCandidate:Math.abs(s.actual-e.candidatePrediction)});
        }
        candidate.forwardScored=forward.length;
        candidate.forwardOriginalMAE=avg(forward,'absOriginal'); candidate.forwardNaiveMAE=avg(forward,'absNaive');
        candidate.forwardCandidateMAE=avg(forward,'absCandidate');
        if (forward.length>=policy.forwardPeriods) {
          candidate.status=candidate.forwardCandidateMAE<Math.min(candidate.forwardOriginalMAE,candidate.forwardNaiveMAE)?
            'recommend_human_review':'not_supported';
          candidate.seenWhenClosed=rows.map(x=>x.observation);
          candidate.retryAfterNewPeriods=policy.retryAfterNewPeriods;
        }
      }
      const pending=positions.filter(b=>!samples.has(b.observation)).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
      tracks.push({group:group,symbol:first.symbol,asset:first.asset,metric:first.metric,unit:first.unit,basis:first.basis,
        leadYears:first.leadYears,distinctScoredPeriods:rows.length,meanSignedError:avg(rows,'originalError'),
        originalMAE:originalMAE,naiveMAE:naiveMAE,candidate:candidate,candidateHistory:archive,
        status:candidate?candidate.status:rows.length<policy.trainingPeriods?'insufficient_independent_periods':'retain_original',
        nextPeriod:pending[0]?.targetPeriod||null});
    }
    return {samples:values,tracks:tracks,unpairedScores:Array.from(unpaired.values())};
  }
  function evaluate(input,report,previous,packet) {
    if (!input||!report||!date(input.date)||report.date!==input.date||!Array.isArray(report.securities))
      throw Error('INVALID_LEARNING_AUDIT');
    const reportTime=instant(report.asOf), packetTime=packet?instant(packet.asOf):reportTime;
    if (!finite(reportTime)||!finite(packetTime)||hkDay(reportTime)!==report.date||hkDay(packetTime)!==report.date ||
        (packet && (packet.date!==report.date || !Array.isArray(packet.securities))))
      throw Error('INVALID_LEARNING_PACKET');
    const t=Math.max(reportTime,packetTime),at=packetTime>reportTime?packet.asOf:report.asOf;
    const env={date:report.date,asOf:at,time:t}, old=previous?.learning || (previous?.kind==='evening_learning'?previous:{});
    if (old.kind && (old.schemaVersion!==1 || !date(old.date) || old.date>=env.date)) throw Error('INVALID_PREVIOUS_LEARNING');
    const entries=packet?packet.securities:[],requests=new Map(entries.map(x=>[x.symbol,x]));
    if (requests.size!==entries.length || entries.some(x=>!report.securities.some(c=>c.symbol===x.symbol)))
      throw Error('INVALID_LEARNING_SYMBOLS');
    const securities=report.securities.map(card=>{
      const p=requests.get(card.symbol),cash=operatingCash(card.symbol,p?.cash,env);
      return {symbol:card.symbol,ownerCash:cash,reverseDcf:reverse(card.symbol,cash,p?.dcf,env),cycle:cycle(card.symbol,p?.cycle,env)};
    });
    const benchmarks=freezeControls(report,old,env);
    const result=learn(report,benchmarks,old,env);
    return {schemaVersion:1,kind:'evening_learning',date:env.date,asOf:at,policy:Object.assign({},policy),
      summary:{securities:securities.length,cashBridges:securities.filter(x=>finite(x.ownerCash.value)).length,
        reverseDcfs:securities.filter(x=>x.reverseDcf.status==='research_sensitivity').length,
        conditionalProxyDcfs:securities.filter(x=>x.reverseDcf.status==='conditional_proxy_sensitivity').length,
        cycleStudies:securities.filter(x=>x.cycle.status==='historical_driver_range').length,frozenControls:benchmarks.length,
        independentlyScored:result.samples.length,originalScoredWithoutControl:result.unpairedScores.length,
        candidates:result.tracks.filter(x=>x.candidate).length,
        reviewOnly:result.tracks.filter(x=>x.status==='recommend_human_review').length},
      securities:securities,benchmarks:benchmarks,samples:result.samples,unpairedScores:result.unpairedScores,tracks:result.tracks};
  }
  return {evaluate:evaluate};
})();
