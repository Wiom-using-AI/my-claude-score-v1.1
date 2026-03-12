'use strict';

const { style, fg, bg, visibleLength, padEnd, padStart, truncate } = require('./ansi');
const { safeReadJson } = require('./utils');

// ── Box-drawing characters ──────────────────────────────────────────
const BOX = {
  tl: '\u256D', tr: '\u256E', bl: '\u2570', br: '\u256F',
  h: '\u2500', v: '\u2502',
  ltee: '\u251C', rtee: '\u2524',
};
const WIDTH = 76;

// ── Color coding by score ───────────────────────────────────────────
function scoreColor(score, max) {
  const pct = score / max;
  if (pct >= 0.8)  return fg.brightGreen;
  if (pct >= 0.55) return fg.yellow;
  if (pct >= 0.3)  return fg.orange;
  return fg.red;
}

function tierColor(tierName) {
  const map = {
    Master: fg.brightGreen,
    Pro: fg.brightCyan,
    Skilled: fg.yellow,
    Explorer: fg.orange,
    Beginner: fg.red,
  };
  return map[tierName] || fg.white;
}

function speedLabelColor(label) {
  const map = {
    Lightning: fg.brightCyan,
    Swift: fg.brightGreen,
    Progressing: fg.yellow,
    'Warming Up': fg.orange,
    'Too Early': fg.gray,
    'No Data': fg.gray,
    Unknown: fg.gray,
  };
  return map[label] || fg.white;
}

// ── Progress bar ────────────────────────────────────────────────────
function progressBar(score, max, width = 20) {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  const color = scoreColor(score, max);
  const bar = color('\u2588'.repeat(filled)) + fg.gray('\u2591'.repeat(empty));
  return bar;
}

// ── Horizontal rule ─────────────────────────────────────────────────
function hRule() {
  return fg.gray(BOX.ltee + BOX.h.repeat(WIDTH - 2) + BOX.rtee);
}

function topBorder() {
  return fg.gray(BOX.tl + BOX.h.repeat(WIDTH - 2) + BOX.tr);
}

function bottomBorder() {
  return fg.gray(BOX.bl + BOX.h.repeat(WIDTH - 2) + BOX.br);
}

function line(content) {
  const vbar = fg.gray(BOX.v);
  // Truncate content that would overflow the box, then pad to fill
  const safe = truncate(content, WIDTH - 4);
  const inner = padEnd(safe, WIDTH - 4);
  return `${vbar} ${inner} ${vbar}`;
}

function emptyLine() {
  return line('');
}

// ── Dimension short names ───────────────────────────────────────────
const SHORT_NAMES = {
  'Configuration Mastery': 'Config',
  'Tool Fluency':          'Tools',
  'Workflow Maturity':     'Workflow',
  'Automation & Git':      'Automation',
  'Knowledge & Security':  'Knowledge',
};

// ── Next-steps prioritization ───────────────────────────────────────
const SIGNAL_PRIORITY = {
  'Project-level CLAUDE.md':    { impact: 1, minTier: 'Beginner' },
  'Rules quality':              { impact: 1, minTier: 'Beginner' },
  'Security rules file':        { impact: 1, minTier: 'Beginner' },
  'Active plans':               { impact: 1, minTier: 'Beginner' },
  'Plugins enabled':            { impact: 1, minTier: 'Beginner' },
  'MCP servers configured':     { impact: 1, minTier: 'Beginner' },
  'No hardcoded secrets':       { impact: 1, minTier: 'Beginner' },
  'Claude co-authored commits': { impact: 1, minTier: 'Beginner' },

  'Custom slash commands':      { impact: 2, minTier: 'Explorer' },
  'Settings customization':     { impact: 2, minTier: 'Explorer' },
  'Usage activity':             { impact: 2, minTier: 'Explorer' },
  'Commit message quality':     { impact: 2, minTier: 'Explorer' },
  'Hooks configured':           { impact: 2, minTier: 'Explorer' },
  'Agent depth':                { impact: 2, minTier: 'Explorer' },
  'Todo usage':                 { impact: 2, minTier: 'Explorer' },
  'Strategic plugin bonus':     { impact: 2, minTier: 'Explorer' },
  'Skills available':           { impact: 2, minTier: 'Explorer' },
  'Centralized credential references': { impact: 2, minTier: 'Explorer' },
  'Security-adjacent plugins':  { impact: 2, minTier: 'Explorer' },
  'Custom agents':              { impact: 2, minTier: 'Explorer' },
  'Team/swarm usage':           { impact: 2, minTier: 'Explorer' },
  'Agent memory populated':     { impact: 2, minTier: 'Explorer' },

  'Keybindings customized':     { impact: 3, minTier: 'Skilled' },
  'Launch configs':             { impact: 3, minTier: 'Skilled' },
  'Semantic commit prefixes':   { impact: 3, minTier: 'Skilled' },
  'Model diversity':            { impact: 3, minTier: 'Skilled' },
  'Plugin blocklist curation':  { impact: 3, minTier: 'Skilled' },
  'Plugin blocklist with reasons': { impact: 3, minTier: 'Skilled' },
  'Team complexity':            { impact: 3, minTier: 'Skilled' },
  'Workflow explorer':          { impact: 3, minTier: 'Skilled' },

  'Custom permissions':         { impact: 3, minTier: 'Pro' },
  'Security awareness':         { impact: 3, minTier: 'Pro' },
};

