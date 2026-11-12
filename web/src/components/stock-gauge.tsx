import { cn, formatCount } from '../lib/format';

/**
 * Signature element: a bin-label fill gauge.
 *   solid    = available (sellable now)
 *   hatched  = reserved (on the shelf, promised to an order)
 *   tick     = reorder threshold
 * The scale is max(onHand, threshold × 2) so the threshold tick is always
 * visible and a nearly-empty bin reads as nearly empty.
 */
export function StockGauge({
  onHand,
  reserved,
  threshold,
  low,
  className,
}: {
  onHand: number;
  reserved: number;
  threshold: number;
  low: boolean;
  className?: string;
}) {
  const scale = Math.max(onHand, threshold * 2, 1);
  const available = onHand - reserved;
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const label = `${formatCount(available)} available, ${formatCount(reserved)} reserved, reorder at ${formatCount(threshold)}`;

  return (
    <div role="img" aria-label={label} className={cn('relative h-2 w-full min-w-24 rounded-[2px] bg-shelf', className)}>
      <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-[2px]" style={{ width: pct(onHand) }}>
        <div className={cn('h-full', low ? 'bg-amber' : 'bg-ink-2')} style={{ width: onHand ? `${(available / onHand) * 100}%` : 0 }} />
        <div className="hatch h-full flex-1 opacity-70" />
      </div>
      {threshold > 0 && (
        <div aria-hidden className="absolute -inset-y-1 w-px bg-ink" style={{ left: pct(threshold) }} />
      )}
    </div>
  );
}
