'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Resolve all Claude Code artifact paths and git scan roots.
 * v12: adds temporal data paths for speed scoring.
 * @param {string|null} overridePath - Optional --path flag value to limit git scanning
 * @returns {object} All resolved paths
 */
function resolve(overridePath) {
  const home = os.homedir();
  const claudeRoot = path.join(home, '.claude');

  const paths = {
    claudeRoot,
    rulesDir:        path.join(claudeRoot, 'rules'),
    settingsPath:    path.join(claudeRoot, 'settings.json'),
    statsPath:       path.join(claudeRoot, 'stats-cache.json'),
    commandsDir:     path.join(claudeRoot, 'commands'),
    agentsDir:       path.join(claudeRoot, 'agents'),
    teamsDir:        path.join(claudeRoot, 'teams'),
    plansDir:        path.join(claudeRoot, 'plans'),
    todosDir:        path.join(claudeRoot, 'todos'),
    pluginsDir:      path.join(claudeRoot, 'plugins'),
    agentMemoryDir:  path.join(claudeRoot, 'agent-memory'),
    keybindingsPath: path.join(claudeRoot, 'keybindings.json'),
    blocklistPath:   path.join(claudeRoot, 'plugins', 'blocklist.json'),
    skillsCacheDir:  path.join(claudeRoot, 'plugins', 'cache'),

    // v12: Temporal data paths for speed scoring
    projectsDir:     path.join(claudeRoot, 'projects'),
  };

  // Resolve git scan roots
  paths.gitScanRoots = resolveGitRoots(home, overridePath);

  return paths;
}

/**
 * Find directories containing .git — either from --path flag or common locations.
 * Scans one level deep to find repos. Max 50 repos to prevent slowdowns.
 */
function resolveGitRoots(home, overridePath) {
  if (overridePath) {
    return scanForGitRepos(overridePath);
  }

  // Common development directories to scan
  const candidateDirs = [
    path.join(home, 'Downloads'),
    path.join(home, 'Documents'),
    path.join(home, 'projects'),
    path.join(home, 'repos'),
    path.join(home, 'dev'),
    path.join(home, 'code'),
    path.join(home, 'src'),
    path.join(home, 'workspace'),
    path.join(home, 'Desktop'),
  ];

  const repos = [];
  for (const dir of candidateDirs) {
    if (repos.length >= 50) break;
    const found = scanForGitRepos(dir);
    for (const repo of found) {
      if (repos.length >= 50) break;
      repos.push(repo);
    }
  }

  return repos;
}

/**
 * Scan a directory up to 2 levels deep for .git folders.
 * Returns array of repo root paths.
 */
function scanForGitRepos(rootDir) {
  const repos = [];
  try {
    // Check if rootDir itself is a git repo
    if (isGitRepo(rootDir)) {
      repos.push(rootDir);
    }

    // Scan one level of children
    const children = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (child.name.startsWith('.') || child.name === 'node_modules') continue;
      const childPath = path.join(rootDir, child.name);
      if (isGitRepo(childPath)) {
        repos.push(childPath);
        continue;
      }

      // Scan two levels deep
      try {
        const grandchildren = fs.readdirSync(childPath, { withFileTypes: true });
        for (const gc of grandchildren) {
          if (!gc.isDirectory()) continue;
          if (gc.name.startsWith('.') || gc.name === 'node_modules') continue;
          const gcPath = path.join(childPath, gc.name);
          if (isGitRepo(gcPath)) {
            repos.push(gcPath);
          }
        }
      } catch {
        // Permission denied or other error — skip
      }
    }
  } catch {
    // Root dir doesn't exist or isn't readable — skip
  }
  return repos;
}

function isGitRepo(dirPath) {
  try {
    const stat = fs.statSync(path.join(dirPath, '.git'));
    // .git can be a directory (normal repo) or a file (worktrees/submodules)
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

module.exports = { resolve };
