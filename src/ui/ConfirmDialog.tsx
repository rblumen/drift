import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling (red) for the confirm button. Both current call sites (Reset, Remove account) use this. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Reusable styled replacement for window.confirm() (issue #151). Modeled on
// HowItWorksDrawer's a11y pattern (scrim + inert-when-closed) but scoped to a
// small centered dialog with role="alertdialog" — appropriate for a single
// confirm/cancel decision rather than a navigable panel.
//
// Accessibility:
//   - role="alertdialog", aria-modal, aria-labelledby the title
//   - initial focus on Cancel (the safer default action)
//   - Escape cancels; Tab is trapped within the dialog
//   - backdrop click cancels
//   - focus returns to the trigger element that was focused before open
export function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive = false,
  onConfirm, onCancel,
}: Props) {
  const dialogRef  = useRef<HTMLDivElement>(null);
  const cancelRef  = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId    = 'confirm-dialog-title';

  // Remember the trigger and move focus to Cancel when the dialog opens;
  // restore focus to the trigger when it closes.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      cancelRef.current?.focus();
    } else {
      triggerRef.current?.focus();
      triggerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;

      // Trap Tab within the dialog's two buttons. There are only ever two
      // focusable elements here, so Tab/Shift+Tab always just toggles
      // between them — handle it explicitly rather than relying on native
      // tab order (which some test/DOM environments don't simulate).
      const focusable = [cancelRef.current, confirmRef.current].filter(
        (el): el is HTMLButtonElement => el != null
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      e.preventDefault();
      if (e.shiftKey) {
        active === first || !dialogRef.current?.contains(active) ? last.focus() : first.focus();
      } else {
        active === last || !dialogRef.current?.contains(active) ? first.focus() : last.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <>
      {/* Scrim — click cancels */}
      <div
        onClick={onCancel}
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-[rgba(17,22,29,0.34)]"
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onCancel}>
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-[0_20px_50px_-15px_rgba(17,22,29,0.35)] px-5 py-4"
        >
          <h2 id={titleId} className="font-semibold text-[15px] text-gray-900">
            {title}
          </h2>
          <p className="text-[13px] text-gray-500 leading-relaxed mt-1.5">
            {message}
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              ref={cancelRef}
              onClick={onCancel}
              className="text-gray-500 text-sm px-3 py-1.5 rounded-md hover:bg-gray-100"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              onClick={onConfirm}
              className={
                destructive
                  ? 'bg-red-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-red-700'
                  : 'bg-brand-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-brand-700'
              }
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
