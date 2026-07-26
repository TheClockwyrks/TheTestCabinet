import { Spinner } from "@test-cabinet/ui";
import styles from "./LoadingState.module.scss";

/** How much of the viewport the pending content will occupy once it resolves.
 * `page` is a whole page body (the catalog, a detail page whose record hasn't
 * resolved); `section` is a large block inside a page that already has chrome
 * around it (a tab body, a panel). Both centre the mark; they differ only in how
 * much space they reserve while waiting. */
export type LoadingStateSize = "page" | "section";

interface LoadingStateProps {
  /** The caption shown beneath the mark; also its accessible label. */
  label?: string;
  size?: LoadingStateSize;
}

// The loading state for a whole page body or a large section of one — the
// catalog is still loading, a record is being fetched by id, a tab's runs
// haven't arrived. It centres the large squadron mark in the space the content
// will fill, so the wait reads as a deliberate loading state rather than a blank
// page with a small spinner stranded in the top-left corner. Small, inline waits
// (a media tile, a line of text) should use `<Spinner variant="flap">` directly.
export function LoadingState({
  label = "Loading…",
  size = "page",
}: LoadingStateProps) {
  return (
    <div className={`${styles.wrap} ${styles[size]}`}>
      <Spinner variant="squadron" label={label} />
    </div>
  );
}