const TIER_RANK = {
  'Beginner': 0, 'Explorer': 1, 'Skilled': 2, 'Pro': 3, 'Master': 4,
};

// ── Next-steps: WHAT to do + WHY it helps ───────────────────────────
const RECOMMENDATIONS = {
  'Rules quality':
    'Add more rules files in ~/.claude/rules/ \u2014 Claude reads these before every response, so it follows your coding style and project conventions automatically',
  'Project-level CLAUDE.md':
    'Add CLAUDE.md to your project repos \u2014 gives Claude project-specific context so it writes code that fits your codebase instead of generic code',
  'Settings customization':
    'Customize more settings in settings.json \u2014 tailors Claude to your workflow so you spend less time repeating preferences',
  'Custom permissions':
    'Set allowedTools / deniedTools in settings.json \u2014 controls what Claude can and cannot do, so it does not accidentally run dangerous commands or modify wrong files',
  'MCP servers configured':
    'Connect more MCP servers (GitHub, Slack, etc.) \u2014 lets Claude directly interact with your tools instead of you copy-pasting between apps',
  'Plugins enabled':
    'Enable more plugins \u2014 gives Claude specialized capabilities like code review, security checks, and design tools',
  'Custom slash commands':
    'Create slash commands in ~/.claude/commands/ \u2014 saves your common prompts as shortcuts so you type /review instead of explaining what to do every time',
  'Keybindings customized':
    'Set up keybindings in ~/.claude/keybindings.json \u2014 keyboard shortcuts that save you mouse clicks on actions you repeat often',
  'Plugin blocklist curation':
    'Curate your plugin blocklist with reasons \u2014 prevents Claude from using plugins that do not work well for your use case',
  'Launch configs':
    'Add .claude/launch.json to your projects \u2014 Claude can auto-start your dev server and preview changes in the browser without you running commands manually',
  'Strategic plugin bonus':
    'Enable high-value plugins: security-guidance, code-review, LSPs \u2014 these catch bugs and security issues before they reach production',
  'Custom agents':
    'Create custom agents in ~/.claude/agents/ \u2014 reusable AI specialists (e.g., a debugger, reviewer, or deployer) that you can call by name for specific tasks',
  'Agent depth':
    'Write deeper agent prompts (100+ lines) \u2014 more detailed instructions mean agents make fewer mistakes and need less back-and-forth',
  'Team/swarm usage':
    'Use agent teams for complex tasks \u2014 multiple agents work in parallel (one researches while another codes), finishing faster than one agent alone',
  'Team complexity':
    'Build teams with more specialized members \u2014 like having a senior dev, QA, and architect working together instead of one person doing everything',
  'Active plans':
    'Use plan mode before complex implementations \u2014 Claude maps out the approach first so you can course-correct before it writes 500 lines in the wrong direction',
  'Agent memory populated':
    'Populate agent memory files \u2014 agents remember what worked and what failed across sessions, so they get better at your specific projects over time',
  'Todo usage':
    'Use the todo system for complex tasks \u2014 tracks what is done and what is left, so you can pause and resume without losing context',
  'Workflow explorer':
    'Use both plans and todos together \u2014 plans define what to build, todos track execution, giving you full visibility from idea to completion',
  'Claude co-authored commits':
    'Let Claude co-author more commits \u2014 builds a history of AI-assisted work, making it easy to trace which changes Claude helped with',
  'Commit message quality':
    'Aim for 40-72 character commit subjects \u2014 clear commit messages make your git history readable when you need to find or revert changes later',
  'Semantic commit prefixes':
    'Use feat:/fix:/refactor: prefixes \u2014 lets you auto-generate changelogs and instantly see what kind of change each commit introduced',
  'Usage activity':
    'Use Claude Code more regularly \u2014 the more you use it, the more it learns your patterns and the faster you get results',
  'Model diversity':
    'Try different models (opus for hard problems, haiku for quick tasks) \u2014 saves time and cost by matching the right model to the job',
  'Hooks configured':
    'Set up hooks in settings.json (lint on save, test before commit) \u2014 catches errors automatically so you do not push broken code',
  'Security rules file':
    'Create a security.md rules file \u2014 tells Claude your credential policies so it never accidentally logs API keys or commits secrets',
  'No hardcoded secrets':
    'Remove hardcoded secrets from ~/.claude/ files \u2014 prevents accidental exposure of API keys if you share configs or push to git',
  'Centralized credential references':
    'Reference .env and credential policies in your rules \u2014 Claude will use environment variables instead of hardcoding secrets in your code',
  'Plugin blocklist with reasons':
    'Add reasons to your plugin blocklist entries \u2014 documents why certain plugins are blocked so your team understands the decision',
  'Security-adjacent plugins':
    'Enable security-guidance, code-review, code-simplifier plugins \u2014 automated safety nets that catch vulnerabilities before they ship',
  'Security awareness':
    'Adopt more security practices \u2014 each layer of security reduces the chance of credentials leaking or unsafe code reaching production',
  'Skills available':
    'Enable plugins with skills (superpowers, figma, skill-creator) \u2014 skills are structured workflow templates for brainstorming, debugging, TDD, code review, and more, so Claude follows proven approaches instead of winging it',
};

