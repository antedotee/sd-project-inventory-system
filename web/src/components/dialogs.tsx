import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { cn } from '../lib/format';
import { Button } from './ui';

/*
 * Dialogs use Base UI primitives: focus trap, Escape to close, focus return
 * to the trigger and ARIA wiring come from the library, not hand-rolled code.
 */

const backdrop = 'fixed inset-0 z-40 bg-ink/30';
const popup =
  'fixed top-1/2 left-1/2 z-50 w-[min(92vw,var(--w))] -translate-x-1/2 -translate-y-1/2 ' +
  'max-h-[85dvh] overflow-y-auto overscroll-contain rounded-lg bg-sheet p-6 shadow-[0_0_0_1px_var(--color-rule),0_12px_32px_-8px_rgb(0_0_0/0.18)]';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  width?: number;
  children: ReactNode;
}

export function Modal({ open, onOpenChange, title, description, width = 480, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdrop} />
        <Dialog.Popup className={popup} style={{ '--w': `${width}px` } as React.CSSProperties}>
          <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1 text-ink-3">{description}</Dialog.Description>}
          <div className="mt-5">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
}

/** For destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  pending,
  error,
  onConfirm,
}: ConfirmProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdrop} />
        <AlertDialog.Popup className={cn(popup)} style={{ '--w': '420px' } as React.CSSProperties}>
          <AlertDialog.Title className="text-base font-semibold text-ink">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-ink-3">{description}</AlertDialog.Description>
          {error && (
            <p role="alert" className="mt-4 rounded-md bg-stop-wash px-3 py-2 text-[13px] font-medium text-stop">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close render={<Button>Keep it</Button>} />
            <Button variant={tone} disabled={pending} onClick={onConfirm}>
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
