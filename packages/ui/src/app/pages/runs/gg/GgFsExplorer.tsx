import { useCallback, useState, type ReactNode } from "react";
import panels from "./GgPanels.module.scss";
import { cx, fsGuide, fsIndent } from "./ggFsTree";
import { ChevronIcon, FolderIcon, FolderOpenIcon } from "./ggIcons";

// The shell every gg explorer is built out of: a filesystem sidebar on the left and the
// selected thing's detail on the right.
//
// gg has three of them — the Instances tree (agents as folders, the things you can
// monitor about one as its files), the Project board (epics holding issues holding
// review rounds) and the Modules tab (module kinds holding the instances of that kind) —
// and they are the same explorer three times over: the same two-pane shell, the same
// sparse open-override map, the same folder and file row markup, the same indent and
// guideline invariants. Two copies of that was tolerable; three is where the copies start
// to drift, and a drifted copy shows up as a tree that reads subtly differently from its
// siblings for no reason a reader can name.
//
// So the *shape* is shared and the *domain* is not. What lives here is everything that
// makes a tree look and behave like a tree: the shell, the open/closed bookkeeping, and
// the row markup with its `aria-*`, indent and caret-slot invariants (in particular the
// `.fsFile::before` caret spacer, which a new call site would otherwise have to know to
// reproduce — see `GgPanels.module.scss`). What deliberately stays with each explorer is
// its `Selection` type and the effect that keeps a selection valid as a live stream
// reshapes the run: those are domain logic, and forcing three of them into one generic
// would cost more than the duplication it removed.

/**
 * The open/closed state of a tree's folders, held as *overrides* of each folder's own
 * default rather than as the state itself.
 *
 * That distinction is what keeps a live run readable: an agent that spawns mid-run, an
 * issue gg files as it decomposes, a module instance a fork mints — each takes its
 * default (usually closed) as it appears, rather than springing open because it was
 * absent from an "open" set, or staying shut because it was absent from a "closed" one.
 */
export interface FsFolders {
  /** Whether the folder keyed `key` is open, given the default it takes untouched. */
  isOpen: (key: string, byDefault: boolean) => boolean;
  /** Flip it, from whichever state it is currently showing. */
  toggle: (key: string, byDefault: boolean) => void;
  /**
   * Force a set of folders open — what a "reveal this" path walk needs. Forced rather
   * than cleared back to the default, because the folders on the path to a thing worth
   * revealing (a subagent's folder, an agent's modules folder) default to *closed*:
   * clearing them would leave the thing the reader just asked for hidden behind carets.
   */
  open: (keys: Iterable<string>) => void;
}

export function useFsFolders(): FsFolders {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const isOpen = (key: string, byDefault: boolean) =>
    overrides.get(key) ?? byDefault;
  const toggle = (key: string, byDefault: boolean) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, !(prev.get(key) ?? byDefault));
      return next;
    });
  // Stable across renders, so a `reveal`-style callback built on it can itself be stable
  // and be named as an effect dependency without re-firing every render.
  const open = useCallback((keys: Iterable<string>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const key of keys) next.set(key, true);
      return next;
    });
  }, []);
  return { isOpen, toggle, open };
}

/**
 * The two-pane explorer shell: the filesystem sidebar and the detail pane beside it.
 *
 * The sidebar is a `<nav>` with an accessible name, because a page can hold more than one
 * of these and "which tree is this" is otherwise unanswerable to a screen reader.
 */
export function FsExplorer({
  sidebarLabel,
  sidebarHead,
  tree,
  children,
}: {
  /** Names the sidebar's landmark — "Agents", "Project board", "Modules". */
  sidebarLabel: string;
  /**
   * A block above the tree, inside the sidebar — a filter box, a count, a legend.
   *
   * Optional, and every run explorer omits it: a run's tree is what the run did and is
   * short enough to read. The gg **reference** passes one, because its tree is the whole
   * of one SDK arm and a reader arrives at it looking for one name out of ninety-odd.
   * Whatever is passed scrolls with the tree unless it says otherwise — the sidebar is
   * the scroll container — so a control that must stay put should stick itself.
   */
  sidebarHead?: ReactNode;
  /** The tree's top-level nodes ({@link FsFolder} / {@link FsFileRow} elements). */
  tree: ReactNode;
  /** The detail pane: whatever the current selection resolves to. */
  children: ReactNode;
}) {
  return (
    <div className={panels.explorer}>
      <nav className={panels.explorerSidebar} aria-label={sidebarLabel}>
        {sidebarHead}
        <ul className={panels.fsTree}>{tree}</ul>
      </nav>
      <div className={panels.explorerContent}>{children}</div>
    </div>
  );
}

