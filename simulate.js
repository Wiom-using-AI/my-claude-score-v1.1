#!/usr/bin/env node
'use strict';

// ═══════════════════════════════════════════════════════════════════════
// simulate.js — Monte Carlo simulation of 1000 non-technical users
// Imports constants from lib/ to prevent drift — single source of truth
// Zero npm dependencies — pure Node.js
// ═══════════════════════════════════════════════════════════════════════

const { SPEED_CURVE_CONFIG, SPEED_LABELS, getExpectedProficiency } = require('./lib/speed');
const { TIERS } = require('./lib/tiers');

// Alias for readability in the report (TIERS uses minScore field, not min)
const PROF_TIERS = TIERS;

const SEED = 42;
const N = 1000;

// ═══════════════════════════════════════════════════════════════════════
// PRNG — Mulberry32 seeded RNG for reproducibility
// ═══════════════════════════════════════════════════════════════════════
let _seed = SEED;
function rand() {
  _seed |= 0;
  _seed = _seed + 0x6D2B79F5 | 0;
  let t = Math.imul(_seed ^ _seed >>> 15, 1 | _seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

// Box-Muller transform for normal distribution
// Guard: clamp u1 away from 0 to prevent log(0) = -Infinity → NaN
function randNormal(mean, stddev) {
  const u1 = Math.max(1e-10, rand());
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stddev * z;
}

// Gamma distribution via Marsaglia & Tsang method
function randGamma(shape, scale) {
  if (shape < 1) {
    return randGamma(shape + 1, scale) * Math.pow(rand(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = randNormal(0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

// Beta distribution via two gammas
function randBeta(a, b) {
  const x = randGamma(a, 1);
  const y = randGamma(b, 1);
  return x / (x + y);
}

// ═══════════════════════════════════════════════════════════════════════
// Speed formula — mirrors lib/speed.js computeRawSpeedScore (dynamic sensitivity)
// ═══════════════════════════════════════════════════════════════════════
function computeSpeedScore(actualProficiency, effectiveDays) {
  if (effectiveDays < SPEED_CURVE_CONFIG.minDays) return null; // Too Early
  if (actualProficiency === 0) return 0;

  const expected = getExpectedProficiency(effectiveDays);
  const deviation = actualProficiency - expected;
  // Dynamic sensitivity: widens as expected proficiency grows (matches lib/speed.js)
  const dynamicSens = SPEED_CURVE_CONFIG.sensitivity * (1 + expected / 100);
  const normalized = deviation / dynamicSens;
  const sigmoid = 1 / (1 + Math.exp(-normalized));
  return Math.round(sigmoid * 100);
}

function getSpeedLabel(score) {
  if (score === null) return 'Too Early';
  for (const tier of SPEED_LABELS) {
    if (score >= tier.min) return tier.label;
  }
  return 'Warming Up';
}

function getProfTier(score) {
  for (const tier of TIERS) {
    if (score >= tier.minScore) return tier.name;
  }
  return 'Apprentice';
}

// ═══════════════════════════════════════════════════════════════════════
// Generate 1000 non-technical users
// ═══════════════════════════════════════════════════════════════════════
function generateUsers() {
  const users = [];

  for (let i = 0; i < N; i++) {
    // ── Active Days ──────────────────────────────────────────────────
    // 90% of users: 1-25 active days (started in the last month)
    // 10% outliers: 25-60 active days (started 2-3 months ago)
    // Use a gamma distribution for right-skew
    let activeDays;
    if (rand() < 0.10) {
      // Outlier: longer tenure users
      activeDays = Math.round(25 + randGamma(2.5, 6)); // 25 + gamma(2.5, 6) => median ~40
      activeDays = Math.min(activeDays, 90);
    } else {
      // Typical: recent users, right-skewed toward low days
      activeDays = Math.round(randGamma(2.2, 4.5)); // shape=2.2, scale=4.5 => median ~8
      activeDays = Math.max(1, Math.min(activeDays, 30));
    }

    // ── Proficiency ──────────────────────────────────────────────────
    // Non-technical users cluster LOW (0-35), with a long tail.
    //
    // Component model (5 dimensions, each 0-20 max):
    //   Config:     0-5 pts (most have defaults, a few customize)
    //   Tools:      0-8 pts (some install an MCP or two)
    //   Workflow:   0-5 pts (almost nobody uses agents/plans)
    //   Automation: 0-8 pts (some commits, weak git discipline)
    //   Knowledge:  0-5 pts (security/rules are developer territory)
    //
    // We model total proficiency as a mixture:
    //   80% pure beginners:     beta(2, 12) * 60   => median ~8, range 0-30
    //   15% engaged non-tech:   beta(3, 7) * 70    => median ~21, range 5-50
    //   5% power non-tech:      beta(4, 5) * 80    => median ~40, range 15-65
    //
    // The beta shapes create a realistic J-curve with most users at the bottom.

    let proficiency;
    const cohort = rand();
    if (cohort < 0.80) {
      // Pure beginners — barely touched settings
      proficiency = Math.round(randBeta(2, 12) * 60);
    } else if (cohort < 0.95) {
      // Engaged non-technical users — tried a few things
      proficiency = Math.round(randBeta(3, 7) * 70);
    } else {
      // Power non-tech users — customized heavily for their use case
      proficiency = Math.round(randBeta(4, 5) * 80);
    }
    proficiency = Math.max(0, Math.min(100, proficiency));

    // Slight correlation: users with more active days tend to have slightly higher proficiency
    if (activeDays > 15) {
      const bonus = Math.round(rand() * Math.min(8, (activeDays - 15) * 0.3));
      proficiency = Math.min(100, proficiency + bonus);
    }

    // ── Speed Score ─────────────────────────────────────────────────
    const speedScore = computeSpeedScore(proficiency, activeDays);
    const speedLabel = getSpeedLabel(speedScore);
    const profTier = getProfTier(proficiency);
    const expected = activeDays >= SPEED_CURVE_CONFIG.minDays
      ? Math.round(getExpectedProficiency(activeDays))
      : null;

    users.push({
      id: i + 1,
      activeDays,
      proficiency,
      speedScore,
      speedLabel,
      profTier,
      expected,
    });
  }

  return users;
}

// ═══════════════════════════════════════════════════════════════════════
// Statistics helpers
// ═══════════════════════════════════════════════════════════════════════
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function histogram(values, binSize, minVal, maxVal, width = 50) {
  const bins = [];
  for (let lo = minVal; lo < maxVal; lo += binSize) {
    const hi = lo + binSize;
    const count = values.filter(v => v >= lo && v < hi).length;
    bins.push({ lo, hi, count });
  }
  // Handle exact maxVal
  if (bins.length > 0) {
    bins[bins.length - 1].count += values.filter(v => v === maxVal).length;
  }

  const maxCount = Math.max(...bins.map(b => b.count));
  const lines = [];
  for (const bin of bins) {
    const label = `${String(bin.lo).padStart(3)}-${String(bin.hi).padStart(3)}`;
    const barLen = maxCount > 0 ? Math.round((bin.count / maxCount) * width) : 0;
    const bar = '\u2588'.repeat(barLen);
    const countStr = String(bin.count).padStart(4);
    lines.push(`  ${label} |${bar} ${countStr}`);
  }
  return lines.join('\n');
}

function activeDaysHistogram(values, width = 50) {
  const buckets = [
    { lo: 1, hi: 2,   label: '  1-2  ' },
    { lo: 3, hi: 5,   label: '  3-5  ' },
    { lo: 6, hi: 10,  label: ' 6-10  ' },
    { lo: 11, hi: 15, label: '11-15  ' },
    { lo: 16, hi: 20, label: '16-20  ' },
    { lo: 21, hi: 30, label: '21-30  ' },
    { lo: 31, hi: 45, label: '31-45  ' },
    { lo: 46, hi: 60, label: '46-60  ' },
    { lo: 61, hi: 90, label: '61-90  ' },
  ];
  const bins = buckets.map(b => ({
    ...b,
    count: values.filter(v => v >= b.lo && v <= b.hi).length,
  }));
  const maxCount = Math.max(...bins.map(b => b.count));
  const lines = [];
  for (const bin of bins) {
    const barLen = maxCount > 0 ? Math.round((bin.count / maxCount) * width) : 0;
    const bar = '\u2588'.repeat(barLen);
    lines.push(`  ${bin.label}|${bar} ${String(bin.count).padStart(4)}`);
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// Print the full report
// ═══════════════════════════════════════════════════════════════════════
function printReport(users) {
  const line = '\u2550'.repeat(72);
  const thinLine = '\u2500'.repeat(72);

  console.log();
  console.log(line);
  console.log('  CLAUDE SCORE v12 -- SIMULATION REPORT');
  console.log('  1000 Non-Technical Users (Marketers, Writers, PMs, SMB Owners)');
  console.log(line);

  // ── 0. Active Days Distribution ─────────────────────────────────────
  const allDays = users.map(u => u.activeDays).sort((a, b) => a - b);
  console.log();
  console.log('  [0] ACTIVE DAYS DISTRIBUTION');
  console.log(thinLine);
  console.log(activeDaysHistogram(allDays));
  console.log();
  console.log(`  Mean: ${mean(allDays).toFixed(1)}  |  Median: ${percentile(allDays, 50).toFixed(0)}  |  Std Dev: ${stddev(allDays).toFixed(1)}`);
  console.log(`  P10: ${percentile(allDays, 10).toFixed(0)}  |  P25: ${percentile(allDays, 25).toFixed(0)}  |  P75: ${percentile(allDays, 75).toFixed(0)}  |  P90: ${percentile(allDays, 90).toFixed(0)}`);
  console.log(`  Below minDays (< ${SPEED_CURVE_CONFIG.minDays}): ${users.filter(u => u.activeDays < SPEED_CURVE_CONFIG.minDays).length} users => "Too Early"`);

  // ── 1. Proficiency Distribution ─────────────────────────────────────
  const allProf = users.map(u => u.proficiency).sort((a, b) => a - b);
  console.log();
  console.log('  [1] PROFICIENCY DISTRIBUTION (0-100)');
  console.log(thinLine);
  console.log(histogram(allProf, 10, 0, 100));
  console.log();
  console.log(`  Mean: ${mean(allProf).toFixed(1)}  |  Median: ${percentile(allProf, 50).toFixed(0)}  |  Std Dev: ${stddev(allProf).toFixed(1)}`);
  console.log(`  P10: ${percentile(allProf, 10).toFixed(0)}  |  P25: ${percentile(allProf, 25).toFixed(0)}  |  P75: ${percentile(allProf, 75).toFixed(0)}  |  P90: ${percentile(allProf, 90).toFixed(0)}`);
  console.log();

  // Tier counts
  const tierCounts = {};
  for (const t of PROF_TIERS) tierCounts[t.name] = 0;
  for (const u of users) tierCounts[u.profTier]++;
  console.log('  Proficiency Tier Counts:');
  for (const t of PROF_TIERS) {
    const pct = ((tierCounts[t.name] / N) * 100).toFixed(1);
    console.log(`    ${t.name.padEnd(14)} ${String(tierCounts[t.name]).padStart(4)} (${pct}%)`);
  }

  // ── 2. Speed Score Distribution ────────────────────────────────────
  const scoreable = users.filter(u => u.speedScore !== null);
  const tooEarly = users.filter(u => u.speedScore === null);
  const allSpeed = scoreable.map(u => u.speedScore).sort((a, b) => a - b);

  console.log();
  console.log('  [2] SPEED SCORE DISTRIBUTION (0-100, excludes Too Early)');
  console.log(thinLine);
  if (allSpeed.length > 0) {
    console.log(histogram(allSpeed, 10, 0, 100));
    console.log();
    console.log(`  Scoreable users: ${scoreable.length}  |  Too Early: ${tooEarly.length}`);
    console.log(`  Mean: ${mean(allSpeed).toFixed(1)}  |  Median: ${percentile(allSpeed, 50).toFixed(0)}  |  Std Dev: ${stddev(allSpeed).toFixed(1)}`);
    console.log(`  P10: ${percentile(allSpeed, 10).toFixed(0)}  |  P25: ${percentile(allSpeed, 25).toFixed(0)}  |  P75: ${percentile(allSpeed, 75).toFixed(0)}  |  P90: ${percentile(allSpeed, 90).toFixed(0)}`);
  }
  console.log();

  // Speed label counts (include Too Early)
  const labelCounts = { 'Lightning': 0, 'Swift': 0, 'Progressing': 0, 'Warming Up': 0, 'Too Early': 0 };
  for (const u of users) labelCounts[u.speedLabel]++;
  console.log('  Speed Label Counts:');
  for (const label of ['Lightning', 'Swift', 'Progressing', 'Warming Up', 'Too Early']) {
    const pct = ((labelCounts[label] / N) * 100).toFixed(1);
    console.log(`    ${label.padEnd(14)} ${String(labelCounts[label]).padStart(4)} (${pct}%)`);
  }

  // ── 3. Cross-Tabulation ────────────────────────────────────────────
  console.log();
  console.log('  [3] CROSS-TABULATION: Proficiency Tier x Speed Label');
  console.log(thinLine);

  const speedLabelNames = ['Lightning', 'Swift', 'Progressing', 'Warming Up', 'Too Early'];
  const profTierNames = PROF_TIERS.map(t => t.name);

  // Build matrix
  const matrix = {};
  for (const pt of profTierNames) {
    matrix[pt] = {};
    for (const sl of speedLabelNames) matrix[pt][sl] = 0;
  }
  for (const u of users) {
    matrix[u.profTier][u.speedLabel]++;
  }

  // Print header
  const colW = 11;
  let header = '  ' + ''.padEnd(14);
  for (const sl of speedLabelNames) header += sl.padStart(colW);
  header += '   TOTAL'.padStart(colW);
  console.log(header);
  console.log('  ' + '\u2500'.repeat(14 + colW * (speedLabelNames.length + 1)));

  for (const pt of profTierNames) {
    let row = '  ' + pt.padEnd(14);
    let total = 0;
    for (const sl of speedLabelNames) {
      row += String(matrix[pt][sl]).padStart(colW);
      total += matrix[pt][sl];
    }
    row += String(total).padStart(colW);
    console.log(row);
  }
  // Totals row
  let totalsRow = '  ' + 'TOTAL'.padEnd(14);
  for (const sl of speedLabelNames) {
    totalsRow += String(labelCounts[sl]).padStart(colW);
  }
  totalsRow += String(N).padStart(colW);
  console.log('  ' + '\u2500'.repeat(14 + colW * (speedLabelNames.length + 1)));
  console.log(totalsRow);

  // ── 4. Expected Proficiency at Key Day Counts ──────────────────────
  console.log();
  console.log('  [4] EXPECTED PROFICIENCY CURVE (E(t) at key active-day counts)');
  console.log(thinLine);
  const dayPoints = [3, 5, 7, 10, 15, 20, 25, 30, 40, 50, 60, 75, 90, 120];
  for (const d of dayPoints) {
    const e = getExpectedProficiency(d);
    const bar = '\u2588'.repeat(Math.round(e / 2));
    console.log(`  Day ${String(d).padStart(3)}: E(t) = ${e.toFixed(1).padStart(5)}  ${bar}`);
  }
  console.log();
  console.log('  Note: For non-tech users with median ~10 active days,');
  console.log(`  E(10) = ${getExpectedProficiency(10).toFixed(1)}, meaning expected proficiency is ~${Math.round(getExpectedProficiency(10))}/100.`);
  console.log(`  Their actual proficiency (median ~${percentile(allProf, 50).toFixed(0)}) vs expected (${Math.round(getExpectedProficiency(percentile(allDays, 50)))}) determines speed.`);

  // ── 5. Outlier Analysis ────────────────────────────────────────────
  console.log();
  console.log('  [5] OUTLIER ANALYSIS');
  console.log(thinLine);

  // Highest speed scores
  const bySpeed = [...scoreable].sort((a, b) => b.speedScore - a.speedScore);
  console.log();
  console.log('  Top 10 Highest Speed Scores:');
  console.log('  ' + 'ID'.padStart(6) + 'Days'.padStart(6) + 'Prof'.padStart(6) + 'Exp'.padStart(6) + 'Speed'.padStart(7) + '  Label         Tier');
  for (let i = 0; i < Math.min(10, bySpeed.length); i++) {
    const u = bySpeed[i];
    console.log(`  ${String(u.id).padStart(6)}${String(u.activeDays).padStart(6)}${String(u.proficiency).padStart(6)}${String(u.expected).padStart(6)}${String(u.speedScore).padStart(7)}  ${u.speedLabel.padEnd(14)}${u.profTier}`);
  }

  // Lowest speed scores (excluding zero-proficiency users to be interesting)
  const bySpeedLow = [...scoreable].filter(u => u.proficiency > 0).sort((a, b) => a.speedScore - b.speedScore);
  console.log();
  console.log('  Top 10 Lowest Speed Scores (proficiency > 0):');
  console.log('  ' + 'ID'.padStart(6) + 'Days'.padStart(6) + 'Prof'.padStart(6) + 'Exp'.padStart(6) + 'Speed'.padStart(7) + '  Label         Tier');
  for (let i = 0; i < Math.min(10, bySpeedLow.length); i++) {
    const u = bySpeedLow[i];
    console.log(`  ${String(u.id).padStart(6)}${String(u.activeDays).padStart(6)}${String(u.proficiency).padStart(6)}${String(u.expected).padStart(6)}${String(u.speedScore).padStart(7)}  ${u.speedLabel.padEnd(14)}${u.profTier}`);
  }

  // Dissonant: high proficiency + low speed
  const highProfLowSpeed = scoreable
    .filter(u => u.proficiency >= 30 && u.speedScore <= 25)
    .sort((a, b) => b.proficiency - a.proficiency);
  console.log();
  console.log(`  Dissonant: High Proficiency (>=30) + Low Speed (<=25): ${highProfLowSpeed.length} users`);
  if (highProfLowSpeed.length > 0) {
    console.log('  ' + 'ID'.padStart(6) + 'Days'.padStart(6) + 'Prof'.padStart(6) + 'Exp'.padStart(6) + 'Speed'.padStart(7) + '  Label         Tier');
    for (let i = 0; i < Math.min(8, highProfLowSpeed.length); i++) {
      const u = highProfLowSpeed[i];
      console.log(`  ${String(u.id).padStart(6)}${String(u.activeDays).padStart(6)}${String(u.proficiency).padStart(6)}${String(u.expected).padStart(6)}${String(u.speedScore).padStart(7)}  ${u.speedLabel.padEnd(14)}${u.profTier}`);
    }
    console.log('  => These users have decent skill but took many active days, so the curve');
    console.log('     expects more from them. This is the "slow learner" penalty.');
  }

  // Dissonant: low proficiency + high speed
  const lowProfHighSpeed = scoreable
    .filter(u => u.proficiency <= 10 && u.speedScore >= 50)
    .sort((a, b) => b.speedScore - a.speedScore);
  console.log();
  console.log(`  Dissonant: Low Proficiency (<=10) + High Speed (>=50): ${lowProfHighSpeed.length} users`);
  if (lowProfHighSpeed.length > 0) {
    console.log('  ' + 'ID'.padStart(6) + 'Days'.padStart(6) + 'Prof'.padStart(6) + 'Exp'.padStart(6) + 'Speed'.padStart(7) + '  Label         Tier');
    for (let i = 0; i < Math.min(8, lowProfHighSpeed.length); i++) {
      const u = lowProfHighSpeed[i];
      console.log(`  ${String(u.id).padStart(6)}${String(u.activeDays).padStart(6)}${String(u.proficiency).padStart(6)}${String(u.expected).padStart(6)}${String(u.speedScore).padStart(7)}  ${u.speedLabel.padEnd(14)}${u.profTier}`);
    }
    console.log('  => These users have low skills but very few active days, so the curve');
    console.log('     expected even less. They get "credit" for being early.');
  }

  // ── 6. Speed Score by Active Day Bucket ────────────────────────────
  console.log();
  console.log('  [6] SPEED SCORE BY ACTIVE DAY BUCKET');
  console.log(thinLine);

  const dayBuckets = [
    { lo: 1, hi: 4, label: '1-4 (Too Early)' },
    { lo: 5, hi: 7, label: '5-7 days' },
    { lo: 8, hi: 10, label: '8-10 days' },
    { lo: 11, hi: 15, label: '11-15 days' },
    { lo: 16, hi: 25, label: '16-25 days' },
    { lo: 26, hi: 40, label: '26-40 days' },
    { lo: 41, hi: 90, label: '41-90 days' },
  ];

  console.log('  ' + 'Bucket'.padEnd(20) + 'N'.padStart(5) + 'Avg Prof'.padStart(10)
    + 'Avg E(t)'.padStart(10) + 'Avg Speed'.padStart(11) + 'Med Speed'.padStart(11));
  for (const bucket of dayBuckets) {
    const inBucket = users.filter(u => u.activeDays >= bucket.lo && u.activeDays <= bucket.hi);
    const scoreableInBucket = inBucket.filter(u => u.speedScore !== null);
    const avgProf = mean(inBucket.map(u => u.proficiency));
    const avgExpected = mean(scoreableInBucket.map(u => u.expected ?? 0));
    const speeds = scoreableInBucket.map(u => u.speedScore).sort((a, b) => a - b);
    const avgSpeed = speeds.length > 0 ? mean(speeds) : NaN;
    const medSpeed = speeds.length > 0 ? percentile(speeds, 50) : NaN;
    console.log('  ' + bucket.label.padEnd(20)
      + String(inBucket.length).padStart(5)
      + avgProf.toFixed(1).padStart(10)
      + (isNaN(avgExpected) ? 'N/A' : avgExpected.toFixed(1)).padStart(10)
      + (isNaN(avgSpeed) ? 'N/A' : avgSpeed.toFixed(1)).padStart(11)
      + (isNaN(medSpeed) ? 'N/A' : medSpeed.toFixed(0)).padStart(11));
  }

  // ── 7. What it takes to reach each Speed Label ─────────────────────
  console.log();
  console.log('  [7] WHAT IT TAKES TO REACH EACH SPEED LABEL');
  console.log(thinLine);
  console.log();
  console.log('  Proficiency needed for each speed label at various active-day counts:');
  console.log('  (Solving: speedScore >= threshold for the label\'s minimum)');
  console.log();

  const thresholds = [
    { label: 'Lightning (75+)', minSpeed: 75 },
    { label: 'Swift (50+)',     minSpeed: 50 },
    { label: 'Progressing (25+)', minSpeed: 25 },
  ];

  // For a given day count, what proficiency yields the speed threshold?
  // Uses dynamic sensitivity: baseSens * (1 + E(t)/100)
  // speed = round(sigmoid((prof - E) / dynamicSens) * 100) >= threshold
  // We need: sigmoid(x) >= (minSpeed - 0.5) / 100  (accounting for rounding)
  function profNeeded(days, minSpeed) {
    const E = getExpectedProficiency(days);
    const dynamicSens = SPEED_CURVE_CONFIG.sensitivity * (1 + E / 100);
    // Account for round(): we need sigmoid(x)*100 >= minSpeed - 0.5
    const targetRaw = (minSpeed - 0.5) / 100;
    const x = Math.log(targetRaw / (1 - targetRaw));
    const prof = E + dynamicSens * x;
    return Math.ceil(Math.max(0, prof));
  }

  const checkDays = [3, 5, 7, 10, 15, 20, 25, 30, 40, 60];
  let headerLine = '  ' + 'Days'.padEnd(8);
  for (const t of thresholds) headerLine += t.label.padStart(18);
  console.log(headerLine);
  console.log('  ' + '\u2500'.repeat(8 + 18 * thresholds.length));
  for (const d of checkDays) {
    let row = '  ' + String(d).padEnd(8);
    for (const t of thresholds) {
      const needed = profNeeded(d, t.minSpeed);
      const note = needed > 100 ? '  (>100)' : needed <= 0 ? '  (any)' : '';
      row += (String(needed) + note).padStart(18);
    }
    console.log(row);
  }

  // ── 8. Key Insights ────────────────────────────────────────────────
  console.log();
  console.log('  [8] KEY INSIGHTS & STRUCTURAL ANALYSIS');
  console.log(line);
  console.log();

  const lightningCount = labelCounts['Lightning'];
  const lightningPct = ((lightningCount / N) * 100).toFixed(1);
  const swiftCount = labelCounts['Swift'];
  const swiftPct = ((swiftCount / N) * 100).toFixed(1);
  const warmingUpCount = labelCounts['Warming Up'];
  const warmingUpPct = ((warmingUpCount / N) * 100).toFixed(1);
  const tooEarlyCount = labelCounts['Too Early'];
  const tooEarlyPct = ((tooEarlyCount / N) * 100).toFixed(1);
  const progressingCount = labelCounts['Progressing'];
  const progressingPct = ((progressingCount / N) * 100).toFixed(1);

  const lightningUsers = scoreable.filter(u => u.speedLabel === 'Lightning');
  const lightningAvgProf = lightningUsers.length > 0 ? mean(lightningUsers.map(u => u.proficiency)).toFixed(1) : 'N/A';
  const lightningAvgDays = lightningUsers.length > 0 ? mean(lightningUsers.map(u => u.activeDays)).toFixed(1) : 'N/A';

  console.log('  1. LIGHTNING REACHABILITY');
  console.log(`     ${lightningCount} users (${lightningPct}%) achieved Lightning.`);
  if (lightningUsers.length > 0) {
    console.log(`     Avg proficiency: ${lightningAvgProf}, Avg active days: ${lightningAvgDays}`);
    console.log(`     Lightning is achievable but RARE for non-tech users.`);
    console.log(`     Requires being ahead of the S-curve's expectations.`);
  } else {
    console.log('     Lightning is essentially unreachable for non-tech users.');
  }

  console.log();
  console.log('  2. DISTRIBUTION FAIRNESS');
  console.log(`     The speed distribution for non-tech users:`);
  console.log(`       Too Early:  ${tooEarlyPct}% (${tooEarlyCount} users with <${SPEED_CURVE_CONFIG.minDays} active days)`);
  console.log(`       Warming Up: ${warmingUpPct}% (${warmingUpCount} users)`);
  console.log(`       Progressing: ${progressingPct}% (${progressingCount} users)`);
  console.log(`       Swift:      ${swiftPct}% (${swiftCount} users)`);
  console.log(`       Lightning:  ${lightningPct}% (${lightningCount} users)`);

  const topHeavy = (lightningCount + swiftCount) / scoreable.length;
  const bottomHeavy = warmingUpCount / scoreable.length;
  console.log();
  if (bottomHeavy > 0.6) {
    console.log('     ISSUE: >60% of scoreable users land in "Warming Up".');
    console.log('     The curve may be TOO PUNISHING for non-tech users who have');
    console.log('     low proficiency AND few active days (S-curve floor effect).');
  } else if (topHeavy > 0.5) {
    console.log('     ISSUE: >50% land in Swift/Lightning — speed might be too easy.');
  } else {
    console.log('     Distribution looks reasonably spread across labels.');
  }

  console.log();
  console.log('  3. THE S-CURVE FLOOR PROBLEM');
  const lowDayLowProf = scoreable.filter(u => u.activeDays <= 10 && u.proficiency <= 15);
  const ldlpSpeeds = lowDayLowProf.map(u => u.speedScore).sort((a, b) => a - b);
  if (ldlpSpeeds.length > 0) {
    console.log(`     Users with <=10 active days AND <=15 proficiency: ${lowDayLowProf.length}`);
    console.log(`     Their speed scores: mean=${mean(ldlpSpeeds).toFixed(1)}, median=${percentile(ldlpSpeeds, 50).toFixed(0)}`);
    console.log(`     At low day counts, E(t) is also low (E(10)=${getExpectedProficiency(10).toFixed(1)}).`);
    console.log('     So even a proficiency of 10 can yield a decent speed score');
    console.log('     because the curve "expected" similarly low proficiency.');
    console.log('     This is BY DESIGN: early users should not be punished.');
  }

  console.log();
  console.log('  4. HIGH-DAY PENALTY');
  const highDay = scoreable.filter(u => u.activeDays >= 30);
  if (highDay.length > 0) {
    const highDaySpeeds = highDay.map(u => u.speedScore).sort((a, b) => a - b);
    console.log(`     Users with >=30 active days: ${highDay.length}`);
    console.log(`     Speed scores: mean=${mean(highDaySpeeds).toFixed(1)}, median=${percentile(highDaySpeeds, 50).toFixed(0)}`);
    console.log(`     At 30 days, E(30)=${getExpectedProficiency(30).toFixed(1)} — the curve expects ~${Math.round(getExpectedProficiency(30))}/100 proficiency.`);
    console.log('     Non-tech users rarely exceed that, so they get penalized.');
    console.log('     This is the biggest structural concern: veteran non-tech users');
    console.log('     may feel PUNISHED for using the tool consistently.');
  }

  console.log();
  console.log('  5. SENSITIVITY PARAMETER ANALYSIS');
  console.log(`     Current sensitivity: ${SPEED_CURVE_CONFIG.sensitivity}`);
  console.log('     This controls the "spread" of the sigmoid normalization.');
  console.log('     Higher sensitivity => more forgiving (deviation matters less).');
  console.log('     Lower sensitivity => more punishing (small deviations amplified).');
  console.log(`     With sensitivity=${SPEED_CURVE_CONFIG.sensitivity}, a user who is ${SPEED_CURVE_CONFIG.sensitivity} points ABOVE expected gets speed ~73.`);
  console.log(`     A user who is ${SPEED_CURVE_CONFIG.sensitivity} points BELOW expected gets speed ~27.`);
  console.log(`     Zero deviation => speed = 50 (Swift/Progressing boundary).`);

  console.log();
  console.log(line);
  console.log('  END OF SIMULATION REPORT');
  console.log(line);
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════════════
const users = generateUsers();
printReport(users);
