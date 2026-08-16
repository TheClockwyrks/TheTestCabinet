import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { useNavigate } from "react-router";
import { useFindModel } from "../data/useModels";
import { CONFIRM_DELETE_RUN, useRunDeletion } from "../data/useRunDeletion";
import { useRunKill } from "../data/useRunKill";
import { routes } from "../routes";
import type { SelectableRun } from "./RunSelect";
import styles from "./RunContextMenu.module.scss";

/**
 * What a run-log right-click acts on: a single row (no selection), or the whole
 * checked set (the batch menu). The single case carries the full summary the
 * per-run links read; the batch case carries the pre-resolved {@link
 * SelectableRun} descriptors so the menu needs nothing more to act on the set.
 */
export type RunMenuTarget =
  | { kind: "single"; run: RunSummary }
  | { kind: "batch"; runs: SelectableRun[] };

/** Imperative handle so the run log can open the menu from a row right-click. */
export interface RunContextMenuHandle {
  /** Open the menu for `target`, anchored at the given viewport coordinates. */
  openAt: (x: number, y: number, target: RunMenuTarget) => void;
}

interface RunContextMenuProps {
  /** Ref exposing {@link RunContextMenuHandle.openAt} for the right-click trigger. */
  ref?: Ref<RunContextMenuHandle>;
  /**
   * Called after a batch kill/delete succeeds (or partly does), so the run log can
   * drop the now-acted-on selection. Not called for the read-only batch items
   * (opening tabs, copying links) or the single-run menu.
   */
  onBatchActed?: () => void;
}

interface MenuState {
  x: number;
  y: number;
  target: RunMenuTarget;
}

// Keep the popover fully on-screen: nudged in from each viewport edge by this
// margin when a cursor near the edge would otherwise clip it. Mirrors ColumnMenu.
const VIEWPORT_MARGIN = 8;

// How long the "Copy link(s)" item shows its confirmation before the menu closes.
const COPIED_FEEDBACK_MS = 850;

// An absolute URL for an in-app path, for the clipboard and a new tab (both need a
// full origin, not the relative path a <Link> would take).
function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

// A run's own page: a finished run's detail, or an in-progress run's live monitor
// (it has no detail until it completes).
function runPageUrl(run: SelectableRun): string {
  return absoluteUrl(
    run.active ? routes.runMonitor(run.id) : routes.runDetail(run.id),
  );
}

// Open a URL in a new foreground tab and switch to it. `window.open` opens a
// new tab; focusing the returned window brings it to the front where the
// browser leaves that to us.
function openForegroundTab(url: string): void {
  const win = window.open(url, "_blank", "noopener,noreferrer");
  win?.focus();
}

// Open a URL in a new *background* tab without stealing focus from the current
// one. There's no `window.open` flag for this, so we synthesize a modifier-click
// on a throwaway anchor — the same gesture a user makes to background a link.
// Setting both ctrl (Windows/Linux) and meta (macOS) covers either platform;
// each honors only its own modifier.
function openBackgroundTab(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener,noreferrer";
  a.dispatchEvent(
    new MouseEvent("click", {
      ctrlKey: true,
      metaKey: true,
      bubbles: false,
      cancelable: true,
    }),
  );
}

// "3 runs" / "1 run": a count with a naively pluralized noun, for the batch labels.
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// The distinct values of `pick` across the runs, dropping the empties — for the
// de-duped test-case and model sets the batch "open" items target.
function distinct<T>(
  runs: readonly SelectableRun[],
  pick: (run: SelectableRun) => T | undefined | null,
): T[] {
  const set = new Set<T>();
  for (const run of runs) {
    const value = pick(run);
    if (value != null) set.add(value);
  }
  return [...set];
}

/**
 * The right-click menu for the run log. With no selection it acts on the one row
 * clicked: open the run in a new foreground tab (Open) or a background one (Open
 * in new tab), jump to the test case or model behind it, copy its link, and —
 * where deletion is allowed (see {@link useRunDeletion}) — delete it. With a live
 * selection it becomes a batch menu over the whole checked set: open every run in
 * its own tab, open the de-duped test cases or models in tabs, copy all the links,
 * and — where the host allows — kill the still-running ones and delete the
 * deletable ones.
 *
 * The run log owns a single instance and opens it via the {@link
 * RunContextMenuHandle.openAt} handle from each row's `onContextMenu`, so the
 * cursor's native menu is replaced by this one. Positioning and dismissal mirror
 * the column picker so the two menus behave identically.
 */
