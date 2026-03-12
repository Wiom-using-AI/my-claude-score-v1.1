'use strict';

const { safeReadFile, safeReadJson, wordCount, listFiles, safeReaddir } = require('../utils');
const path = require('path');

const SECRET_PATTERNS = [
  /AKIA[A-Z0-9]{16}/,
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /-----BEGIN.*PRIVATE KEY-----/,
  /Bearer ey[a-zA-Z0-9._-]+/,
];

const CREDENTIAL_KEYWORDS = [
  { category: 'env-file', patterns: ['.env'] },
  { category: 'credential', patterns: ['credential'] },
  { category: 'dotenv', patterns: ['dotenv'] },
  { category: 'secret', patterns: ['secret'] },
  { category: 'vault', patterns: ['vault'] },
  { category: 'env-variable', patterns: ['environment variable'] },
];

const SECURITY_PLUGINS = ['security-guidance', 'code-review', 'code-simplifier'];

function checkSecurityRulesFile(rulesDir) {
  const signal = { name: 'Security rules file', value: 'No security rules file found', points: 0, maxPoints: 5, recommendation: 'Create a security.md rules file to define credential handling policies' };
  try {
    const entries = safeReaddir(rulesDir);
    const securityFiles = entries.filter(f => f.toLowerCase().includes('security') && f.endsWith('.md'));
    if (securityFiles.length === 0) return signal;
    let totalWords = 0;
    for (const fileName of securityFiles) {
      const content = safeReadFile(path.join(rulesDir, fileName));
      totalWords += wordCount(content);
    }
    signal.value = `${securityFiles.length} file${securityFiles.length !== 1 ? 's' : ''}, ${totalWords.toLocaleString()} words`;
    if (totalWords === 0) signal.points = 0;
    else if (totalWords < 100) signal.points = 1;
    else if (totalWords < 300) signal.points = 2;
    else if (totalWords < 500) signal.points = 3;
    else if (totalWords < 1000) signal.points = 4;
    else signal.points = 5;
    if (signal.points >= 4) signal.recommendation = null;
    else if (signal.points >= 1) signal.recommendation = 'Expand your security rules file \u2014 aim for 1000+ words covering credential handling, dependency safety, and code review policies';
  } catch { /* unreadable */ }
  return signal;
}

function checkNoHardcodedSecrets(claudeRoot) {
  const signal = { name: 'No hardcoded secrets', value: '0 files with potential secrets', points: 4, maxPoints: 4, recommendation: null };
  try {
    const SCAN_EXTENSIONS = ['.md', '.json', '.js'];
    const dirsToScan = [claudeRoot, path.join(claudeRoot, 'rules'), path.join(claudeRoot, 'agents')];
    const filesToScan = [];
    for (const dir of dirsToScan) {
      const entries = safeReaddir(dir);
      for (const entry of entries) {
        if (SCAN_EXTENSIONS.includes(path.extname(entry).toLowerCase())) {
          filesToScan.push(path.join(dir, entry));
        }
      }
    }
    let filesWithSecrets = 0;
    for (const filePath of filesToScan) {
      const content = safeReadFile(filePath);
      if (!content) continue;
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) { filesWithSecrets++; break; }
      }
    }
    signal.value = `${filesWithSecrets} file${filesWithSecrets !== 1 ? 's' : ''} with potential secrets`;
    if (filesWithSecrets === 0) signal.points = 4;
    else if (filesWithSecrets === 1) signal.points = 2;
    else signal.points = 0;
    if (filesWithSecrets > 0) signal.recommendation = `Found potential secret patterns in ${filesWithSecrets} file${filesWithSecrets !== 1 ? 's' : ''} \u2014 remove hardcoded credentials and use environment variables instead`;
  } catch { signal.value = 'Scan could not complete'; }
  return signal;
}

function checkCentralizedCredentialRefs(rulesDir) {
  const signal = { name: 'Centralized credential references', value: '0 credential keyword categories found', points: 0, maxPoints: 3, recommendation: 'Add credential management guidelines to your rules files' };
  try {
    const files = listFiles(rulesDir, '.md');
    if (files.length === 0) return signal;
    let combinedText = '';
    for (const filePath of files) { const content = safeReadFile(filePath); if (content) combinedText += ' ' + content; }
    const lowerText = combinedText.toLowerCase();
    const matchedCategories = [];
    for (const kw of CREDENTIAL_KEYWORDS) {
      if (kw.patterns.some(p => lowerText.includes(p))) matchedCategories.push(kw.category);
    }
    const count = matchedCategories.length;
    signal.value = `${count} credential keyword categor${count !== 1 ? 'ies' : 'y'} found (${matchedCategories.join(', ') || 'none'})`;
    signal.points = Math.min(count, 3);
    if (signal.points >= 3) signal.recommendation = null;
    else if (signal.points >= 1) signal.recommendation = 'Expand credential management coverage in your rules';
  } catch { /* read failure */ }
  return signal;
}

