'use strict';

const { style, fg, visibleLength, padEnd, padStart } = require('./ansi');

// ── Double-line box-drawing ─────────────────────────────────────────
const DB = {
  tl: '\u2554', tr: '\u2557', bl: '\u255A', br: '\u255D',
  h: '\u2550', v: '\u2551',
};
const W = 30; // Compact badge width

function scoreColor(score, max) {
  const pct = score / max;
  if (pct >= 0.8)  return fg.brightGreen;
  if (pct >= 0.55) return fg.yellow;
  if (pct >= 0.3)  return fg.orange;
  return fg.red;
}

function tierColor(tierName) {
  const map = {
    Sage: fg.brightGreen,
    Virtuoso: fg.brightCyan,
    Artisan: fg.yellow,
    Craftsperson: fg.orange,
    Apprentice: fg.red,
  };
  return map[tierName] || fg.white;
}

function speedLabelColor(label) {
  const map = {
    Lightning: fg.brightCyan,
    Swift: fg.brightGreen,
    Steady: fg.yellow,
    'Warming Up': fg.orange,
  };
  return map[label] || fg.gray;
}

function miniBar(score, max, width = 8) {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  const color = scoreColor(score, max);
  return color('\u2588'.repeat(filled)) + fg.gray('\u2591'.repeat(empty));
}

function badgeLine(content) {
  const vbar = fg.cyan(DB.v);
  const inner = padEnd(content, W - 4);
  return `${vbar} ${inner} ${vbar}`;
}

// Short dimension abbreviations for the badge
const ABBR = {
  'Configuration Mastery': 'CFG',
  'Tool Fluency':          'TLS',
  'Workflow Maturity':     'WFL',
  'Automation & Git':      'AUT',
  'Knowledge & Security':  'SEC',
};

/**
 * Render the compact badge.
 * v12: adds speed score display.
 * @param {{ dimensions, totalScore, maxScore }} scoring
 * @param {{ name, emoji }} tier
 * @param {string} archetype
 * @param {object|null} speedResult - Speed result from speed.js
 * @returns {string}
 */
function renderBadge(scoring, tier, archetype, speedResult = null) {
  const lines = [];

  lines.push('');
  lines.push(fg.cyan(DB.tl + DB.h.repeat(W - 2) + DB.tr));

  // Title line
  lines.push(badgeLine(style.bold('  my-claude-score')));

  // Tier + proficiency score
  const scoreStr = `${tier.emoji} ${tierColor(tier.name)(style.bold(tier.name))} ${fg.brightWhite(style.bold(String(scoring.totalScore)))}${fg.gray('/100')}`;
  lines.push(badgeLine(` ${scoreStr}`));

  // Speed score (v12)
  if (speedResult && speedResult.score !== null) {
    const sColor = speedLabelColor(speedResult.label);
    const speedStr = `${speedResult.emoji} ${sColor(style.bold(speedResult.label))} ${fg.brightWhite(style.bold(String(speedResult.score)))}${fg.gray('/100')}`;
    lines.push(badgeLine(` ${speedStr}`));
  } else if (speedResult) {
    lines.push(badgeLine(` ${fg.gray('\u23F3 Speed: measuring...')}`));
  }

  // Archetype
  lines.push(badgeLine(` ${fg.cyan(archetype)}`));

  // Separator
  lines.push(fg.cyan(DB.v) + fg.gray(' ' + '\u2500'.repeat(W - 4) + ' ') + fg.cyan(DB.v));

  // Dimension mini bars
  for (const dim of scoring.dimensions) {
    const abbr = ABBR[dim.dimension] || dim.dimension.slice(0, 3).toUpperCase();
    const label = padEnd(` ${abbr}`, 5);
    const bar = miniBar(dim.score, dim.maxScore, 8);
    const pts = scoreColor(dim.score, dim.maxScore)(padStart(String(dim.score), 2));
    lines.push(badgeLine(`${label} ${bar} ${pts}`));
  }

  lines.push(fg.cyan(DB.bl + DB.h.repeat(W - 2) + DB.br));
  lines.push('');

  return lines.join('\n');
}

module.exports = { renderBadge };
