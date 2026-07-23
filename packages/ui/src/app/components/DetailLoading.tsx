import { Spinner } from "@test-cabinet/ui";
import styles from "./DetailLoading.module.scss";

interface DetailLoadingProps {
  /** The caption shown beneath the mark; also its accessible label. */
  label?: string;
}

// The full-body loading state for a detail page whose chrome (title + tab strip)
// can't be drawn until its record resolves — the catalog is still loading, or a
// run is being fetched by id. It centres the large squadron mark in the space
// below the topbar so the wait reads as a deliberate loading state, not a blank
// page with a spinner stranded in the top-left corner. Once the record resolves
// the layout swaps this for the real header, tabs, and body.
export function DetailLoading({ label = "Loading…" }: DetailLoadingProps) {
  return (
    <div className={styles.wrap}>
      <Spinner variant="squadron" label={label} />
    </div>
  );
}
