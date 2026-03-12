'use strict';

const { execFileSync } = require('child_process');
const { safeReadJson } = require('./utils');

// ── S-curve adoption model (adjustable) ──────────────────────────────
const SPEED_CURVE_CONFIG = {
  L:           95,   // Asymptote: max expected proficiency over time (raised from 85 for Lightning reachability)
  k:           0.035, // Steepness: growth rate of the curve
  t0:          75,   // Midpoint: active days to reach L/2 expected proficiency (shifted from 60 — less aggressive)
  sensitivity: 45,   // Sigmoid normalization spread (widened from 40 — less punishing for new/returning users)
  minDays:     3,    // Minimum observation window before scoring
};

// ── Speed labels (4 tiers) ───────────────────────────────────────────
const SPEED_LABELS = [
  { min: 75, label: 'Lightning', emoji: '\u26A1' },
  { min: 50, label: 'Swift',     emoji: '\uD83C\uDFC3' },
  { min: 25, label: 'Steady',    emoji: '\uD83D\uDC22' },
  { min: 0,  label: 'Warming Up', emoji: '\uD83C\uDF05' },
];

// ── Expected proficiency at day t (logistic S-curve) ─────────────────
function getExpectedProficiency(days) {
  const { L, k, t0 } = SPEED_CURVE_CONFIG;
  return L / (1 + Math.exp(-k * (days - t0)));
}

// ── Speed score via sigmoid normalization ─────────────────────────────
function computeRawSpeedScore(actualProficiency, effectiveDays) {
  if (effectiveDays < SPEED_CURVE_CONFIG.minDays) return null; // too early
  if (actualProficiency === 0) return 0;

  const expected = getExpectedProficiency(effectiveDays);
  const deviation = actualProficiency - expected;
  const normalized = deviation / SPEED_CURVE_CONFIG.sensitivity;
  const sigmoid = 1 / (1 + Math.exp(-normalized));
  return Math.round(sigmoid * 100);
}

// ── Resolve speed label from score ────────────────────────────────────
function getSpeedLabel(speedScore) {
  if (speedScore === null) return { label: 'Too Early', emoji: '\u23F3' };
  for (const tier of SPEED_LABELS) {
    if (speedScore >= tier.min) return tier;
  }
  return SPEED_LABELS[SPEED_LABELS.length - 1];
}

// ── Active time: count unique days with evidence of usage ─────────────
function getActiveDays(statsData, gitScanRoots) {
  const uniqueDates = new Set();

  // Source 1: stats-cache.json dailyActivity
  if (statsData && Array.isArray(statsData.dailyActivity)) {
    for (const entry of statsData.dailyActivity) {
      if (entry && entry.date) uniqueDates.add(entry.date);
    }
  }

  // Source 2: stats-cache.json dailyModelTokens
  if (statsData && Array.isArray(statsData.dailyModelTokens)) {
    for (const entry of statsData.dailyModelTokens) {
      if (entry && entry.date) uniqueDates.add(entry.date);
    }
  }

  // Source 3: git co-authored commit dates across repos
  const repos = Array.isArray(gitScanRoots) ? gitScanRoots : [];
  for (const repo of repos) {
    try {
      const output = execFileSync('git', [
        '-C', repo,
        'log', '--all',
        '--grep=Co-Authored-By',
        '--format=%aI',          // ISO date of each commit
        '-n', '200',
      ], { timeout: 5000, encoding: 'utf-8' });
      if (output) {
        for (const line of output.trim().split(/\r?\n/)) {
          if (!line) continue;
          const dateOnly = line.slice(0, 10); // "YYYY-MM-DD"
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
            uniqueDates.add(dateOnly);
          }
        }
      }
    } catch {
      // git not available or repo error — skip
    }
  }

  return uniqueDates.size;
}

// ── Main speed computation ────────────────────────────────────────────
/**
 * Compute the learning speed score.
 * @param {number} proficiencyScore - Current proficiency (0-100)
 * @param {object} paths - Resolved paths (needs statsPath, gitScanRoots)
 * @returns {{ score: number|null, label: string, emoji: string, effectiveDays: number|null, timeMode: string, expected: number|null }}
 */
function computeSpeed(proficiencyScore, paths) {
  const result = {
    score: null,
    label: 'Unknown',
    emoji: '\u2753',
    effectiveDays: null,
    timeMode: 'active',
    expected: null,
    firstSessionDate: null,
  };

  const statsData = safeReadJson(paths.statsPath);
  if (!statsData || !statsData.firstSessionDate) {
    result.label = 'No Data';
    result.emoji = '\u2753';
    return result;
  }

  result.firstSessionDate = statsData.firstSessionDate;

  // Always use active days — eliminates break/gap penalty
  // (calendar time punishes users who take breaks; active days only count real usage)
  result.timeMode = 'active';
  const effectiveDays = getActiveDays(statsData, paths.gitScanRoots);

  if (!effectiveDays || effectiveDays === 0) {
    result.label = 'No Data';
    result.emoji = '\u2753';
    return result;
  }

  result.effectiveDays = effectiveDays;
  result.expected = Math.round(getExpectedProficiency(effectiveDays));

  // Compute speed score
  const speedScore = computeRawSpeedScore(proficiencyScore, effectiveDays);
  result.score = speedScore;

  // Resolve label
  const labelInfo = getSpeedLabel(speedScore);
  result.label = labelInfo.label;
  result.emoji = labelInfo.emoji;

  return result;
}

module.exports = {
  computeSpeed,
  getExpectedProficiency,
  getSpeedLabel,
  SPEED_CURVE_CONFIG,
  SPEED_LABELS,
};
