import styles from "./MetricTile.module.scss";

interface MetricTileProps {
  /** The metric's name, shown above the value. */
  label: string;
  /** The formatted value to display. */
  value: string;
  /** Render the value muted, for figures that are informational rather than key. */
  secondary?: boolean;
  /** When set, render the value as an external link to this URL. */
  href?: string;
  /**
   * Native tooltip for the value. Use when the displayed value is abbreviated
   * (e.g. a container image digest) so the full text is still reachable on hover.
   */
  title?: string;
}

// A single labelled figure in the neon-outlined panel style. Used to lay out a
// run's metrics and metadata as a responsive grid of tiles, where each tile
// pairs a muted label with its value. When `href` is given the value becomes an
// external link, e.g. the Source tile linking to the run's repo.
export function MetricTile({
  label,
  value,
  secondary = false,
  href,
  title,
}: MetricTileProps) {
  const valueClass = `${styles.value}${secondary ? ` ${styles.secondary}` : ""}`;
  return (
    <div className={styles.tile}>
      <span className={styles.label}>{label}</span>
      {href ? (
        <a
          className={`${valueClass} ${styles.link}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          title={title}
        >
          {value}
        </a>
      ) : (
        <span className={valueClass} title={title}>
          {value}
        </span>
      )}
    </div>
  );
}
