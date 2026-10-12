import { ARTIFACTS_NOT_STORED_LABEL } from "../../client/artifactPresence";
import styles from "./UnpublishedTag.module.scss";

interface UnpublishedTagProps {
  className?: string;
  /**
   * The run's artifact tree is not stored, so it is unpublished and cannot be
   * published. The marker then says so, in the danger colour, in place of the
   * plain "Unpublished".
   */
  artifactsMissing?: boolean;
}

// Marks a run that is being previewed from local disk and has not been
// published yet. Shown only in dev, alongside runs served by the local-runs
// plugin, so it is obvious which entries are not live. Rendered as a compact
// warning triangle with a hover tooltip rather than a full-width badge, so it
// does not throw off column alignment in dense run tables.
//
// One marker serves both states so a row never carries two triangles: a run
// whose artifacts are missing is an unpublished run, with the reason it will
// stay one.
export function UnpublishedTag({
  className,
  artifactsMissing = false,
}: UnpublishedTagProps) {
  const label = artifactsMissing
    ? `Unpublished. ${ARTIFACTS_NOT_STORED_LABEL}`
    : "Unpublished";
  const classes = [
    styles.tag,
    artifactsMissing ? styles.missing : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      title={label}
      data-artifacts-missing={artifactsMissing ? "true" : undefined}
    >
      <svg
        className={styles.icon}
        viewBox="0 0 16 16"
        role="img"
        aria-label={label}
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
