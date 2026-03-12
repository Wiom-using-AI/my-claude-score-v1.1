'use strict';

const path = require('path');
const fs = require('fs');
const {
  safeReadFile,
  safeReadJson,
  wordCount,
  listFiles,
  countFiles,
  fileExistsAndNonEmpty,
  clamp,
} = require('../utils');

// Domain-specific keywords to look for in rules files.
const DOMAIN_KEYWORDS = [
  'security', 'credentials', 'api', 'database', 'testing',
  'lint', 'style', 'deploy', 'ci/cd', 'docker',
  'architecture', 'pattern', 'convention', 'workflow',
];

// Top-level settings keys that indicate meaningful customization.
const CUSTOMIZATION_KEYS = [
  'hooks', 'env', 'mcpServers', 'enabledPlugins',
  'theme', 'model', 'allowedTools', 'deniedTools',
];

/**
 * Signal 1: Rules quality (0-7 pts) — TIERED
 */
function checkRulesQuality(rulesDir) {
  const signal = {
    name: 'Rules quality',
    value: 'No rules files',
    points: 0,
    maxPoints: 7,
    recommendation: 'Create rules files in ~/.claude/rules/ to guide Claude\'s behavior across projects',
  };

  try {
    const files = listFiles(rulesDir, '.md');
    const fileCount = files.length;
    if (fileCount === 0) return signal;

    let totalWords = 0;
    let combinedText = '';
    for (const filePath of files) {
      const content = safeReadFile(filePath);
      if (content) {
        totalWords += wordCount(content);
        combinedText += ' ' + content;
      }
    }

    const lowerText = combinedText.toLowerCase();
    const domainHits = DOMAIN_KEYWORDS.filter(kw => lowerText.includes(kw)).length;

    signal.value = `${fileCount} file${fileCount !== 1 ? 's' : ''}, ${totalWords.toLocaleString()} words, ${domainHits} domain keyword${domainHits !== 1 ? 's' : ''}`;

    if (fileCount >= 4 && totalWords >= 1000 && domainHits >= 7) signal.points = 7;
    else if (fileCount >= 3 && totalWords >= 1000 && domainHits >= 5) signal.points = 6;
    else if (fileCount >= 3 && totalWords >= 500 && domainHits >= 3) signal.points = 5;
    else if (fileCount >= 2 && totalWords >= 500) signal.points = 4;
    else if (fileCount >= 2 && totalWords >= 300) signal.points = 3;
    else if (totalWords >= 100) signal.points = 2;
    else signal.points = 1;

    if (signal.points >= 6) signal.recommendation = null;
    else if (signal.points >= 4) signal.recommendation = 'Add more domain-specific keywords (security, testing, deployment, architecture) and aim for 1000+ words total';
    else if (signal.points >= 2) signal.recommendation = 'Expand your rules files \u2014 add more files covering different aspects of your workflow (500+ words across 2+ files)';
    else signal.recommendation = 'Add more detail to your rules files \u2014 thorough rules (100+ words) give Claude much better context';
  } catch {
    // Directory unreadable
  }

  return signal;
}

/**
 * Signal 2: Project-level CLAUDE.md (0-5 pts)
 */
function checkProjectClaudeMd(gitScanRoots) {
  const signal = {
    name: 'Project-level CLAUDE.md',
    value: '0 repos with CLAUDE.md',
    points: 0,
    maxPoints: 5,
    recommendation: null,
  };

  try {
    const roots = Array.isArray(gitScanRoots) ? gitScanRoots : [];
    let foundCount = 0;

    for (const repoRoot of roots) {
      const claudeMdPath = path.join(repoRoot, 'CLAUDE.md');
      if (fileExistsAndNonEmpty(claudeMdPath)) foundCount++;
    }

    signal.value = `${foundCount} repo${foundCount !== 1 ? 's' : ''} with CLAUDE.md (of ${roots.length} scanned)`;

    if (foundCount === 0) signal.points = 0;
    else if (foundCount === 1) signal.points = 1;
    else if (foundCount === 2) signal.points = 2;
    else if (foundCount === 3) signal.points = 3;
    else if (foundCount === 4) signal.points = 4;
    else signal.points = 5;
  } catch {
    // Scan failure
  }

  if (signal.points < 2) {
    signal.recommendation = 'Add CLAUDE.md files to your project repos for project-specific context and conventions';
  }

  return signal;
}

