// The designer's modal dialog — the themed replacement for `window.confirm()`.
//
// The repo's rule (see the docs site, `components/ui/overview` → "Dialogs") is that
// a destructive control asks through a themed modal rather than the browser's own
// dialog, because the question needs more than a line of plain text: a resize that
// takes components off the board has to say how many, where they go, and that they
// are not written when the file is saved. The browser's `confirm()` can carry one
// unstyled string and nothing else.
//
// The console gets this from `@clockwyrks/ui`'s `Dialog`. This tool is a standalone
// Vite app that deliberately does not depend on the package (see `vite.config.ts`),
// so the same contract is rebuilt here against the designer's own plain CSS: modal,
// Escape dismisses, the scrim dismisses, focus is trapped inside the panel, the page
// behind cannot scroll, and the DISMISSING action is what opens focused — so Enter
// or a stray Space on a dialog nobody expected cancels rather than confirming.

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Everything inside the panel that can hold focus, for the Tab trap. */
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** How an action reads: the plain alternative, or the destructive one. */
export type DialogTone = "secondary" | "danger";

export interface DialogAction {
  label: string;
  onClick: () => void;
  /** Defaults to `secondary`. */
  tone?: DialogTone;
  /**
   * Takes focus when the dialog opens. Give this to the SAFE action: a modal that
   * opens focused on the destructive button turns a reflexive Enter into the thing
   * the dialog exists to prevent.
   */
  autoFocus?: boolean;
}

export interface DialogProps {
  /** The heading, and the dialog's accessible name. */
  title: string;
  /** The question: what the action does, and what it costs. */
  children?: ReactNode;
  /** Supporting detail — the exact consequences, listed. */
  details?: ReactNode;
  /** Footer buttons in reading order: cancel first, affirmative last. */
  actions: DialogAction[];
  /** Escape and a click on the scrim both route here. */
  onDismiss: () => void;
}

export function Dialog({
  title,
  children,
  details,
  actions,
  onDismiss,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Whichever action asks for focus, else the first (which is the cancel).
  const focusIndex = Math.max(
    0,
    actions.findIndex((action) => action.autoFocus),
  );

  // Open focused on the safe action, and hand focus back to whatever raised the
  // dialog once it closes — the Apply button, or the preset that was clicked.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (
      panel?.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? panel
    )?.focus();
    return () => restoreTo?.focus?.();
  }, []);

  // Escape dismisses from anywhere, including with focus on the panel itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // The editor behind a modal must not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Keep Tab inside the panel: a modal that lets focus wander onto the toolbar
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
    } else if (!e.shiftKey && (active === last || active === panel)) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="scrim"
      // Dismiss on mousedown against the scrim itself, so a drag that starts inside
      // the panel (selecting the message) and ends outside is not read as a click
      // away from it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {children && <div className="dialog-body">{children}</div>}
        {details && <div className="dialog-details">{details}</div>}
        <div className="dialog-actions">
          {actions.map((action, i) => (
            <button
              key={action.label}
              type="button"
              className={
                action.tone === "danger"
                  ? "dialog-action danger"
                  : "dialog-action"
              }
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
