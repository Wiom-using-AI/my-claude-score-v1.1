'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { safeReadJson } = require('./utils');

// ── S-curve adoption model (adjustable) ──────────────────────────────
// v12.1: Recalibrated for CALENDAR days (not active days).
// Rationale: active days unfairly benefited infrequent users.
// Now we find the earliest usage date → count calendar days to today.
//
// Calibration data points:
//   E(5)  ≈ 10   — brand new user, minimal expected skill
//   E(14) ≈ 17   — two weeks in, basic familiarity expected
//   E(25) ≈ 28   — ~1 month, matches real-world teammate data (25-35 range)
//   E(60) ≈ 73   — two months, most features explored
//   E(90) ≈ 91   — three months, near mastery expected
const SPEED_CURVE_CONFIG = {
  L:           95,   // Asymptote: max expected proficiency over time
  k:           0.06,  // Steepness: growth rate (raised from 0.035 — faster early ramp)
  t0:          40,   // Midpoint: calendar days to reach L/2 (lowered from 75 — earlier inflection)
  sensitivity: 14,   // Base sigmoid spread (reduced from 45 — fixes score compression)
  minDays:     5,    // Minimum calendar days before scoring
};

// ── Speed labels (4 tiers) ───────────────────────────────────────────
const SPEED_LABELS = [
  { min: 75, label: 'Lightning', emoji: '\u26A1' },
  { min: 50, label: 'Swift',     emoji: '\uD83C\uDFC3' },
  { min: 25, label: 'Progressing', emoji: '\uD83D\uDCC8' },
  { min: 0,  label: 'Warming Up', emoji: '\uD83C\uDF05' },
];

// ── Expected proficiency at day t (logistic S-curve) ─────────────────
function getExpectedProficiency(days) {
  const { L, k, t0 } = SPEED_CURVE_CONFIG;
  return L / (1 + Math.exp(-k * (days - t0)));
}

// ── Speed score via sigmoid normalization ─────────────────────────────
// Uses dynamic sensitivity: baseSens * (1 + E(t)/100) to soften the
// penalty for veteran users whose expected proficiency is high.
// With recalibrated params (calendar days):
// At day 5 (E≈10):  dynSens ≈ 15.5  — tight spread for new users
// At day 25 (E≈29): dynSens ≈ 18.0  — more forgiving as they ramp
// At day 60 (E≈73): dynSens ≈ 24.2  — meaningfully softer for veterans
function computeRawSpeedScore(actualProficiency, effectiveDays) {
  if (effectiveDays < SPEED_CURVE_CONFIG.minDays) return null; // too early
  if (actualProficiency === 0) return 0;

  const expected = getExpectedProficiency(effectiveDays);
  const deviation = actualProficiency - expected;
  // Dynamic sensitivity: widens as expected proficiency grows
  const dynamicSens = SPEED_CURVE_CONFIG.sensitivity * (1 + expected / 100);
  const normalized = deviation / dynamicSens;
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

// ── Collect all unique dates with evidence of usage ───────────────────
// Returns a Set of "YYYY-MM-DD" strings from all available sources.
// Used to find the EARLIEST activity date for calendar day computation.
function collectActivityDates(statsData, gitScanRoots, projectsDir) {
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
        for (const ln of output.trim().split(/\r?\n/)) {
          if (!ln) continue;
          const dateOnly = ln.slice(0, 10); // "YYYY-MM-DD"
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
            uniqueDates.add(dateOnly);
          }
        }
      }
    } catch {
      // git not available or repo error — skip
    }
  }

  // Source 4: Session JSONL files in ~/.claude/projects/
  // These are the most reliable — each session transcript has a modification date.
  // stats-cache.json can go stale, but session files are always current.
  if (projectsDir) {
    scanSessionDates(projectsDir, uniqueDates, 0);
  }

  // Source 5: firstSessionDate from stats-cache.json (may predate all other sources)
  if (statsData && statsData.firstSessionDate) {
    const fsd = statsData.firstSessionDate.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fsd)) {
      uniqueDates.add(fsd);
    }
  }

  return uniqueDates;
}

