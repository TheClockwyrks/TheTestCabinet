import styles from "./Switch.module.scss";

/**
 * A two-state slider for a boolean setting.
 *
 * The control is a real checkbox carrying `role="switch"`, drawn over the track it
 * paints, so it keeps the browser's focus, keyboard and form behaviour while reading
 * as on/off rather than as ticked/unticked. Its name comes from the label the row
 * around it renders, referenced by `id`.
 */
export function Switch({
  id,
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  id?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Only for a switch with no visible label of its own. */
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <span className={styles.root}>
      <input
        id={id}
        className={styles.input}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </span>
  );
}
