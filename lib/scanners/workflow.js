'use strict';

const { safeReadJson, safeReaddir, countFiles, lineCount, listFiles, daysAgo, fileExistsAndNonEmpty, dirExists, clamp } = require('../utils');
const path = require('path');
const fs = require('fs');

function scan(paths) {
  const signals = [];
  signals.push(scanCustomAgents(paths));
  signals.push(scanAgentDepth(paths));
  signals.push(scanTeamUsage(paths));
  signals.push(scanTeamComplexity(paths));
  signals.push(scanActivePlans(paths));
  signals.push(scanAgentMemory(paths));
  signals.push(scanTodoUsage(paths));
  signals.push(scanWorkflowExplorer(signals));

  const rawScore = signals.reduce((sum, s) => sum + s.points, 0);
  return { dimension: 'Workflow Maturity', score: clamp(rawScore, 0, 20), maxScore: 20, signals };
}

function scanCustomAgents(paths) {
  const count = countFiles(paths.agentsDir, '.md');
  let points;
  if (count >= 4) points = 4;
  else if (count === 3) points = 3;
  else if (count === 2) points = 2;
  else if (count === 1) points = 1;
  else points = 0;
  return { name: 'Custom agents', value: count, points, maxPoints: 4, recommendation: points < 3 ? 'Create more specialized agents in ~/.claude/agents/ for code review, debugging, or domain-specific workflows.' : null };
}

function scanAgentDepth(paths) {
  const files = listFiles(paths.agentsDir, '.md');
  let avgLines = 0;
  if (files.length > 0) {
    const totalLines = files.reduce((sum, f) => sum + lineCount(f), 0);
    avgLines = Math.round(totalLines / files.length);
  }
  let points;
  if (files.length === 0) points = 0;
  else if (avgLines >= 100) points = 3;
  else if (avgLines >= 60) points = 2;
  else if (avgLines >= 30) points = 1;
  else points = 0;
  return { name: 'Agent depth', value: avgLines, points, maxPoints: 3, recommendation: points < 2 ? 'Write deeper agent prompts (60+ lines) with examples and constraints for more reliable agent behavior.' : null };
}

function scanTeamUsage(paths) {
  const teamCount = countTeamDirs(paths.teamsDir);
  let points;
  if (teamCount >= 3) points = 3;
  else if (teamCount === 2) points = 2;
  else if (teamCount === 1) points = 1;
  else points = 0;
  return { name: 'Team/swarm usage', value: teamCount, points, maxPoints: 3, recommendation: points === 0 ? 'Try creating a team with TeamCreate to coordinate multiple agents on complex tasks.' : null };
}

function countTeamDirs(teamsDir) {
  if (!dirExists(teamsDir)) return 0;
  const entries = safeReaddir(teamsDir);
  let count = 0;
  for (const entry of entries) {
    const configPath = path.join(teamsDir, entry, 'config.json');
    if (fileExistsAndNonEmpty(configPath)) count++;
  }
  return count;
}

function scanTeamComplexity(paths) {
  const maxMembers = getMaxTeamMembers(paths.teamsDir);
  const points = maxMembers >= 3 ? 1 : 0;
  return { name: 'Team complexity', value: maxMembers, points, maxPoints: 1, recommendation: points === 0 ? 'When creating teams, aim for 3+ specialized members for meaningful coordination.' : null };
}

function getMaxTeamMembers(teamsDir) {
  if (!dirExists(teamsDir)) return 0;
  const entries = safeReaddir(teamsDir);
  let max = 0;
  for (const entry of entries) {
    const config = safeReadJson(path.join(teamsDir, entry, 'config.json'));
    if (config && Array.isArray(config.members)) max = Math.max(max, config.members.length);
  }
  return max;
}

function scanActivePlans(paths) {
  const allPlans = listFiles(paths.plansDir, '.md');
  const totalCount = allPlans.length;
  let activeCount = 0;
  for (const filePath of allPlans) {
    if (daysAgo(filePath) <= 14) activeCount++;
  }
  let points;
  if (activeCount >= 6 || totalCount >= 10) points = 3;
  else if (activeCount >= 3) points = 2;
  else if (activeCount >= 1) points = 1;
  else points = 0;
  return { name: 'Active plans', value: `${activeCount} active / ${totalCount} total`, points, maxPoints: 3, recommendation: points === 0 ? 'Use plans to break complex projects into phases \u2014 Claude can reference them across sessions.' : null };
}

function scanAgentMemory(paths) {
  let nonEmptyCount = 0;
  if (dirExists(paths.agentMemoryDir)) {
    const entries = safeReaddir(paths.agentMemoryDir);
    for (const entry of entries) {
      if (fileExistsAndNonEmpty(path.join(paths.agentMemoryDir, entry))) nonEmptyCount++;
    }
  }
  let points;
  if (nonEmptyCount >= 3) points = 2;
  else if (nonEmptyCount >= 1) points = 1;
  else points = 0;
  return { name: 'Agent memory populated', value: nonEmptyCount, points, maxPoints: 2, recommendation: points === 0 ? 'Let agents accumulate learnings across sessions \u2014 this improves their accuracy over time.' : null };
}

function scanTodoUsage(paths) {
  const substantialCount = countSubstantialTodos(paths.todosDir);
  let points;
  if (substantialCount >= 21) points = 3;
  else if (substantialCount >= 6) points = 2;
  else if (substantialCount >= 1) points = 1;
  else points = 0;
  return { name: 'Todo usage', value: substantialCount, points, maxPoints: 3, recommendation: points === 0 ? 'Use TodoWrite to track multi-step tasks \u2014 it helps Claude maintain context and show progress.' : null };
}

function countSubstantialTodos(todosDir) {
  if (!dirExists(todosDir)) return 0;
  const entries = safeReaddir(todosDir);
  let count = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const stat = fs.statSync(path.join(todosDir, entry));
      if (stat.isFile() && stat.size > 10) count++;
    } catch { /* skip */ }
  }
  return count;
}

function scanWorkflowExplorer(otherSignals) {
  const plansSignal = otherSignals.find(s => s.name === 'Active plans');
  const todosSignal = otherSignals.find(s => s.name === 'Todo usage');
  const hasPlans = plansSignal && plansSignal.points >= 1;
  const hasTodos = todosSignal && todosSignal.points >= 1;
  return {
    name: 'Workflow explorer',
    value: hasPlans && hasTodos ? 'Plans + Todos both active' : 'Not enough workflow features used',
    points: (hasPlans && hasTodos) ? 1 : 0,
    maxPoints: 1,
    recommendation: !(hasPlans && hasTodos) ? 'Use both plans and todos in your Claude Code sessions to unlock the workflow explorer bonus' : null,
  };
}

module.exports = { scan };
