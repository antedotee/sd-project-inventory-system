import { type ComponentProps, type ReactNode, useId } from 'react';
import { cn } from '../lib/format';

/* Button ----------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'sm';

const buttonBase =
  'relative inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-sheet hover:bg-ink-2',
  secondary: 'bg-sheet text-ink shadow-[inset_0_0_0_1px_var(--color-rule-strong)] hover:bg-shelf',
  ghost: 'text-ink-2 hover:bg-shelf hover:text-ink',
  danger: 'bg-stop text-sheet hover:bg-stop/90',
};

const buttonSizes: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  // Visually compact for table rows; the ::after extends the hit area to 40px.
  sm: 'h-8 px-3 text-[13px] after:absolute after:-inset-y-1 after:inset-x-0',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props} />;
}

/* Form fields -------------------------------------------------------------- */

// text-base below sm: iOS Safari zooms into any input under 16px on focus.
const controlClass =
  'h-10 w-full rounded-md bg-well px-3 text-base text-ink placeholder:text-ink-4 sm:text-sm ' +
  'shadow-[inset_0_0_0_1px_var(--color-rule)] focus-visible:outline-2 focus-visible:outline-ink ' +
  'aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-stop)] disabled:opacity-60';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  className?: string;
}

/** Label + control + hint/error, wired with aria-describedby and aria-invalid. */
export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-stop">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClass, 'pr-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlClass, 'h-auto min-h-20 py-2', className)} {...props} />;
}

/** Errors that belong to the whole form, announced to screen readers. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-stop-wash px-3 py-2 text-[13px] font-medium text-stop">
      {message}
    </p>
  );
}

/* Page structure ---------------------------------------------------------- */

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('overflow-hidden rounded-lg bg-sheet shadow-[0_0_0_1px_var(--color-rule)]', className)}
      {...props}
    />
  );
}

/* Tables ------------------------------------------------------------------- */

export function Table({ className, wrapperClassName, ...props }: ComponentProps<'table'> & { wrapperClassName?: string }) {
  return (
    <div className={cn('overflow-x-auto', wrapperClassName)}>
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, numeric, ...props }: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 border-b border-rule bg-shelf/60 px-4 text-xs font-medium text-ink-3',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, numeric, ...props }: ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn('h-11 border-b border-rule px-4 align-middle', numeric && 'text-right tabular-nums', className)}
      {...props}
    />
  );
}

/**
 * Narrow-screen alternative to a table: one card per row, every action kept.
 * Pages render the <Table> with `hidden md:block` and this list with `md:hidden`
 * (Stock uses `lg`, its table is wider);
 * display:none removes the hidden copy from the accessibility tree.
 */
export function MobileList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ul aria-label={label} className={cn('divide-y divide-rule', className ?? 'md:hidden')}>
      {children}
    </ul>
  );
}

export function MobileItem({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn('flex flex-col gap-3 px-4 py-4', className)}>{children}</li>;
}

/* States ------------------------------------------------------------------- */

export function TableSkeleton({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-11 items-center gap-6 border-b border-rule px-4">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="h-3 flex-1 rounded-sm bg-shelf" style={{ maxWidth: c === 1 ? 240 : 96 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Every empty state offers exactly one next action. */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-ink-3">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <p className="font-medium text-ink">This could not be loaded</p>
      <p className="mt-1 max-w-sm text-ink-3">{message}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between px-4 py-3 text-[13px] text-ink-3">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

/* Status chips -------------------------------------------------------------- */

type Tone = 'neutral' | 'attention' | 'go' | 'stop';
const tones: Record<Tone, string> = {
  neutral: 'bg-shelf text-ink-2',
  attention: 'bg-amber-wash text-amber-ink',
  go: 'bg-go-wash text-go',
  stop: 'bg-stop-wash text-stop',
};

export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-sm px-2 text-xs font-medium', tones[tone])}>{children}</span>
  );
}

export function Sku({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] text-ink-2">{children}</span>;
}
