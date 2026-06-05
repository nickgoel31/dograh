export type BillingMode = 'per_minute' | 'per_30s';
export type TierKey = 'Tier 1' | 'Tier 2' | 'Tier 3a' | 'Tier 3b' | 'Tier 4';

export interface TierConfig {
  label: string;
  maxCalls: number;
}

export const DEFAULT_TIER_THRESHOLDS: TierConfig[] = [
  { label: 'Tier 1', maxCalls: 5000 },
  { label: 'Tier 2', maxCalls: 25000 },
  { label: 'Tier 3a', maxCalls: 50000 },
  { label: 'Tier 3b', maxCalls: 100000 },
  { label: 'Tier 4', maxCalls: Infinity }, // anything above 100k
];

export const DEFAULT_PRICES: Record<string, Record<BillingMode, number>> = {
  'Tier 1': {
    per_minute: 5.71,
    per_30s: 3.06,
  },
  'Tier 2': {
    per_minute: 4.83,
    per_30s: 2.58,
  },
  'Tier 3a': {
    per_minute: 4.53,
    per_30s: 2.43,
  },
  'Tier 3b': {
    per_minute: 4.04,
    per_30s: 2.17,
  },
  'Tier 4': {
    per_minute: 3.60,
    per_30s: 1.96,
  },
};

export interface BillingConfiguration {
  tiers: TierConfig[];
  prices: Record<string, Record<BillingMode, number>>;
}

/**
 * Returns the number of billable units for a call.
 * per_minute: rounded up to the nearest minute.
 * per_30s: rounded up to the nearest 30s pulse.
 */
export function getBillableUnits(durationSeconds: number, mode: BillingMode): number {
  if (mode === 'per_minute') {
    return Math.ceil(durationSeconds / 60);
  } else {
    return Math.ceil(durationSeconds / 30);
  }
}

/**
 * Returns the tier based on the total monthly call count.
 */
export function getTier(monthlyCallCount: number, thresholds: TierConfig[] = DEFAULT_TIER_THRESHOLDS): TierKey | string {
  for (const threshold of thresholds) {
    if (threshold.maxCalls === null || monthlyCallCount <= threshold.maxCalls) {
      return threshold.label;
    }
  }
  // Fallback to the last tier if no match
  return thresholds.length > 0 ? thresholds[thresholds.length - 1].label : 'Tier 4';
}

/**
 * Returns the next tier's configuration to display how close the user is,
 * or null if they are on the highest tier.
 */
export function getNextTier(monthlyCallCount: number, thresholds: TierConfig[] = DEFAULT_TIER_THRESHOLDS): TierConfig | null {
  for (let i = 0; i < thresholds.length; i++) {
    const threshold = thresholds[i];
    if (threshold.maxCalls === null || monthlyCallCount <= threshold.maxCalls) {
      if (i < thresholds.length - 1) {
        return thresholds[i + 1];
      }
      return null;
    }
  }
  return null;
}

/**
 * Returns the selling price per unit for a given tier and mode.
 */
export function getPricePerUnit(tier: TierKey | string, mode: BillingMode, prices: Record<string, Record<BillingMode, number>> = DEFAULT_PRICES): number {
  return prices[tier]?.[mode] ?? DEFAULT_PRICES[tier]?.[mode] ?? 0;
}

/**
 * Returns the charge for a single call in ₹.
 */
export function calculateCallCharge(
  durationSeconds: number,
  tier: TierKey | string,
  mode: BillingMode,
  prices: Record<string, Record<BillingMode, number>> = DEFAULT_PRICES
): number {
  return getBillableUnits(durationSeconds, mode) * getPricePerUnit(tier, mode, prices);
}