// ── Main render function ────────────────────────────────────────────
/**
 * Render the full ANSI report.
 * v1.1: combined = 65% proficiency + 35% speed (true blend, can be lower than proficiency).
 * @param {{ dimensions, totalScore, maxScore }} scoring
 * @param {{ name, emoji, flavor }} tier
 * @param {string} archetype
 * @param {{ statsPath }} paths
 * @param {boolean} verbose
 * @param {object|null} speedResult - Speed computation result from speed.js
 * @param {number} combinedScore - Combined headline score (0-100)
 * @returns {string}
 */
function render(scoring, tier, archetype, paths, verbose = false, speedResult = null, combinedScore = null) {
  const lines = [];
  const effectiveCombined = combinedScore !== null ? combinedScore : scoring.totalScore;

  // ── Header ──────────────────────────────────────────────────────
  lines.push('');
  lines.push(topBorder());
  lines.push(emptyLine());

  const titleStr = style.bold('  my-claude-score');
  lines.push(line(titleStr));
  lines.push(emptyLine());

  // Combined headline score — the ONE number
  const combinedBar = progressBar(effectiveCombined, 100, 20);
  const combinedStr = `  ${fg.brightWhite(style.bold(String(effectiveCombined)))}${fg.gray('/100')}  ${combinedBar}`;
  lines.push(line(combinedStr));

  // Tier + archetype on next line
  const tierStr = `  ${tier.emoji}  ${tierColor(tier.name)(style.bold(tier.name))}  ${fg.gray('\u2502')}  ${fg.cyan(archetype)}`;
  lines.push(line(tierStr));
  lines.push(emptyLine());

  // ── Sub-scores: Proficiency + Speed (separate lines) ──────────
  const profLabel = `  ${fg.gray('Proficiency')}   ${fg.brightWhite(style.bold(String(scoring.totalScore)))}${fg.gray('/100')}`;
  lines.push(line(profLabel));
  if (speedResult && speedResult.score !== null) {
    const sColor = speedLabelColor(speedResult.label);
    const speedLabel = `  ${fg.gray('Speed')}         ${sColor(style.bold(String(speedResult.score)))}${fg.gray('/100')}  ${speedResult.emoji} ${sColor(speedResult.label)}`;
    lines.push(line(speedLabel));
  }

  // Speed context line (calendar days, expected vs actual)
  if (speedResult) {
    const speedContext = renderSpeedContext(speedResult, scoring.totalScore);
    for (const sl of speedContext) lines.push(sl);
  }

  lines.push(emptyLine());

  // Wrap flavor text if it's long
  const flavorWrapped = wrapPlainLines(tier.flavor, 2);
  for (const fl of flavorWrapped) {
    lines.push(line(`  ${fg.gray(fl)}`));
  }

  lines.push(hRule());
  lines.push(emptyLine());

  // ── Dimension bars ──────────────────────────────────────────────
  const labelWidth = 13;
  for (const dim of scoring.dimensions) {
    const shortName = SHORT_NAMES[dim.dimension] || dim.dimension;
    const label = padEnd(`  ${shortName}`, labelWidth);
    const bar = progressBar(dim.score, dim.maxScore, 20);
    const scoreStr = scoreColor(dim.score, dim.maxScore)(
      padStart(String(dim.score), 2)
    );
    const maxStr = fg.gray(`/${dim.maxScore}`);

    lines.push(line(`${label} ${bar}  ${scoreStr}${maxStr}`));

    // Verbose mode: show every signal
    if (verbose) {
      if (dim.baselineApplied) {
        lines.push(line(`    ${fg.gray('(baseline floor applied \u2014 active user bonus)')}`));
      }
      for (const sig of dim.signals) {
        const sigScore = scoreColor(sig.points, sig.maxPoints)(
          `${sig.points}/${sig.maxPoints}`
        );
        const sigName = fg.gray(`    ${sig.name}`);
        const sigVal = fg.gray(` (${sig.value})`);
        lines.push(line(`${sigName}${sigVal}  ${sigScore}`));
      }
      lines.push(emptyLine());
    }
  }

  if (!verbose) lines.push(emptyLine());

  // ── Strengths ───────────────────────────────────────────────────
  lines.push(hRule());
  lines.push(emptyLine());
  lines.push(line(`  ${style.bold(fg.brightGreen('\u2726 Strengths'))}`));
  lines.push(emptyLine());

  const allSignals = scoring.dimensions.flatMap(d => d.signals);
  const strengths = [...allSignals]
    .filter(s => s.maxPoints > 0 && s.points > 0)
    .sort((a, b) => (b.points / b.maxPoints) - (a.points / a.maxPoints))
    .slice(0, 3);

  if (strengths.length === 0) {
    lines.push(line(`  ${fg.gray('No strengths yet \u2014 start using Claude Code!')}`));
  } else {
    for (const s of strengths) {
      const pct = Math.round((s.points / s.maxPoints) * 100);
      lines.push(line(`  ${fg.green('\u221A')} ${s.name} ${fg.gray(`(${s.points}/${s.maxPoints} \u2014 ${pct}%)`)}`));
    }
  }

  // ── Next Steps ────────────────────────────────────────────────
  lines.push(emptyLine());
  lines.push(hRule());
  lines.push(emptyLine());
  lines.push(line(`  ${style.bold(fg.yellow('>> Next Steps'))}`));
  lines.push(emptyLine());

  const userTierRank = TIER_RANK[tier.name] || 0;

  const gaps = [...allSignals]
    .filter(s => {
      if (s.maxPoints === 0 || s.points >= s.maxPoints) return false;
      const prio = SIGNAL_PRIORITY[s.name];
      if (prio) {
        const requiredRank = TIER_RANK[prio.minTier] || 0;
        if (userTierRank < requiredRank) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const prioA = (SIGNAL_PRIORITY[a.name] || { impact: 2 }).impact;
      const prioB = (SIGNAL_PRIORITY[b.name] || { impact: 2 }).impact;
      if (prioA !== prioB) return prioA - prioB;
      return (b.maxPoints - b.points) - (a.maxPoints - a.points);
    })
    .slice(0, 3);

  if (gaps.length === 0) {
    lines.push(line(`  ${fg.brightGreen('Perfect score! You have mastered Claude Code.')}`));
  } else {
    for (const g of gaps) {
      const gain = g.maxPoints - g.points;
      const fullRec = RECOMMENDATIONS[g.name] || g.recommendation || `Improve ${g.name}`;

      const dashIdx = fullRec.indexOf(' \u2014 ');
      let whatPart, whyPart;
      if (dashIdx >= 0) {
        whatPart = fullRec.slice(0, dashIdx);
        whyPart = fullRec.slice(dashIdx + 3);
      } else {
        whatPart = fullRec;
        whyPart = '';
      }

      lines.push(line(`  ${fg.yellow('\u25B8')} ${whatPart} ${fg.gray(`(+${gain} pts)`)}`));

      if (whyPart) {
        const whyWrapped = wrapPlainLines(whyPart, 6);
        for (const wl of whyWrapped) {
          lines.push(line(`      ${fg.gray(wl)}`));
        }
      }
      lines.push(emptyLine());
    }
  }

  // ── Stats footer ──────────────────────────────────────────────
  lines.push(hRule());
  lines.push(emptyLine());

  const stats = collectStats(scoring, paths, speedResult);
  lines.push(line(`  ${fg.gray(stats)}`));

  lines.push(emptyLine());
  lines.push(bottomBorder());
  lines.push('');

  return lines.join('\n');
}

// ── Speed interpretation for dual-score dissonance ───────────────────
function getSpeedInterpretation(proficiency, speedResult) {
  if (speedResult.score === null) return null;
  const speed = speedResult.score;

  // Very high both → true power user
  if (proficiency >= 80 && speed >= 70) {
    return '\uD83D\uDD25  Rapid mastery \u2014 you picked up Claude Code exceptionally fast';
  }
  // High proficiency + low speed → experienced long-term user
  if (proficiency >= 50 && speed < 35) {
    return '\u2139\uFE0F  High mastery, patient journey \u2014 consistent long-term learner';
  }
  // Low proficiency + high speed → fast starter, still ramping up
  if (proficiency < 35 && speed >= 50) {
    return '\uD83D\uDE80  Fast starter \u2014 keep building to sustain this momentum';
  }
  // Both moderate → solid middle ground
  if (proficiency >= 35 && proficiency < 60 && speed >= 40 && speed < 65) {
    return '\uD83D\uDCC8  Building steadily \u2014 you are on a good learning trajectory';
  }
  // Low both → early or struggling, encourage
  if (proficiency < 25 && speed < 30) {
    return '\uD83C\uDF31  Just getting started \u2014 explore the Next Steps below to level up';
  }
  return null;
}

// ── Speed context renderer (v12.1) ──────────────────────────────────
// Renders context info below the sub-scores line: dates, calendar days,
// expected vs actual, and optional interpretation.
function renderSpeedContext(speedResult, proficiencyScore) {
  const lines = [];

  if (speedResult.score === null) {
    lines.push(line(`  ${fg.gray('  \u23F3  Speed: measuring... (need more usage data)')}`));
    return lines;
  }

  // Context — since date, calendar days, expected vs actual
  const contextParts = [];
  if (speedResult.firstSessionDate) {
    const d = new Date(speedResult.firstSessionDate + 'T00:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    contextParts.push(`since ${months[d.getMonth()]} ${d.getDate()}`);
  }
  if (speedResult.calendarDays) {
    contextParts.push(`${speedResult.calendarDays} days`);
  }
  if (contextParts.length > 0) {
    lines.push(line(`  ${fg.gray('  ' + contextParts.join('  \u2502  '))}`));
  }

  // Optional: Contextual interpretation for dual-score dissonance
  const interpretation = getSpeedInterpretation(proficiencyScore, speedResult);
  if (interpretation) {
    lines.push(line(`  ${fg.gray('  ' + interpretation)}`));
  }

  return lines;
}

/**
 * Wrap plain text into lines of maxW chars, returning an array of strings.
 */
function wrapPlainLines(text, indent = 0) {
  const maxW = WIDTH - 4 - 2 - indent;
  if (text.length <= maxW) return [text];

  const words = text.split(' ');
  const result = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxW && current) {
      result.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) result.push(current);
  return result;
}

function collectStats(scoring, paths, speedResult) {
  const parts = [];

  // MCP servers
  const mcpSignal = findSignal(scoring, 'MCP servers configured');
  if (mcpSignal) parts.push(`MCP: ${mcpSignal.value}`);

  // Count agents
  const agentSignal = findSignal(scoring, 'Custom agents');
  if (agentSignal) parts.push(`Agents: ${extractNumber(agentSignal.value)}`);

  // Usage stats
  const statsData = safeReadJson(paths.statsPath);
  if (statsData) {
    if (statsData.totalMessages) parts.push(`Msgs: ${statsData.totalMessages.toLocaleString()}`);
  }

  // Speed time (v12.1: calendar days + active days)
  if (speedResult && speedResult.calendarDays) {
    parts.push(`${speedResult.calendarDays}d since start`);
    if (speedResult.activeDays) {
      parts.push(`${speedResult.activeDays}d active`);
    }
  }

  return parts.join('  \u2502  ');
}

function findSignal(scoring, name) {
  for (const dim of scoring.dimensions) {
    for (const sig of dim.signals) {
      if (sig.name === name) return sig;
    }
  }
  return null;
}

function extractNumber(val) {
  if (typeof val === 'number') return val;
  const m = String(val).match(/^(\d+)/);
  return m ? m[1] : val;
}

module.exports = { render };
