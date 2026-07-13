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
import { routes } from "../routes";
import styles from "./RunContextMenu.module.scss";

/** Imperative handle so the run log can open the menu from a row right-click. */
export interface RunContextMenuHandle {
  /** Open the menu for `run`, anchored at the given viewport coordinates. */
  openAt: (x: number, y: number, run: RunSummary) => void;
}

interface RunContextMenuProps {
  /** Ref exposing {@link RunContextMenuHandle.openAt} for the right-click trigger. */
  ref?: Ref<RunContextMenuHandle>;
}

interface MenuState {
  x: number;
  y: number;
  run: RunSummary;
}

// Keep the popover fully on-screen: nudged in from each viewport edge by this
// margin when a cursor near the edge would otherwise clip it. Mirrors ColumnMenu.
const VIEWPORT_MARGIN = 8;

// How long the "Copy link" item shows its confirmation before the menu closes.
const COPIED_FEEDBACK_MS = 850;

// The absolute URL of a run's detail page, for the clipboard and a new tab (both
// need a full origin, not the in-app relative path a <Link> would take).
function runDetailUrl(runId: string): string {
  return `${window.location.origin}${routes.runDetail(runId)}`;
}

/**
 * The right-click menu for a run row in the run log. It offers the row's most
 * common cross-links and actions: open the run in a new tab, jump to the test
 * case or model behind it, copy the run's shareable link, and — where deletion is
 * allowed (the console / Tauri, an unpublished local run; see {@link
 * useRunDeletion}) — delete the run.
 *
 * The run log owns a single instance and opens it via the {@link
 * RunContextMenuHandle.openAt} handle from each row's `onContextMenu`, so the
 * cursor's native menu is replaced by this one. Positioning and dismissal mirror
 * the column picker so the two menus behave identically.
 */
export function RunContextMenu({ ref }: RunContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const findModel = useFindModel();
  const { canDelete, deleteRun } = useRunDeletion();

  useImperativeHandle(
    ref,
    () => ({
      openAt: (x, y, run) => {
        setCopied(false);
        setMenu({ x, y, run });
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

  if (!menu) return null;

  const { run } = menu;
  const { subject } = run;
  const model = findModel(subject.modelId, subject.harnessSlug);

  const openInNewTab = () => {
    window.open(runDetailUrl(run.id), "_blank", "noopener,noreferrer");
    close();
  };

  const openTestCase = () => {
    navigate(routes.testCaseDetail(subject.testCaseSlug));
    close();
  };

  const openModel = () => {
    if (!model) return;
    navigate(routes.modelDetail(model.slug));
    close();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(runDetailUrl(run.id));
      // Confirm in place, then close after a beat so the feedback is seen.
      setCopied(true);
      window.setTimeout(close, COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard denied/unavailable: nothing copied, so just dismiss.
      close();
    }
  };

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
    <div
      ref={popoverRef}
      className={styles.popover}
      role="menu"
      aria-label="Run actions"
      // Initial placement at the cursor; the layout effect clamps it into the
      // viewport once measured. Set inline so it never flashes at the corner.
      style={{ left: menu.x, top: menu.y }}
    >
      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={openInNewTab}
      >
        Open in new tab
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={openTestCase}
      >
        Open test case
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={openModel}
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
        onClick={copyLink}
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
    </div>
  );
}
