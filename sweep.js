#!/usr/bin/env node
'use strict';

// Quick parameter sweep to find optimal BASE sensitivity value
// Tests base sensitivity from 8 to 25 with DYNAMIC sensitivity formula:
//   dynamicSens = baseSens * (1 + E(t)/100)
// Shows distribution for each base value

const SEED_BASE = 42;
const N = 1000;

const SPEED_CURVE_BASE = { L: 95, k: 0.035, t0: 75, minDays: 5 };

const SPEED_LABELS = [
  { min: 75, label: 'Lightning' },
  { min: 50, label: 'Swift' },
  { min: 25, label: 'Progressing' },
  { min: 0,  label: 'Warming Up' },
];

// ── PRNG (Mulberry32) ──────────────────────────────────────────────
let _seed;
function initSeed(s) { _seed = s; }
function rand() {
  _seed |= 0;
  _seed = _seed + 0x6D2B79F5 | 0;
  let t = Math.imul(_seed ^ _seed >>> 15, 1 | _seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function randNormal(mean, stddev) {
  const u1 = Math.max(1e-10, rand()), u2 = rand();
  return mean + stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function randGamma(shape, scale) {
  if (shape < 1) return randGamma(shape + 1, scale) * Math.pow(rand(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do { x = randNormal(0, 1); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}
function randBeta(a, b) {
  const x = randGamma(a, 1), y = randGamma(b, 1);
  return x / (x + y);
}

function getExpectedProficiency(days) {
  const { L, k, t0 } = SPEED_CURVE_BASE;
  return L / (1 + Math.exp(-k * (days - t0)));
}

// Dynamic sensitivity formula: baseSens * (1 + E(t)/100)
function computeSpeedScore(actualProficiency, effectiveDays, baseSens) {
  if (effectiveDays < SPEED_CURVE_BASE.minDays) return null;
  if (actualProficiency === 0) return 0;
  const expected = getExpectedProficiency(effectiveDays);
  const deviation = actualProficiency - expected;
  const dynamicSens = baseSens * (1 + expected / 100);
  const normalized = deviation / dynamicSens;
  const sigmoid = 1 / (1 + Math.exp(-normalized));
  return Math.round(sigmoid * 100);
}

function getSpeedLabel(score) {
  if (score === null) return 'Too Early';
  for (const tier of SPEED_LABELS) if (score >= tier.min) return tier.label;
  return 'Warming Up';
}

function generateUsers() {
  initSeed(SEED_BASE);
  const users = [];
  for (let i = 0; i < N; i++) {
    let activeDays;
    if (rand() < 0.10) {
      activeDays = Math.round(25 + randGamma(2.5, 6));
      activeDays = Math.min(activeDays, 90);
    } else {
      activeDays = Math.round(randGamma(2.2, 4.5));
      activeDays = Math.max(1, Math.min(activeDays, 30));
    }
    let proficiency;
    const cohort = rand();
    if (cohort < 0.80) proficiency = Math.round(randBeta(2, 12) * 60);
    else if (cohort < 0.95) proficiency = Math.round(randBeta(3, 7) * 70);
    else proficiency = Math.round(randBeta(4, 5) * 80);
    proficiency = Math.max(0, Math.min(100, proficiency));
    if (activeDays > 15) {
      const bonus = Math.round(rand() * Math.min(8, (activeDays - 15) * 0.3));
      proficiency = Math.min(100, proficiency + bonus);
    }
    users.push({ activeDays, proficiency });
  }
  return users;
}

// ── Run sweep ────────────────────────────────────────────────────────
const users = generateUsers();
const sensitivityValues = [8, 10, 12, 14, 16, 18, 20, 25];

function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

console.log('\u2550'.repeat(76));
console.log('  SENSITIVITY PARAMETER SWEEP (dynamic sens, 1000 non-tech users)');
console.log('  Formula: dynamicSens = baseSens * (1 + E(t)/100)');
console.log('\u2550'.repeat(76));
console.log();

const header = 'Base'.padStart(6)
  + 'Mean'.padStart(7) + 'StdDev'.padStart(8) + 'P10'.padStart(6) + 'P90'.padStart(6)
  + '  \u26A1Lgtn'.padStart(8) + '  \uD83C\uDFC3Swift'.padStart(9) + '  \uD83D\uDCC8Prog'.padStart(9) + '  \uD83C\uDF05Warm'.padStart(9)
  + '  Range'.padStart(8);
console.log(header);
console.log('\u2500'.repeat(80));

for (const sens of sensitivityValues) {
  const results = users.map(u => {
    const speed = computeSpeedScore(u.proficiency, u.activeDays, sens);
    return { speed, label: getSpeedLabel(speed) };
  });

  const scoreable = results.filter(r => r.speed !== null);
  const speeds = scoreable.map(r => r.speed).sort((a, b) => a - b);

  const labels = { Lightning: 0, Swift: 0, Progressing: 0, 'Warming Up': 0, 'Too Early': 0 };
  for (const r of results) labels[r.label]++;

  const p10 = speeds[Math.floor(speeds.length * 0.1)] || 0;
  const p90 = speeds[Math.floor(speeds.length * 0.9)] || 0;

  const lgtnPct = ((labels.Lightning / N) * 100).toFixed(1);
  const swiftPct = ((labels.Swift / N) * 100).toFixed(1);
  const progPct = ((labels.Progressing / N) * 100).toFixed(1);
  const warmPct = ((labels['Warming Up'] / N) * 100).toFixed(1);

  console.log(
    String(sens).padStart(6)
    + mean(speeds).toFixed(1).padStart(7)
    + stddev(speeds).toFixed(1).padStart(8)
    + String(p10).padStart(6)
    + String(p90).padStart(6)
    + (lgtnPct + '%').padStart(8)
    + (swiftPct + '%').padStart(9)
    + (progPct + '%').padStart(9)
    + (warmPct + '%').padStart(9)
    + (p90 - p10 + ' pts').padStart(8)
  );
}

console.log();
console.log('\u2500'.repeat(80));
console.log('  IDEAL TARGET: All 4 labels meaningfully populated.');
console.log('  Lightning 5-10%, Swift 25-35%, Progressing 35-45%, Warming Up 12-18%');
console.log('  StdDev > 15, P10-P90 range > 30 pts');
console.log();

// Also show what happens at specific user profiles for the best candidates
console.log('\u2550'.repeat(76));
console.log('  PROFILE TESTS (what score does each profile get?)');
console.log('  Using dynamic sensitivity: baseSens * (1 + E(t)/100)');
console.log('\u2550'.repeat(76));
console.log();

const profiles = [
  { name: 'Newbie (5d, prof 5)',          days: 5,  prof: 5 },
  { name: 'Beginner (7d, prof 10)',       days: 7,  prof: 10 },
  { name: 'Avg non-tech (10d, prof 12)',  days: 10, prof: 12 },
  { name: 'Engaged (15d, prof 25)',       days: 15, prof: 25 },
  { name: 'Power non-tech (20d, prof 40)', days: 20, prof: 40 },
  { name: 'Veteran low (50d, prof 15)',   days: 50, prof: 15 },
  { name: 'Veteran decent (50d, prof 35)', days: 50, prof: 35 },
  { name: 'Dev user (10d, prof 79)',      days: 10, prof: 79 },
  { name: 'Dev veteran (30d, prof 85)',   days: 30, prof: 85 },
];

let profileHeader = '  Profile'.padEnd(38);
for (const sens of [10, 12, 14, 16, 18, 20]) profileHeader += `s=${sens}`.padStart(7);
console.log(profileHeader);
console.log('  ' + '\u2500'.repeat(78));

for (const p of profiles) {
  let row = `  ${p.name}`.padEnd(38);
  for (const sens of [10, 12, 14, 16, 18, 20]) {
    const score = computeSpeedScore(p.prof, p.days, sens);
    const label = getSpeedLabel(score);
    const abbr = label === 'Lightning' ? '\u26A1' : label === 'Swift' ? '\uD83C\uDFC3' : label === 'Progressing' ? '\uD83D\uDCC8' : '\uD83C\uDF05';
    row += `${score}${abbr}`.padStart(7);
  }
  console.log(row);
}

console.log();
