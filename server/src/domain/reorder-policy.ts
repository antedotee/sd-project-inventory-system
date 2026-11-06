/**
 * STRATEGY pattern: how a product decides it is "low on stock".
 *
 * Product holds one ReorderPolicy and delegates to it, so adding a new rule
 * (e.g. "days of cover") is a new class plus one line in `reorderPolicyFrom`.
 * No service changes (Open/Closed).
 */
export type ReorderPolicyConfig =
  | { kind: 'FIXED'; reorderPoint: number }
  | { kind: 'PERCENT_OF_MAX'; maxStock: number; percent: number };

export interface ReorderPolicy {
  readonly kind: ReorderPolicyConfig['kind'];
  /** Available quantity at or below which the product is considered low. */
  threshold(): number;
  shouldAlert(available: number): boolean;
  toConfig(): ReorderPolicyConfig;
}

export class FixedThresholdPolicy implements ReorderPolicy {
  readonly kind = 'FIXED';

  constructor(private readonly reorderPoint: number) {
    if (!Number.isInteger(reorderPoint) || reorderPoint < 0) {
      throw new RangeError('reorderPoint must be a non-negative integer');
    }
  }

  threshold(): number {
    return this.reorderPoint;
  }

  shouldAlert(available: number): boolean {
    return available <= this.reorderPoint;
  }

  toConfig(): ReorderPolicyConfig {
    return { kind: 'FIXED', reorderPoint: this.reorderPoint };
  }
}

export class PercentageOfMaxPolicy implements ReorderPolicy {
  readonly kind = 'PERCENT_OF_MAX';

  constructor(
    private readonly maxStock: number,
    private readonly percent: number,
  ) {
    if (!Number.isInteger(maxStock) || maxStock <= 0) throw new RangeError('maxStock must be a positive integer');
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new RangeError('percent must be 1..100');
  }

  threshold(): number {
    return Math.floor((this.maxStock * this.percent) / 100);
  }

  shouldAlert(available: number): boolean {
    return available <= this.threshold();
  }

  toConfig(): ReorderPolicyConfig {
    return { kind: 'PERCENT_OF_MAX', maxStock: this.maxStock, percent: this.percent };
  }
}

export function reorderPolicyFrom(config: ReorderPolicyConfig): ReorderPolicy {
  switch (config.kind) {
    case 'FIXED':
      return new FixedThresholdPolicy(config.reorderPoint);
    case 'PERCENT_OF_MAX':
      return new PercentageOfMaxPolicy(config.maxStock, config.percent);
  }
}