// ── Calendar days from earliest activity to today ─────────────────────
// v12.1: We use calendar days (not active days) for speed evaluation.
// Active days are only used to discover the start date.
// This is fairer: infrequent users don't get an artificial advantage.
function getCalendarDays(uniqueDates) {
  if (uniqueDates.size === 0) return { calendarDays: 0, earliestDate: null, activeDays: 0 };

  // Find earliest date
  const sorted = [...uniqueDates].sort();
  const earliest = sorted[0];
  const earliestMs = new Date(earliest + 'T00:00:00').getTime();
  const todayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime();
  const calendarDays = Math.max(1, Math.floor((todayMs - earliestMs) / 86400000) + 1); // +1 to include start day

  return {
    calendarDays,
    earliestDate: earliest,
    activeDays: uniqueDates.size,
  };
}

/**
 * Recursively scan for .jsonl session files and extract dates from mtime.
 * Max depth 3 to avoid runaway scans.
 */
function scanSessionDates(dir, dateSet, depth) {
  if (depth > 3) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanSessionDates(full, dateSet, depth + 1);
      } else if (entry.name.endsWith('.jsonl')) {
        try {
          const stat = fs.statSync(full);
          // Use modification date as evidence of activity on that day
          const mdate = stat.mtime.toISOString().slice(0, 10);
          dateSet.add(mdate);
          // Also read first line for session start timestamp
          const fd = fs.openSync(full, 'r');
          const buf = Buffer.alloc(512);
          const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
          fs.closeSync(fd);
          if (bytesRead > 0) {
            const firstLine = buf.toString('utf-8').split('\n')[0];
            try {
              const parsed = JSON.parse(firstLine);
              if (parsed.timestamp) {
                const startDate = new Date(parsed.timestamp).toISOString().slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
                  dateSet.add(startDate);
                }
              }
            } catch {
              // Not valid JSON — skip
            }
          }
        } catch {
          // Permission error or other — skip
        }
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable — skip
  }
}

// ── Main speed computation ────────────────────────────────────────────
/**
 * Compute the learning speed score.
 * v12.1: Uses CALENDAR days from first activity date (not active day count).
 *
 * @param {number} proficiencyScore - Current proficiency (0-100)
 * @param {object} paths - Resolved paths (needs statsPath, gitScanRoots, projectsDir)
 * @returns {{ score: number|null, label: string, emoji: string, calendarDays: number|null, activeDays: number|null, timeMode: string, expected: number|null, firstSessionDate: string|null }}
 */
function computeSpeed(proficiencyScore, paths) {
  const result = {
    score: null,
    label: 'Unknown',
    emoji: '\u2753',
    calendarDays: null,
    activeDays: null,
    // Keep effectiveDays as alias for calendarDays (backward compat for renderers)
    effectiveDays: null,
    timeMode: 'calendar',
    expected: null,
    firstSessionDate: null,
  };

  const statsData = safeReadJson(paths.statsPath);

  // Collect all activity dates from every source
  const uniqueDates = collectActivityDates(statsData, paths.gitScanRoots, paths.projectsDir);

  if (uniqueDates.size === 0) {
    result.label = 'No Data';
    result.emoji = '\u2753';
    return result;
  }

  // Compute calendar days from earliest activity to today
  const { calendarDays, earliestDate, activeDays } = getCalendarDays(uniqueDates);

  if (!calendarDays || calendarDays === 0) {
    result.label = 'No Data';
    result.emoji = '\u2753';
    return result;
  }

  result.firstSessionDate = earliestDate;
  result.calendarDays = calendarDays;
  result.activeDays = activeDays;
  result.effectiveDays = calendarDays; // backward compat
  result.timeMode = 'calendar';
  result.expected = Math.round(getExpectedProficiency(calendarDays));

  // Compute speed score using calendar days
  const speedScore = computeRawSpeedScore(proficiencyScore, calendarDays);
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
