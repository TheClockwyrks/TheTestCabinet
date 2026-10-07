import { useState, type ReactNode } from "react";
import styles from "./InputBrowser.module.scss";

// A grouped file-tree browser: a left rail listing every item under its group
// heading, and a persistent viewer showing the selected item's content beside
// it. It is the "index + stage" of the redesigned Inputs and Changelog tabs —
// one scannable list of everything there is, one always-visible pane rendering
// whichever entry is selected, instead of a stack of collapsible panels each
// opening in place.
//
// The browser is deliberately generic: an item is just a label and a `render`
// producing its body. Content is rendered only for the selected
// item, so a body that fetches on mount (a starter-workspace file) naturally
// loads lazily on selection. Selection is internal state read from
// `initialSelectedId` on mount only — a caller whose "came for" entry can change
// (the changelog's anchored version) must remount the browser (key it) for the
// new choice to take.

/** One selectable entry in the tree. */
export interface InputBrowserItem {
  /** Stable identity for selection (unique across every group). */
  id: string;
  /** The row's text in the rail. */
  label: string;
  /** Produces the viewer body. Called only while the item is selected. */
  render: () => ReactNode;
}

/** One labeled group of entries in the rail. */
export interface InputBrowserGroup {
  /** The group heading (e.g. `Specs`, `Versions`). */
  label: string;
  items: InputBrowserItem[];
}

interface InputBrowserProps {
  /** The groups in rail order. Empty groups are omitted from the rail. */
  groups: InputBrowserGroup[];
  /** The item selected on mount; falls back to the first item when absent or
   * naming no item. Read on mount only — remount (key) to re-anchor. */
  initialSelectedId?: string;
  /** Copy for the empty state, when no group has any item. */
  emptyLabel: string;
}

// The browser: rail beside viewer on a desktop, rail stacked above the viewer
// below the medium breakpoint. Each rail row is a real button whose accessible
// name is the item's label; the active one carries `aria-current`.
export function InputBrowser({
  groups,
  initialSelectedId,
  emptyLabel,
}: InputBrowserProps) {
  const populated = groups.filter((group) => group.items.length > 0);
  const items = populated.flatMap((group) => group.items);
  const first = items[0];
  // Read once: the browser owns its selection after mount (see the props doc).
  const [selectedId, setSelectedId] = useState(
    () => initialSelectedId ?? first?.id,
  );
  if (!first) {
    return <p className={styles.empty}>{emptyLabel}</p>;
  }
  // An id that names no item (a stale anchor, an item list that changed under a
  // kept selection) falls back to the first entry rather than a blank stage.
  const selected = items.find((item) => item.id === selectedId) ?? first;
  return (
    <div className={styles.browser}>
      <nav className={styles.rail} aria-label="Files">
        {populated.map((group) => (
          <section key={group.label} className={styles.group}>
            <div className={styles.groupHeading}>
              <span className={styles.groupLabel}>{group.label}</span>
              <span className={styles.groupCount}>{group.items.length}</span>
            </div>
            <ul className={styles.items}>
              {group.items.map((item) => {
                const active = item.id === selected.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={
                        active
                          ? `${styles.row} ${styles.rowActive}`
                          : styles.row
                      }
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelectedId(item.id)}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
      {/* No header naming the selection: the rail's current row already says
          the file's name and its group says the category. */}
      <div className={styles.viewer}>
        <div className={styles.viewerBody}>{selected.render()}</div>
      </div>
    </div>
  );
}

/** A muted aside standing in for a viewer body with nothing to show — a file
 * the host cannot serve, a fetch that failed. Part of the browser's vocabulary
 * so every host's viewer states read alike. */
export function InputViewerNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}
