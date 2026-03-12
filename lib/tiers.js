'use strict';

// ── Tier Definitions ──────────────────────────────────────────────────

const TIERS = [
  {
    name: 'Sage',
    emoji: '\u2666',  // diamond
    minScore: 81,
    flavor: 'You have achieved mastery across all dimensions of Claude Code.',
    minBalance: 5,  // each dimension must be >= 5/20
  },
  {
    name: 'Virtuoso',
    emoji: '\u25C6',  // filled diamond
    minScore: 61,
    flavor: 'A well-rounded power user pushing the boundaries of what Claude Code can do.',
    minBalance: 3,  // each dimension must be >= 3/20 (softened from 5)
  },
  {
    name: 'Artisan',
    emoji: '\u25B2',  // triangle up
    minScore: 41,
    flavor: 'You wield Claude Code with skill and intention.',
    minBalance: 0,
  },
  {
    name: 'Craftsperson',
    emoji: '\u25A0',  // filled square
    minScore: 21,
    flavor: 'Building solid habits and starting to unlock real power.',
    minBalance: 0,
  },
  {
    name: 'Apprentice',
    emoji: '\u25CB',  // circle
    minScore: 0,
    flavor: 'Every master was once a beginner. Your journey starts now.',
    minBalance: 0,
  },
];

// ── Archetype Definitions ─────────────────────────────────────────────

const DIMENSION_ARCHETYPES = {
  'Configuration Mastery': 'Config Monk',
  'Tool Fluency': 'Plugin Alchemist',
  'Workflow Maturity': 'Workflow Architect',
  'Automation & Git': 'Automation Ninja',
  'Knowledge & Security': 'Knowledge Sentinel',
};

// Compound titles when two top dimensions are within 2 points (Virtuoso+)
const COMPOUND_TITLES = {
  'Config Monk + Plugin Alchemist': 'Systems Philosopher',
  'Config Monk + Workflow Architect': 'Process Sage',
  'Config Monk + Automation Ninja': 'Infrastructure Guru',
  'Config Monk + Knowledge Sentinel': 'Governance Architect',
  'Plugin Alchemist + Workflow Architect': 'Integration Maestro',
  'Plugin Alchemist + Automation Ninja': 'DevOps Alchemist',
  'Plugin Alchemist + Knowledge Sentinel': 'Security Alchemist',
  'Workflow Architect + Automation Ninja': 'Pipeline Virtuoso',
  'Workflow Architect + Knowledge Sentinel': 'Systems Guardian',
  'Automation Ninja + Knowledge Sentinel': 'SecOps Master',
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

  // Only compound for Virtuoso+ tiers
  if (['Virtuoso', 'Sage'].includes(tier.name) && second) {
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
