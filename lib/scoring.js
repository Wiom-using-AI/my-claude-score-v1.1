'use strict';

const { clamp } = require('./utils');

/**
 * Active-user baseline floor.
 *
 * If the "Automation & Git" dimension score is >= 4 (indicating the user
 * actively uses Claude Code with real sessions, messages, and git activity),
 * we apply a minimum floor of 2 to every other dimension. This prevents
 * active users from getting 0 in dimensions with hard-to-discover features
 * (like Workflow or Knowledge) purely because they haven't explored them yet.
 *
 * The floor is applied AFTER scanner scoring and BEFORE tier classification.
 */
const ACTIVE_USER_THRESHOLD = 4;   // Automation score that qualifies
const BASELINE_FLOOR = 2;          // Minimum score per dimension for active users

/**
 * Takes an array of 5 scanner results and produces the final scoring object.
 * Clamps each dimension to [0, 20] and applies the active-user baseline floor.
 *
 * @param {object[]} dimensionResults - Array of { dimension, score, maxScore, signals }
 * @returns {{ dimensions: object[], totalScore: number, maxScore: number }}
 */
function computeScore(dimensionResults) {
  const dimensions = dimensionResults.map(d => ({
    ...d,
    score: clamp(d.score, 0, 20),
    maxScore: 20,
  }));

  // Check if user qualifies for active-user baseline
  const automationDim = dimensions.find(d => d.dimension === 'Automation & Git');
  const isActiveUser = automationDim && automationDim.score >= ACTIVE_USER_THRESHOLD;

  if (isActiveUser) {
    for (const dim of dimensions) {
      if (dim.score < BASELINE_FLOOR) {
        dim.score = BASELINE_FLOOR;
        dim.baselineApplied = true;  // Flag for verbose output
      }
    }
  }

  const totalScore = dimensions.reduce((sum, d) => sum + d.score, 0);

  return {
    dimensions,
    totalScore: clamp(totalScore, 0, 100),
    maxScore: 100,
  };
}

module.exports = { computeScore };
