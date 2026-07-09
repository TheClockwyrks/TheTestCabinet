import styles from "./Pagination.module.scss";

interface PaginationProps {
  /** Zero-based index of the current page. */
  page: number;
  /** Total number of pages (>= 1). */
  pageCount: number;
  /** Called with the new zero-based page index when the user navigates. */
  onPageChange: (page: number) => void;
  /** Most page buttons to show at once (the sliding window's width). Odd so the
   * current page sits dead-centre; even values still work but lean the window one
   * page to the left. Defaults to 11. */
  maxPages?: number;
}

// A numbered pager: a sliding window of clickable page buttons flanked by
// previous/next chevrons. The window keeps the current page centred where it can
// (page 15 of many shows 10–20) and clamps at the ends (page 1 shows 1–11; the
// last page fills the window from the right), so the current page is always
// visible and the control never changes width. Presentation only — the owner
// holds the page state and slices its own data. Renders nothing for a single page.
export function Pagination({
  page,
  pageCount,
  onPageChange,
  maxPages = 11,
}: PaginationProps) {
  if (pageCount <= 1) {
    return null;
  }

  const pages = windowPages(page, pageCount, maxPages);

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <button
        type="button"
        className={styles.nav}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 0}
        aria-label="Previous page"
      >
        <ChevronIcon className={styles.icon} direction="left" />
      </button>

      {pages.map((index) => {
        const isCurrent = index === page;
        return (
          <button
            key={index}
            type="button"
            className={
              isCurrent ? `${styles.page} ${styles.active}` : styles.page
            }
            onClick={() => onPageChange(index)}
            aria-label={`Page ${index + 1}`}
            aria-current={isCurrent ? "page" : undefined}
          >
            {index + 1}
          </button>
        );
      })}

      <button
        type="button"
        className={styles.nav}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount - 1}
        aria-label="Next page"
      >
        <ChevronIcon className={styles.icon} direction="right" />
      </button>
    </nav>
  );
}

// The zero-based page indices to render, in order. A window of `width` pages
// (never more than exist) that slides to keep `page` centred, then clamps so it
// stays within [0, pageCount) — the same math whether `width` is odd or even.
function windowPages(
  page: number,
  pageCount: number,
  maxPages: number,
): number[] {
  const width = Math.min(Math.max(1, maxPages), pageCount);
  const half = Math.floor(width / 2);
  // Centre on `page`, then pull back inside both edges. Left clamp wins ties on a
  // tiny page count, which is fine — the window still covers every page.
  const start = Math.max(0, Math.min(page - half, pageCount - width));
  return Array.from({ length: width }, (_, offset) => start + offset);
}

// A line-art chevron in `currentColor`, so the button's CSS sets its colour and
// size — matching the other line marks in the UI (see `BellIcon`).
function ChevronIcon({
  className,
  direction,
}: {
  className?: string;
  direction: "left" | "right";
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "M15 6 9 12l6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