/**
 * One folder in a tree: a disclosure row, and — when open — the rows it holds, carrying
 * the guideline that drops from this folder's caret through everything under it.
 *
 * `depth` is the folder's *own* nesting depth; its children are laid out one level in.
 * Both the row's indent and the guideline's position are computed from it (see
 * `ggFsTree`), so a folder cannot end up drawn at one depth and guided at another.
 */
export function FsFolder({
  depth,
  open,
  onToggle,
  name,
  ariaLabel,
  icon,
  meta,
  children,
}: {
  depth: number;
  open: boolean;
  onToggle: () => void;
  name: ReactNode;
  /**
   * The row's accessible name. Worth setting on any folder a run can hold more than one
   * of ("agent agent-0", "root modules", "issue AUTH-1"): without it the row's name is
   * whatever its contents concatenate to, which reads as loose tokens and is ambiguous
   * the moment a second one appears.
   */
  ariaLabel?: string;
  /**
   * The glyph in the icon slot. Defaults to the open/closed folder mark; pass a different
   * one where the folder is not a plain grouping (a module folder's stacked blocks), or
   * something else entirely where the slot is better spent (an agent row spends it on its
   * lifecycle dot — the caret already says the row is a folder).
   */
  icon?: ReactNode;
  /** Trailing row content: counts, badges, status dots. */
  meta?: ReactNode;
  /** The folder's contents, rendered only while it is open. */
  children?: ReactNode;
}) {
  return (
    <li className={panels.fsNode}>
      <button
        type="button"
        className={panels.fsRow}
        style={fsIndent(depth)}
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={onToggle}
      >
        <span className={panels.fsCaret} aria-hidden="true">
          <ChevronIcon className={open ? panels.fsCaretOpen : undefined} />
        </span>
        {icon ??
          (open ? (
            <FolderOpenIcon className={panels.fsIcon} />
          ) : (
            <FolderIcon className={panels.fsIcon} />
          ))}
        <span className={panels.fsName}>{name}</span>
        {meta}
      </button>
      {open && (
        // The rows under a folder carry the depth-1 indent and the folder's guideline;
        // without them every row lines up flush with its folder and the tree reads as a
        // flat list rather than as a directory.
        <ul className={panels.fsChildren} style={fsGuide(depth)}>
          {children}
        </ul>
      )}
    </li>
  );
}

/**
 * One leaf in a tree — the thing selecting opens in the detail pane.
 *
 * `depth` is the leaf's own depth, so it is one more than its folder's. A file row has
 * nothing to disclose, so it holds the caret's slot open with the `.fsFile` spacer rather
 * than with padding (a row's indent is an inline style and would beat any padding rule) —
 * which is exactly the invariant this component exists to stop every call site from having
 * to remember.
 */
export function FsFileRow({
  depth,
  selected,
  onSelect,
  name,
  ariaLabel,
  icon,
  meta,
}: {
  depth: number;
  selected: boolean;
  onSelect: () => void;
  name: ReactNode;
  /** Name the row for the folder that holds it — "root activity", "i3 overview". */
  ariaLabel: string;
  icon?: ReactNode;
  /** Trailing row content: counts, badges, status dots. */
  meta?: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        className={cx(
          panels.fsRow,
          panels.fsFile,
          selected && panels.fsRowActive,
        )}
        style={fsIndent(depth)}
        aria-label={ariaLabel}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        {icon}
        <span className={panels.fsName}>{name}</span>
        {meta}
      </button>
    </li>
  );
}
