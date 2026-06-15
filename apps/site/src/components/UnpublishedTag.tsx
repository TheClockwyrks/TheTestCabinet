import styles from "./UnpublishedTag.module.scss";

interface UnpublishedTagProps {
  className?: string;
}

// Marks a run that is being previewed from local disk and has not been
// published yet. Shown only in dev, alongside runs served by the local-runs
// plugin, so it is obvious which entries are not live.
export function UnpublishedTag({ className }: UnpublishedTagProps) {
  return (
    <span className={`${styles.tag}${className ? ` ${className}` : ""}`}>
      Unpublished
    </span>
  );
}
