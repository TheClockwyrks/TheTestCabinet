import styles from "./Pagination.module.scss";

interface PaginationProps {
  /** Zero-based index of the current page. */
  page: number;
  /** Total number of pages (>= 1). */
  pageCount: number;
  /** Called with the new zero-based page index when the user navigates. */
  onPageChange: (page: number) => void;
}

// A minimal previous/next pager with a page-position readout. Kept presentation
// only — the owner holds the page state and decides how to slice its data — so
// it can sit under any paged list. Renders nothing for a single page.
export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  if (pageCount <= 1) {
    return null;
  }
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <button
        type="button"
        className={styles.button}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 0}
      >
        Prev
      </button>
      <span className={styles.status} aria-live="polite">
        Page {page + 1} of {pageCount}
      </span>
      <button
        type="button"
        className={styles.button}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount - 1}
      >
        Next
      </button>
    </nav>
  );
}
