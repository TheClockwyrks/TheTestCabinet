import styles from "./MetricTile.module.scss";

interface MetricTileProps {
  /** The metric's name, shown above the value. */
  label: string;
  /** The formatted value to display. */
  value: string;
  /** Render the value muted, for figures that are informational rather than key. */
  secondary?: boolean;
}

// A single labelled figure in the site's neon-outlined panel style. Used to lay
// out a run's metrics and metadata as a responsive grid of tiles, where each
// tile pairs a muted label with its value.
export function MetricTile({ label, value, secondary = false }: MetricTileProps) {
  return (
    <div className={styles.tile}>
      <span className={styles.label}>{label}</span>
      <span
        className={`${styles.value}${secondary ? ` ${styles.secondary}` : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
