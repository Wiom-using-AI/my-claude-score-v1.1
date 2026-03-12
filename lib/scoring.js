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

/**
 * Calculate the combined headline score (v1.1).
 * Expert consensus: true weighted arithmetic mean — 65% proficiency, 35% speed.
 *
 * Three independent experts (gamification, psychometrics, product psychology)
 * converged on this formula after analyzing 5+ alternative approaches
 * (geometric, harmonic, power means, piecewise, anchor-boost).
 *
 * Design principles:
 * - All three scores (combined, proficiency, speed) are independent 0-100 scales
 * - Combined CAN be lower than proficiency when speed < proficiency
 * - Combined = proficiency when speed = proficiency (idempotent)
 * - Sensitivity: 3.5 points per 10-point speed change (motivating for beginners)
 * - No floor/ceiling needed: at S=0, combined = 0.65*P (mathematically safe)
 * - Monotonic: improving either input always improves combined
 *
 * When speed is null (too early to measure), combined = proficiency.
 *
 * Key scenarios:
 *   P=25, S=70  → 41  (Week-2 enthusiast crosses 40-threshold — the critical moment)
 *   P=15, S=80  → 38  (Beginner fast learner gets real encouragement)
 *   P=15, S=20  → 17  (Beginner slow — close to proficiency, no punishment)
 *   P=45, S=75  → 56  (Intermediate fast — solidly in Artisan territory)
 *   P=45, S=30  → 40  (Intermediate slow — drops a tier, honest signal)
 *   P=79, S=94  → 84  (Veteran fast — rewarded for rapid mastery)
 *   P=79, S=30  → 62  (Veteran slow — meaningful gap, not punishing)
 *   P=50, S=50  → 50  (Average both — perfectly neutral)
 *   P=50, S=null → 50  (No speed data — clean fallback)
 *
 * @param {number} proficiency - Proficiency score (0-100)
 * @param {number|null} speed - Speed score (0-100) or null
 * @returns {number} Combined score (0-100)
 */
const PROFICIENCY_WEIGHT = 0.65;
const SPEED_WEIGHT = 0.35;

function calculateCombinedScore(proficiency, speed) {
  if (speed === null || speed === undefined) {
    return Math.round(proficiency);
  }
  const combined = PROFICIENCY_WEIGHT * proficiency + SPEED_WEIGHT * speed;
  return Math.round(Math.max(0, Math.min(100, combined)));
}

module.exports = { computeScore, calculateCombinedScore, PROFICIENCY_WEIGHT, SPEED_WEIGHT };
