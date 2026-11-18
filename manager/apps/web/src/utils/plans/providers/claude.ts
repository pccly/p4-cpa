import { normalizeRawPlanType } from '../normalize';
import type { PlanResolverDescriptor } from './types';

const descriptor = (canonicalPlanType: string, labelKey: string, labelDefault: string) =>
  ({
    canonicalPlanType,
    shortLabelKey: labelKey,
    shortDefault: labelDefault,
  }) satisfies PlanResolverDescriptor;

/**
 * Claude quota resolution currently emits the `plan_*` values below. Plain
 * names are accepted as credential compatibility aliases without changing the
 * raw value retained by quota state.
 */
export const CLAUDE_PLAN_DESCRIPTORS: Readonly<Record<string, PlanResolverDescriptor>> = {
  plan_free: descriptor('free', 'plans.claude.free', 'Free'),
  free: descriptor('free', 'plans.claude.free', 'Free'),
  plan_pro: descriptor('pro', 'plans.claude.pro', 'Pro'),
  pro: descriptor('pro', 'plans.claude.pro', 'Pro'),
  plan_max: descriptor('max', 'plans.claude.max', 'Max'),
  max: descriptor('max', 'plans.claude.max', 'Max'),
  plan_max5: descriptor('max', 'plans.claude.max', 'Max'),
  max_5x: descriptor('max', 'plans.claude.max', 'Max'),
  plan_max20: descriptor('max_20x', 'plans.claude.max_20x', 'Ultra'),
  max_20x: descriptor('max_20x', 'plans.claude.max_20x', 'Ultra'),
  plan_team: descriptor('team', 'plans.claude.team', 'Team'),
  team: descriptor('team', 'plans.claude.team', 'Team'),
};

export const resolveClaudePlanDescriptor = (planType: unknown): PlanResolverDescriptor | null => {
  const normalized = normalizeRawPlanType(planType);
  return normalized ? (CLAUDE_PLAN_DESCRIPTORS[normalized] ?? null) : null;
};
