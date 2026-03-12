'use strict';

// ── Tier Definitions ──────────────────────────────────────────────────

const TIERS = [
  {
    name: 'Master',
    emoji: '\uD83C\uDFC6',  // 🏆
    minScore: 81,
    flavor: 'You have mastered Claude Code across all dimensions.',
    minBalance: 5,  // each dimension must be >= 5/20
  },
  {
    name: 'Pro',
    emoji: '\u2B50',  // ⭐
    minScore: 61,
    flavor: 'A power user who gets the most out of Claude Code.',
    minBalance: 3,  // each dimension must be >= 3/20 (softened from 5)
  },
  {
    name: 'Skilled',
    emoji: '\uD83D\uDD27',  // 🔧
    minScore: 41,
    flavor: 'You know your way around Claude Code and use it with intention.',
    minBalance: 0,
  },
  {
    name: 'Explorer',
    emoji: '\uD83E\uDDED',  // 🧭
    minScore: 21,
    flavor: 'Building good habits and starting to unlock real power.',
    minBalance: 0,
  },
  {
    name: 'Beginner',
    emoji: '\uD83C\uDF31',  // 🌱
    minScore: 0,
    flavor: 'Every expert was once a beginner. Your journey starts now.',
    minBalance: 0,
  },
];

// ── Archetype Definitions ─────────────────────────────────────────────

const DIMENSION_ARCHETYPES = {
  'Configuration Mastery': 'Config Pro',
  'Tool Fluency': 'Tool Expert',
  'Workflow Maturity': 'Workflow Builder',
  'Automation & Git': 'Automation Pro',
  'Knowledge & Security': 'Security Expert',
};

// Compound titles when two top dimensions are within 2 points (Pro+)
const COMPOUND_TITLES = {
  'Config Pro + Tool Expert': 'Full-Stack Optimizer',
  'Config Pro + Workflow Builder': 'Config + Workflow Pro',
  'Config Pro + Automation Pro': 'DevOps Pro',
  'Config Pro + Security Expert': 'Config + Security Pro',
  'Tool Expert + Workflow Builder': 'Tools + Workflow Pro',
  'Tool Expert + Automation Pro': 'Tools + Automation Pro',
  'Tool Expert + Security Expert': 'Tools + Security Pro',
  'Workflow Builder + Automation Pro': 'Workflow + Automation Pro',
  'Workflow Builder + Security Expert': 'Workflow + Security Pro',
  'Automation Pro + Security Expert': 'Automation + Security Pro',
};

/**
 * Determine tier based on score + per-tier balance constraint.
 * Sage requires every dimension >= 5/20.
 * Virtuoso requires every dimension >= 3/20 (softened).
 * Lower tiers have no balance requirement.
 */
function classifyTier(totalScore, dimensions) {
  for (const tier of TIERS) {
    if (totalScore >= tier.minScore) {
      // Check per-tier balance constraint
      if (tier.minBalance > 0) {
        const meetsBalance = dimensions.every(d => d.score >= tier.minBalance);
        if (!meetsBalance) continue; // Fall through to next tier
      }
      return { ...tier };
    }
  }

  // Fallback (shouldn't happen)
  return { ...TIERS[TIERS.length - 1] };
}

/**
 * Resolve archetype based on highest-scoring dimension.
 * For Virtuoso+ tiers, if top 2 dimensions are within 2 points,
 * produce a compound title.
 */
function resolveArchetype(dimensions, tier) {
  if (!dimensions || dimensions.length === 0) return 'Explorer';

  // Sort dimensions by score descending
  const sorted = [...dimensions].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1];

  const topArchetype = DIMENSION_ARCHETYPES[top.dimension] || 'Explorer';

  // Only compound for Pro+ tiers
  if (['Pro', 'Master'].includes(tier.name) && second) {
    const gap = top.score - second.score;
    if (gap <= 2) {
      const secondArchetype = DIMENSION_ARCHETYPES[second.dimension] || 'Explorer';
      const compoundKey = `${topArchetype} + ${secondArchetype}`;
      const reverseKey = `${secondArchetype} + ${topArchetype}`;
      return COMPOUND_TITLES[compoundKey] || COMPOUND_TITLES[reverseKey] || topArchetype;
    }
  }

  return topArchetype;
}

module.exports = { classifyTier, resolveArchetype, TIERS };