export function RunContextMenu({ ref, onBatchActed }: RunContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const findModel = useFindModel();
  const { canDelete, deleteRun } = useRunDeletion();
  const { canKill, killRun } = useRunKill();

  useImperativeHandle(
    ref,
    () => ({
      openAt: (x, y, target) => {
        setCopied(false);
        setMenu({ x, y, target });
      },
    }),
    [],
  );

  const close = useCallback(() => setMenu(null), []);

  // Dismiss on outside pointerdown or Escape while open.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, close]);

  // Once positioned, clamp the popover inside the viewport so a near-edge cursor
  // doesn't push it off-screen.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { x, y } = menu;
    const maxX = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    const maxY = window.innerHeight - rect.height - VIEWPORT_MARGIN;
    x = Math.max(VIEWPORT_MARGIN, Math.min(x, maxX));
    y = Math.max(VIEWPORT_MARGIN, Math.min(y, maxY));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [menu]);

  // Copy `text` to the clipboard, confirming in place before the menu closes; on a
  // denied/absent clipboard it just dismisses. Shared by both Copy-link items.
  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(close, COPIED_FEEDBACK_MS);
      } catch {
        close();
      }
    },
    [close],
  );

  if (!menu) return null;

  return (
    <div
      ref={popoverRef}
      className={styles.popover}
      role="menu"
      aria-label="Run actions"
      // Initial placement at the cursor; the layout effect clamps it into the
      // viewport once measured. Set inline so it never flashes at the corner.
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.target.kind === "single"
        ? renderSingle(menu.target.run)
        : renderBatch(menu.target.runs)}
    </div>
  );

  // The one-row menu: the run's cross-links and, where allowed, delete.
  function renderSingle(run: RunSummary) {
    const { subject } = run;
    const model = findModel(subject.modelId, subject.harnessSlug);
    const detailUrl = absoluteUrl(routes.runDetail(run.id));

    const onDelete = async () => {
      close();
      if (!window.confirm(CONFIRM_DELETE_RUN)) return;
      try {
        await deleteRun(run.id);
      } catch (e) {
        window.alert(`Could not delete run: ${String(e)}`);
      }
    };

    return (
      <>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            openForegroundTab(detailUrl);
            close();
          }}
        >
          Open
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            openBackgroundTab(detailUrl);
            close();
          }}
        >
          Open in new tab
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            navigate(routes.testCaseDetail(subject.testCaseSlug));
            close();
          }}
        >
          Open test case
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            if (!model) return;
            navigate(routes.modelDetail(model.slug));
            close();
          }}
          // The model has a page only when it's in the catalog; an unrecognized run
          // model has nowhere to link, so the item is present but disabled.
          disabled={!model}
          title={model ? undefined : "This model isn’t in the catalog"}
        >
          Open model
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => void copyText(detailUrl)}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        {canDelete(run.id) && (
          <>
            <div className={styles.separator} role="separator" />
            <button
              type="button"
              role="menuitem"
              className={`${styles.item} ${styles.itemDanger}`}
              onClick={onDelete}
            >
              Delete run
            </button>
          </>
        )}
      </>
    );
  }

  // The batch menu over the checked set: open each run/test-case/model in a tab,
  // copy every link, and — where the host allows — kill the running ones and
  // delete the deletable ones. The open/copy items always show; the destructive
  // ones appear only when at least one selected run qualifies.
  function renderBatch(runs: SelectableRun[]) {
    const testCaseSlugs = distinct(runs, (run) => run.testCaseSlug);
    const modelSlugs = distinct(
      runs,
      (run) => findModel(run.modelId, run.harnessSlug)?.slug,
    );
    // Only in-progress runs can be killed, and only where the host allows it.
    const killable = canKill ? runs.filter((run) => run.killable) : [];
    const deletable = runs.filter((run) => canDelete(run.id));

    const onKill = async () => {
      close();
      if (
        !window.confirm(
          `Kill ${plural(killable.length, "run")}? They stop immediately and ` +
            "are recorded as canceled. This cannot be undone.",
        )
      ) {
        return;
      }
      const outcomes = await Promise.allSettled(
        killable.map((run) => killRun(run.id)),
      );
      reportFailures(outcomes, "kill");
      onBatchActed?.();
    };

    const onDelete = async () => {
      close();
      if (
        !window.confirm(
          `Delete ${plural(deletable.length, "run")} permanently? Their ` +
            "records, reviews, and stored media are removed. This cannot be " +
            "undone.",
        )
      ) {
        return;
      }
      const outcomes = await Promise.allSettled(
        deletable.map((run) => deleteRun(run.id)),
      );
      reportFailures(outcomes, "delete");
      onBatchActed?.();
    };

    return (
      <>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            for (const run of runs) openBackgroundTab(runPageUrl(run));
            close();
          }}
        >
          {runs.length === 1
            ? "Open run in new tab"
            : `Open ${plural(runs.length, "run")} in new tabs`}
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            for (const slug of testCaseSlugs)
              openBackgroundTab(absoluteUrl(routes.testCaseDetail(slug)));
            close();
          }}
        >
          {testCaseSlugs.length === 1
            ? "Open test case"
            : `Open ${plural(testCaseSlugs.length, "test case")}`}
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            for (const slug of modelSlugs)
              openBackgroundTab(absoluteUrl(routes.modelDetail(slug)));
            close();
          }}
          // Nothing to open when none of the selected runs' models are known.
          disabled={modelSlugs.length === 0}
          title={
            modelSlugs.length === 0
              ? "None of these runs’ models are in the catalog"
              : undefined
          }
        >
          {modelSlugs.length <= 1
            ? "Open model"
            : `Open ${plural(modelSlugs.length, "model")}`}
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() =>
            void copyText(runs.map((run) => runPageUrl(run)).join("\n"))
          }
        >
          {copied ? "Copied!" : "Copy links"}
        </button>
        {(killable.length > 0 || deletable.length > 0) && (
          <div className={styles.separator} role="separator" />
        )}
        {killable.length > 0 && (
          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.itemDanger}`}
            onClick={onKill}
          >
            {`Kill ${plural(killable.length, "run")}`}
          </button>
        )}
        {deletable.length > 0 && (
          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.itemDanger}`}
            onClick={onDelete}
          >
            {`Delete ${plural(deletable.length, "run")}`}
          </button>
        )}
      </>
    );
  }
}

// Surface a batch mutation's failures: how many of the requests rejected, if any.
function reportFailures(
  outcomes: PromiseSettledResult<unknown>[],
  verb: "kill" | "delete",
): void {
  const failed = outcomes.filter((o) => o.status === "rejected").length;
  if (failed > 0) {
    window.alert(`Could not ${verb} ${failed} of ${outcomes.length} runs.`);
  }
}
