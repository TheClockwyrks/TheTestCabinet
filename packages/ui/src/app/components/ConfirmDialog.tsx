import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "@test-cabinet/ui";

/** What to ask before a consequential action, and how to label the answer. */
export interface ConfirmOptions {
  /** The heading — name the action, e.g. "Delete run". */
  title: string;
  /** The prose: what happens, and what it costs. */
  message: ReactNode;
  /**
   * Optional detail listing exactly what the action would do — the changes a
   * restore would make, the records a sweep would touch. Rendered in the
   * dialog's capped, scrollable detail region, so it may be arbitrarily long.
   */
  details?: ReactNode;
  /** The affirmative button's label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** The dismissing button's label. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Whether the affirmative is destructive, and so styled as a danger action
   * rather than the accented primary. Defaults to true: nearly everything that
   * warrants a confirmation in this app discards work.
   */
  destructive?: boolean;
}

/** A message to deliver with no question attached — a failure report, say. */
export interface AlertOptions {
  title: string;
  message: ReactNode;
  details?: ReactNode;
  /** The dismissing button's label. Defaults to "OK". */
  dismissLabel?: string;
}

export interface ConfirmApi {
  /** Ask, and resolve true only if the reviewer took the affirmative. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Tell, and resolve once it has been acknowledged. */
  alert: (options: AlertOptions) => Promise<void>;
}

// The fallback used when no <ConfirmDialogProvider> is above the caller. Every
// GUI mounts one in `GalleryApp`, so this is unreachable in the shipped apps; it
// exists so a host that renders a page outside that tree still gets a working
// (if unthemed) confirmation rather than a destructive button that silently does
// nothing. These are the only remaining native dialogs in the app.
const NATIVE_FALLBACK: ConfirmApi = {
  confirm: async ({ title, message }) =>
    window.confirm(`${title}\n\n${typeof message === "string" ? message : ""}`),
  alert: async ({ title, message }) => {
    window.alert(`${title}\n\n${typeof message === "string" ? message : ""}`);
  },
};

const ConfirmContext = createContext<ConfirmApi>(NATIVE_FALLBACK);

/** One in-flight request and the resolver waiting on the reviewer's answer. */
type Pending =
  | { kind: "confirm"; options: ConfirmOptions; settle: (ok: boolean) => void }
  | { kind: "alert"; options: AlertOptions; settle: (ok: boolean) => void };

/**
 * Provides the app's themed replacement for `window.confirm()` / `window.alert()`.
 *
 * A click handler asks with `const { confirm } = useConfirm()` and simply awaits
 * the answer, which keeps every call site the shape it already had — a guard
 * clause at the top of the handler — rather than forcing each one to hoist its
 * action into per-component dialog state:
 *
 * ```tsx
 * if (!(await confirm({ title: "Delete run", message: "…" }))) return;
 * ```
 *
 * Only one request is held at a time. The dialog is modal, so a second cannot
 * originate from the UI while one is open.
 *
 * Mounted once by `GalleryApp`, above the routed pages, so every page and every
 * portalled menu inside it can ask.
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  // The live request, so answering resolves the right promise even if a render
  // has since replaced the callbacks that opened it.
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.settle(ok);
  }, []);

  const api = useMemo<ConfirmApi>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          setPending({ kind: "confirm", options, settle: resolve });
        }),
      alert: (options) =>
        new Promise<void>((resolve) => {
          setPending({ kind: "alert", options, settle: () => resolve() });
        }),
    }),
    [],
  );

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {pending?.kind === "confirm" && (
        <Dialog
          title={pending.options.title}
          details={pending.options.details}
          // Dismissing — Escape, the scrim, Cancel — is always the safe answer.
          onDismiss={() => settle(false)}
          actions={[
            {
              label: pending.options.cancelLabel ?? "Cancel",
              tone: "secondary",
              onClick: () => settle(false),
              // The safe answer takes focus, so Enter on an accidentally-raised
              // dialog cancels rather than confirming the destructive action.
              autoFocus: true,
            },
            {
              label: pending.options.confirmLabel ?? "Confirm",
              tone:
                (pending.options.destructive ?? true) ? "danger" : "primary",
              onClick: () => settle(true),
            },
          ]}
        >
          {pending.options.message}
        </Dialog>
      )}
      {pending?.kind === "alert" && (
        <Dialog
          title={pending.options.title}
          details={pending.options.details}
          onDismiss={() => settle(true)}
          actions={[
            {
              label: pending.options.dismissLabel ?? "OK",
              tone: "primary",
              onClick: () => settle(true),
              autoFocus: true,
            },
          ]}
        >
          {pending.options.message}
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * The themed `confirm()` / `alert()` pair. Both return promises: `confirm`
 * resolves true only on the affirmative, `alert` once acknowledged.
 */
export function useConfirm(): ConfirmApi {
  return useContext(ConfirmContext);
}
