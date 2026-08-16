import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Dialog.module.scss";

/** Every focusable control a dialog's chrome can contain, for the focus trap. */
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** How an action reads: the affirmative, a plain alternative, or destructive. */
export type DialogActionTone = "primary" | "secondary" | "danger";

export interface DialogAction {
  label: string;
  onClick: () => void;
  /** Defaults to `secondary`. */
  tone?: DialogActionTone;
  /** Takes focus when the dialog opens. The first action when none says so. */
  autoFocus?: boolean;
}

export interface DialogProps {
  /** The dialog's heading, and its accessible name. */
  title: string;
  /** The prose: what the action does and what it costs. */
  children?: ReactNode;
  /**
   * Optional supporting detail — the list of changes an action would make, say.
   * It renders in a region of its own that scrolls at a capped height, so a long
   * list can never push the dialog past the viewport and break the page.
   */
  details?: ReactNode;
  /** The footer buttons, in reading order (cancel first, affirmative last). */
  actions: DialogAction[];
  /** Escape and a click on the scrim both route here. */
  onDismiss: () => void;
}

/**
 * The themed modal dialog every GUI uses in place of the browser's own
 * `alert()` / `confirm()`: a scrim over the page and a neon-outlined panel
 * portalled to `document.body`, so it escapes any panel's overflow or stacking
 * context and reads as part of the cabinet rather than as the operating system.
 *
 * It behaves the way the native dialogs do where that matters — modal, Escape
 * dismisses, focus starts on the default action and is trapped until the dialog
 * answers, and the page behind cannot scroll — and better where it does not: it
 * is themed, it can carry arbitrary detail (see {@link DialogProps.details}),
 * and it is capped at the viewport height rather than growing without bound.
 *
 * This is the presentational shell only. Destructive-action confirmation is
 * driven through `useConfirm()` (app/components/ConfirmDialog), which owns the
 * promise plumbing that lets a click handler await an answer.
 */
export function Dialog({
  title,
  children,
  details,
  actions,
  onDismiss,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // The action that opens focused: whichever asks for it, else the first. Held as
  // an index so the button knows itself without re-scanning the list per render.
  const focusIndex = Math.max(
    0,
    actions.findIndex((action) => action.autoFocus),
  );

  // Open focused on the default action (so Enter answers the dialog), and hand
  // focus back to whatever the user was on once it closes.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (
      panel?.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? panel
    )?.focus();
    return () => restoreTo?.focus?.();
  }, []);

  // Escape dismisses from anywhere, including when focus sits on the panel itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // The page behind a modal must not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Keep Tab inside the panel: a modal that lets focus wander onto the page
  // behind it is answerable only with the mouse.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={styles.scrim}
      // Dismiss on mousedown against the scrim itself, so a drag that begins
      // inside the panel (selecting the message text) and ends outside it does
      // not read as a click away.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children && <div className={styles.body}>{children}</div>}
        {details && <div className={styles.details}>{details}</div>}
        <div className={styles.actions}>
          {actions.map((action, i) => (
            <button
              key={action.label}
              type="button"
              className={`${styles.action} ${styles[action.tone ?? "secondary"]}`}
              data-dialog-autofocus={i === focusIndex ? "" : undefined}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
