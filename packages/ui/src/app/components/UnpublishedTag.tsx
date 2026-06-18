import styles from "./UnpublishedTag.module.scss";

interface UnpublishedTagProps {
  className?: string;
}

// Marks a run that is being previewed from local disk and has not been
// published yet. Shown only in dev, alongside runs served by the local-runs
// plugin, so it is obvious which entries are not live. Rendered as a compact
// warning triangle with a hover tooltip rather than a full-width badge, so it
// does not throw off column alignment in dense run tables.
export function UnpublishedTag({ className }: UnpublishedTagProps) {
  return (
    <span
      className={`${styles.tag}${className ? ` ${className}` : ""}`}
      title="Unpublished"
    >
      <svg
        className={styles.icon}
        viewBox="0 0 16 16"
        role="img"
        aria-label="Unpublished"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Warning triangle outline. */}
        <path
          d="M8 2 L15 14 L1 14 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        {/* Exclamation mark. */}
        <line
          x1="8"
          y1="6"
          x2="8"
          y2="10"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
        <circle cx="8" cy="12" r="0.9" fill="currentColor" />
      </svg>
    </span>
  );
}
