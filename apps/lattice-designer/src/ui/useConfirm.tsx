// Asking a question from inside a click handler, and awaiting the answer.
//
// `window.confirm()` is synchronous, which is why every destructive control in this
// tool used to be written as `if (!window.confirm(...)) return;`. A themed modal is
// not synchronous — it is a render — so something has to bridge the two, or every
// call site has to be rewritten to hoist its action into per-dialog state ("what was
// I about to do?"), which is exactly how a confirmation ends up guarding one path
// and not another.
//
// `useConfirm` keeps the call sites the shape they already had:
//
//     if (!(await confirm({ title: "Clear the board", message: … }))) return;
//
// The console solves this with a provider and a context (`app/components/
// ConfirmDialog`), because dozens of routed pages need to ask. Here exactly one
// component does, so the hook hands the element back to be rendered instead of
// wrapping the tree in a provider — same promise plumbing, no context, and `<App/>`
// stays a thing that can be rendered on its own in a test.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";

/** What to ask before a consequential action, and how to label the answer. */
export interface ConfirmOptions {
  /** The heading — name the action, e.g. "Resize the board". */
  title: string;
  /** The question: what happens, and what it costs. */
  message: ReactNode;
  /** Optional detail spelling out exactly what the action would do. */
  details?: ReactNode;
  /** The affirmative button's label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** The dismissing button's label. Defaults to "Cancel". */
  cancelLabel?: string;
}

/** One in-flight question and the resolver waiting on the answer. */
interface Pending {
  options: ConfirmOptions;
  settle: (ok: boolean) => void;
}

export interface ConfirmHandle {
  /** Ask, and resolve true only if the affirmative was taken. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** The dialog, or `null` when nothing is being asked. Render it. */
  dialog: ReactNode;
}

export function useConfirm(): ConfirmHandle {
  const [pending, setPending] = useState<Pending | null>(null);

  // The live question, so answering resolves the right promise even if a render
  // has since replaced the callback that opened it.
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.settle(ok);
  }, []);

  // Stable, so a handler that awaits it is not rebuilt on every keystroke.
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, settle: resolve });
      }),
    [],
  );

  const dialog = pending && (
    <Dialog
      title={pending.options.title}
      details={pending.options.details}
      // Every way out that is not the affirmative — Escape, the scrim, Cancel —
      // answers no, which is always the answer that costs nothing.
      onDismiss={() => settle(false)}
      actions={[
        {
          label: pending.options.cancelLabel ?? "Cancel",
          onClick: () => settle(false),
          autoFocus: true,
        },
        {
          label: pending.options.confirmLabel ?? "Confirm",
          tone: "danger",
          onClick: () => settle(true),
        },
      ]}
    >
      {pending.options.message}
    </Dialog>
  );

  return { confirm, dialog };
}
