import styles from "./ProgressBar.module.scss";

interface ProgressBarProps {
  /**
   * Completion fraction in `[0, 1]`. `null` (or a non-finite value) renders an
   * indeterminate bar — a moving sliver, for when the total size is unknown.
   */
  value?: number | null;
  /** Accessible label for the bar. */
  ariaLabel?: string;
}

// A thin determinate/indeterminate progress bar. Reads the `--tcab-*` token
// contract so each app themes it. Determinate when given a fraction; otherwise it
// animates an indeterminate sliver so the user still sees activity.
export function ProgressBar({ value = null, ariaLabel }: ProgressBarProps) {
  const determinate = value != null && Number.isFinite(value);
  const pct = determinate ? Math.max(0, Math.min(1, value)) * 100 : 0;

  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? Math.round(pct) : undefined}
      data-indeterminate={determinate ? undefined : ""}
    >
      <div
        className={styles.fill}
        style={determinate ? { width: `${pct}%` } : undefined}
      />
    </div>
  );
}
