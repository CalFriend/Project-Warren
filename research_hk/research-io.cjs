'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {isDeepStrictEqual, parseArgs} = require('node:util');
const {writeOnce} = require('../tools/write-once.cjs');

const cutoff = '2026-11-13';
const defaultChart = path.join(__dirname, 'hsi_daily_source.json');

function options(usage, allowed, allowPositionalInput = false) {
  const definitions = {help: {type: 'boolean'}, output: {type: 'string'}};
  for (const name of allowed) definitions[name] = {type: name === 'input' ? 'string' : 'boolean'};
  let parsed;
  try {
    parsed = parseArgs({options: definitions, allowPositionals: allowPositionalInput});
  } catch (error) {
    throw Error(error.message + '\n' + usage);
  }
  if (parsed.values.help) {
    console.log(usage);
    process.exit(0);
  }
  const {values, positionals} = parsed;
  if (positionals.length > 1 || (positionals.length && values.input)) throw Error(usage);
  if (positionals.length) {
    values.input = positionals[0];
    values.legacyPositional = true;
  }
  if (values.demo && values.input) throw Error('Choose one input: --demo or --input FILE.');
  return values;
}

function readJson(file, hint) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw Error('Cannot read JSON at ' + file + '. ' + hint + ' (' + error.message + ')');
  }
}

function saveJson(file, data) {
  if (!file) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  const serialized = JSON.stringify(data, null, 2);
  writeOnce(file, serialized + '\n', existing => {
    let current;
    try { current = JSON.parse(existing.replace(/^\uFEFF/, '')); } catch (_) { /* Preserve unreadable output as well. */ }
    if (!isDeepStrictEqual(current, JSON.parse(serialized))) {
      throw Error('Output already exists with different contents: ' + file + '. Use a new --output path.');
    }
  });
}

function demoMarket() {
  const rows = [];
  const end = Date.parse(cutoff + 'T00:00:00Z');
  for (let t = Date.UTC(2007, 0, 1); t <= end; t += 86400000) {
    const day = new Date(t);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const index = rows.length;
    const close = 20000 + index + 4300 * Math.sin(index / 110);
    rows.push({date: day.toISOString().slice(0, 10), c: close, h: close * 1.01, l: close * 0.99});
  }
  return {symbol: 'SYNTHETIC', rows};
}

function marketInput(label, positional = false) {
  const usage = 'node research_hk/' + label + '.cjs [--input CHART.json | --demo] [--output NEW.json]\n' +
    'Historical snapshot through ' + cutoff + '. Input format: Yahoo Finance chart.result[0]. Demo uses synthetic weekday bars.';
  const opts = options(usage, ['input', 'demo'], positional);
  if (opts.demo) return {...demoMarket(), opts};
  const file = opts.input || defaultChart;
  const data = readJson(file, 'Supply --input CHART.json or run --demo.');
  const series = data?.chart?.result?.[0], quotes = series?.indicators?.quote?.[0];
  if (!Array.isArray(series?.timestamp) || !Array.isArray(quotes?.close) || !series?.meta?.symbol)
    throw Error('Expected Yahoo Finance chart.result[0] with meta.symbol, timestamp and indicators.quote[0].close.');
  const rows = [];
  for (const [i, timestamp] of series.timestamp.entries()) {
    if (!Number.isFinite(quotes.close[i])) continue;
    if (!Number.isFinite(timestamp) || quotes.close[i] <= 0) throw Error('Invalid date or nonpositive closing price.');
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    if (date > cutoff) continue;
    if (rows.length && date <= rows.at(-1).date) throw Error('Daily bars must be ordered with distinct trading dates.');
    rows.push({date, c: quotes.close[i], h: quotes.high?.[i], l: quotes.low?.[i]});
  }
  if (!rows.length) throw Error('No closing prices at or before ' + cutoff + '.');
  return {symbol: series.meta.symbol, rows, opts};
}

function finishMarket(opts, defaultFile, result, summary = result) {
  if (opts.demo) {
    result.synthetic = true;
    summary.synthetic = true;
  }
  const useDefaultFile = opts.legacyPositional || (!opts.demo && !opts.input);
  saveJson(opts.output || (useDefaultFile ? path.join(__dirname, defaultFile) : null), result);
  console.log(JSON.stringify(summary, null, 2));
}

module.exports = {cutoff, options, readJson, saveJson, marketInput, finishMarket};
