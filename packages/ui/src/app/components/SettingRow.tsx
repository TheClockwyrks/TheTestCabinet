import { useId, type ReactNode } from "react";
import { HelpTip } from "./HelpTip";
import styles from "./SettingRow.module.scss";

/**
 * One setting: its name and what it controls on the left, the control itself on the
 * right.
 *
 * The split is what makes a column of settings readable. Names line up on one edge
 * and controls on the other, so a form is scanned rather than read, and a control's
 * explanation stays beside the control it belongs to.
 *
 * `description` states what the setting does. Anything a reader can act without goes
 * in `help`, where a {@link HelpTip} keeps it out of the column until asked for.
 *
 * `onReset` returns the setting to the value it starts at, and its control appears
 * only while `modified` says the setting has moved off it — which is what tells a
 * reader where the defaults are without a form full of "on by default" captions.
 */
export function SettingRow({
  label,
  description,
  help,
  modified = false,
  onReset,
  children,
}: {
  label: string;
  description?: ReactNode;
  help?: string;
  /** Whether the setting currently differs from the value it starts at. */
  modified?: boolean;
  onReset?: () => void;
  /**
   * The control. Given a function, it receives the id of the row's label so a single
   * focusable control can claim it; a group of controls names itself instead.
   */
  children: ReactNode | ((controlId: string) => ReactNode);
}) {
  const controlId = useId();
  const labelled = typeof children === "function";
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span className={styles.labelRow}>
          {labelled ? (
            <label className={styles.label} htmlFor={controlId}>
              {label}
            </label>
          ) : (
            <span className={styles.label}>{label}</span>
          )}
          {help && <HelpTip text={help} />}
          {modified && onReset && (
            <button
              type="button"
              className={styles.reset}
              aria-label={`Reset ${label}`}
              title={`Reset ${label}`}
              onClick={onReset}
            >
              ↺
            </button>
          )}
        </span>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      <div className={styles.control}>
        {labelled ? children(controlId) : children}
      </div>
    </div>
  );
}
