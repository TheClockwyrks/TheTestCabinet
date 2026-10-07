import { useState, type ReactNode } from "react";
import styles from "./SpecAccordion.module.scss";

/** One collapsible entry: a path/type header over a body revealed when open. */
export interface AccordionEntry {
  /** Stable key and the path shown on the left of the header. */
  path: string;
  /**
   * The kind label shown on the right of the header (e.g. `text`, `image`).
   * Omit it for a header with nothing right-aligned (e.g. the changelog, whose
   * entries carry only a version).
   */
  kind?: string;
  /** The content revealed when the entry is expanded. */
  body: ReactNode;
  /**
   * Whether the entry starts expanded. Defaults to false — a stack of seeded
   * files is scannable precisely because it starts closed — but a caller with
   * one entry the visitor demonstrably came for (the changelog entry of the
   * page's anchored version) opens that one so the reader is not made to hunt
   * for it. Read on mount only; a caller whose "came for" entry can change must
   * remount the accordion (key it) for the new choice to take.
   */
  initiallyOpen?: boolean;
}

interface SpecAccordionProps {
  entries: AccordionEntry[];
  /** Copy for the empty state, when there are no entries to show. */
  emptyLabel: string;
}

// A stack of collapsible, full-width panels — one per seeded file or reference
// image. Every entry starts collapsed (unless it opts in via `initiallyOpen`)
// and expands in place, so the whole set is scannable by path and each one opens
// to the full content width. Shared by the Specifications and References
// surfaces so both read identically.
export function SpecAccordion({ entries, emptyLabel }: SpecAccordionProps) {
  if (entries.length === 0) {
    return <p className={styles.empty}>{emptyLabel}</p>;
  }

  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <AccordionItem key={entry.path} entry={entry} />
      ))}
    </ul>
  );
}

// One panel: a full-width header that toggles the body open. The header shows the
// path on the left and the kind on the right; the body is whatever the caller
// rendered (prose, a code block, or an image).
function AccordionItem({ entry }: { entry: AccordionEntry }) {
  const [open, setOpen] = useState(entry.initiallyOpen ?? false);

  return (
    <li className={open ? `${styles.item} ${styles.itemOpen}` : styles.item}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.twisty} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className={styles.path}>{entry.path}</span>
        {entry.kind && <span className={styles.kind}>{entry.kind}</span>}
      </button>
      {open && <div className={styles.body}>{entry.body}</div>}
    </li>
  );
}