function checkBlocklistReasons(blocklistPath) {
  const signal = { name: 'Plugin blocklist with reasons', value: 'No blocklist found', points: 0, maxPoints: 3, recommendation: 'Create a plugin blocklist with documented reasons' };
  try {
    const blocklist = safeReadJson(blocklistPath);
    if (!blocklist) return signal;
    let entries = [];
    if (blocklist.plugins && Array.isArray(blocklist.plugins)) entries = blocklist.plugins;
    else if (Array.isArray(blocklist)) entries = blocklist;
    const withReasons = entries.filter(entry => entry && typeof entry === 'object' && typeof entry.reason === 'string' && entry.reason.trim().length > 0);
    const count = withReasons.length;
    signal.value = `${count} blocklist entr${count !== 1 ? 'ies' : 'y'} with reasons (${entries.length} total entries)`;
    if (count === 0) signal.points = 0;
    else if (count === 1) signal.points = 1;
    else if (count === 2) signal.points = 2;
    else signal.points = 3;
    if (signal.points >= 3) signal.recommendation = null;
    else if (signal.points === 1) signal.recommendation = 'Add documented reasons to more blocklist entries';
  } catch { /* parse failure */ }
  return signal;
}

function checkSecurityPlugins(settingsPath) {
  const signal = { name: 'Security-adjacent plugins', value: 'No security plugins enabled', points: 0, maxPoints: 3, recommendation: 'Enable security-adjacent plugins like security-guidance, code-review, or code-simplifier' };
  try {
    const settings = safeReadJson(settingsPath);
    if (!settings || typeof settings !== 'object') return signal;
    const enabledPlugins = settings.enabledPlugins;
    if (!enabledPlugins || typeof enabledPlugins !== 'object') return signal;
    const enabledKeys = Object.keys(enabledPlugins).filter(k => enabledPlugins[k] === true);
    const lowerKeys = enabledKeys.map(k => k.toLowerCase());
    const matched = SECURITY_PLUGINS.filter(sp => lowerKeys.some(ek => ek.includes(sp)));
    const count = matched.length;
    signal.value = `${count} security plugin${count !== 1 ? 's' : ''} enabled (${matched.join(', ') || 'none'})`;
    if (count === 0) signal.points = 0;
    else if (count === 1) signal.points = 1;
    else if (count === 2) signal.points = 2;
    else signal.points = 3;
    if (signal.points >= 2) signal.recommendation = null;
  } catch { /* parse failure */ }
  return signal;
}

function checkAnySecurityBehavior(otherSignals) {
  const signal = { name: 'Security awareness', value: 'No security behavior detected', points: 0, maxPoints: 2, recommendation: 'Start with any security practice \u2014 create a security rules file, reference .env policies, or enable security plugins' };
  const activeSignals = otherSignals.filter(s => s.points > 0);
  const count = activeSignals.length;
  if (count === 0) return signal;
  const names = activeSignals.map(s => s.name);
  signal.value = `${count} active security practice${count !== 1 ? 's' : ''} (${names.slice(0, 3).join(', ')})`;
  if (count >= 2) signal.points = 2;
  else signal.points = 1;
  if (signal.points >= 2) signal.recommendation = null;
  else signal.recommendation = 'Broaden your security coverage \u2014 add credential references to rules, enable security plugins, and ensure no hardcoded secrets';
  return signal;
}

function scan(paths) {
  const coreSignals = [
    checkSecurityRulesFile(paths.rulesDir),
    checkNoHardcodedSecrets(paths.claudeRoot),
    checkCentralizedCredentialRefs(paths.rulesDir),
    checkBlocklistReasons(paths.blocklistPath),
    checkSecurityPlugins(paths.settingsPath),
  ];
  const behaviorSignal = checkAnySecurityBehavior(coreSignals);
  const signals = [...coreSignals, behaviorSignal];
  const rawScore = signals.reduce((sum, s) => sum + s.points, 0);
  return { dimension: 'Knowledge & Security', score: Math.max(0, Math.min(20, rawScore)), maxScore: 20, signals };
}

module.exports = { scan };