/**
 * Signal 3: Settings customization (0-4 pts)
 */
function checkSettingsCustomization(settingsPath) {
  const signal = {
    name: 'Settings customization',
    value: 'No settings file',
    points: 0,
    maxPoints: 4,
    recommendation: null,
  };

  try {
    const settings = safeReadJson(settingsPath);
    if (!settings || typeof settings !== 'object') {
      signal.value = 'No settings file or invalid JSON';
      signal.points = 0;
    } else {
      const topKeys = Object.keys(settings);
      const customKeys = topKeys.filter(k => CUSTOMIZATION_KEYS.includes(k));

      signal.value = `${customKeys.length} customization key${customKeys.length !== 1 ? 's' : ''} (${customKeys.join(', ') || 'none'})`;

      if (customKeys.length === 0) signal.points = 0;
      else if (customKeys.length === 1) signal.points = 1;
      else if (customKeys.length === 2) signal.points = 2;
      else if (customKeys.length === 3) signal.points = 3;
      else signal.points = 4;
    }
  } catch {
    // Parse failure
  }

  if (signal.points < 3) {
    signal.recommendation = 'Customize ~/.claude/settings.json with hooks, MCP servers, allowed tools, or environment variables';
  }

  return signal;
}

/**
 * Signal 4: Custom permissions (0-4 pts)
 */
function checkCustomPermissions(paths) {
  const signal = {
    name: 'Custom permissions',
    value: 'No custom permissions',
    points: 0,
    maxPoints: 4,
    recommendation: null,
  };

  try {
    let pts = 0;
    const details = [];

    const settings = safeReadJson(paths.settingsPath);
    if (settings && typeof settings === 'object') {
      if (Array.isArray(settings.allowedTools) && settings.allowedTools.length > 0) {
        pts += 1;
        details.push(`allowedTools (${settings.allowedTools.length})`);
      }
      if (Array.isArray(settings.deniedTools) && settings.deniedTools.length > 0) {
        pts += 1;
        details.push(`deniedTools (${settings.deniedTools.length})`);
      }
      if (Array.isArray(settings.allowedTools) && settings.allowedTools.length > 0 &&
          Array.isArray(settings.deniedTools) && settings.deniedTools.length > 0) {
        pts += 1;
        details.push('fine-grained allow/deny');
      }
    }

    const gitRoots = Array.isArray(paths.gitScanRoots) ? paths.gitScanRoots : [];
    let localSettingsFound = false;
    for (const repoRoot of gitRoots) {
      const localSettingsPath = path.join(repoRoot, '.claude', 'settings.local.json');
      if (fileExistsAndNonEmpty(localSettingsPath)) {
        localSettingsFound = true;
        break;
      }
    }
    if (localSettingsFound) {
      pts += 1;
      details.push('project-level settings.local.json');
    }

    signal.points = Math.min(pts, 4);
    signal.value = details.length > 0 ? details.join(', ') : 'No custom permissions configured';
  } catch {
    // Read failure
  }

  if (signal.points < 2) {
    signal.recommendation = 'Configure allowedTools / deniedTools in settings.json to control Claude\'s permissions per-project';
  }

  return signal;
}

function scan(paths) {
  const signals = [
    checkRulesQuality(paths.rulesDir),
    checkProjectClaudeMd(paths.gitScanRoots),
    checkSettingsCustomization(paths.settingsPath),
    checkCustomPermissions(paths),
  ];

  const rawScore = signals.reduce((sum, s) => sum + s.points, 0);
  const score = clamp(rawScore, 0, 20);

  return {
    dimension: 'Configuration Mastery',
    score,
    maxScore: 20,
    signals,
  };
}

module.exports = { scan };
