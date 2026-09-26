import { useEffect, useRef } from "react";
import exec from "../runs/RunExec.module.scss";
import styles from "./UnsavedChangesDialog.module.scss";

/**
 * The three-way "you have unsaved changes" prompt: save them, throw them away, or go
 * back to editing.
 *
 * Three ways out rather than the browser's two, because leaving a form with unsaved work
 * is genuinely a three-way choice and `window.confirm` can only offer two of them. Forced
 * into two, an operator who meant "save and go" has to cancel, find the Save button, and
 * press it — which is the flow this control exists to remove.
 *
 * Keeping-editing is the safe default in every ambiguous case: Escape and a click on the
 * backdrop both take it, because a dismissal gesture is not a decision about the work.
 */
export function UnsavedChangesDialog({
  title,
  body,
  saveLabel,
  saveDisabled,
  saveBlockedReason,
  onSave,
  onDiscard,
  onCancel,
}: {
  title: string;
  body: string;
  /** What saving is called here — "Save agent" rather than a bare "Save". */
  saveLabel: string;
  /**
   * Whether saving is refused, because what is on the form is not savable. The operator
   * is then left with discarding or going back to fix it — never with a Save button that
   * silently does nothing.
   */
  saveDisabled?: boolean;
  /** Why saving is refused, shown beside the disabled button. */
  saveBlockedReason?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus lands on the safe choice, and Escape takes it: a dialog that opens with
  // "discard" under the return key is one that eventually eats somebody's work.
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className={styles.backdrop}
      // A click that starts and ends on the backdrop itself is a dismissal; one that
      // merely bubbles up from inside the panel is not.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-body"
      >
        <h2 id="unsaved-title" className={styles.title}>
          {title}
        </h2>
        <p id="unsaved-body" className={styles.body}>
          {body}
        </p>
        {saveDisabled && saveBlockedReason && (
          <p className={styles.blocked}>{saveBlockedReason}</p>
        )}
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            type="button"
            className={exec.secondary}
            onClick={onCancel}
          >
            Keep editing
          </button>
          <button type="button" className={exec.danger} onClick={onDiscard}>
            Discard changes
          </button>
          <button
            type="button"
            className={exec.primary}
            onClick={onSave}
            disabled={saveDisabled}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
