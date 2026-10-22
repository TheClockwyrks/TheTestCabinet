import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  NavigationType,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router";

// The in-app history of this browser tab, so an on-page back control can return to
// the page the viewer was actually on before this one rather than to a fixed parent
// route. A detail page reached from a test case's Runs tab, from a coverage plan, or
// from a model's Runs tab all return to where they were opened from, and a deep link
// with nothing behind it falls back to the parent the control names.
//
// The record mirrors a contiguous stretch of the browser's own history stack: a push
// truncates everything after the current entry and appends, a replace swaps the
// current entry, and a pop moves to the entry with the popped key. Because every
// entry below the current one is the browser entry that many steps back, a back
// control takes its step with `navigate(-n)` — a real move back through history,
// never a new push — so going back and back again walks the trail the viewer laid
// down instead of ping-ponging between two pages.
//
// Under a browser router the step is measured with the router's own position counter
// (`idx`, which it writes into `history.state` on every push and replace) rather than
// with positions in the record. The record only sees locations that render, and two
// navigations in one render (a handler that navigates twice) put two entries in the
// browser's history behind one in the record; the counter still says exactly how far
// back the target lies.

/** One recorded history entry. */
export interface HistoryEntry {
  /** React Router's location key, unique to the browser history entry. */
  key: string;
  /** The entry's path alone, which is what a page's scope is matched against. */
  pathname: string;
  /** The full in-app URL (path, query and hash), which a back link points at. */
  href: string;
  /**
   * The browser router's position counter for the entry (`history.state.idx`), or
   * `null` under a router that keeps no browser history (a memory router).
   */
  idx: number | null;
}

/** The recorded stack and the position of the current entry in it. */
export interface NavHistory {
  entries: HistoryEntry[];
  index: number;
}

// The record outlives a reload of the tab, as the browser's own history does, so a
// back control on a reloaded page still knows what was behind it. Per tab, because
// sessionStorage is.
const STORAGE_KEY = "tcab.navHistory";
// A bound on what the record keeps; the oldest entries go first, which only shortens
// how far back a control can see.
const MAX_ENTRIES = 200;

/**
 * Fold one navigation into the record. Pure: the same inputs give the same record,
 * and a navigation already folded in (a re-render, a reload) leaves it unchanged.
 */
export function advanceHistory(
  prev: NavHistory | null,
  type: NavigationType,
  entry: HistoryEntry,
): NavHistory {
  const fresh: NavHistory = { entries: [entry], index: 0 };
  if (!prev || prev.entries.length === 0) return fresh;
  const current = prev.entries[prev.index];
  if (current && current.key === entry.key && current.href === entry.href) {
    return prev;
  }
  switch (type) {
    case NavigationType.Push: {
      const entries = [...prev.entries.slice(0, prev.index + 1), entry];
      const drop = Math.max(0, entries.length - MAX_ENTRIES);
      return { entries: entries.slice(drop), index: entries.length - 1 - drop };
    }
    case NavigationType.Replace: {
      const entries = [...prev.entries];
      entries[prev.index] = entry;
      return { entries, index: prev.index };
    }
    case NavigationType.Pop: {
      // A pop to an entry the record never saw (the first load, or a return from
      // outside the app) starts a fresh record: nothing is known to lie behind it.
      const index = prev.entries.findIndex(
        (e) => e.key === entry.key && e.href === entry.href,
      );
      return index < 0 ? fresh : { entries: prev.entries, index };
    }
  }
}

function load(): NavHistory | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavHistory;
    return Array.isArray(parsed.entries) &&
      typeof parsed.index === "number" &&
      parsed.entries[parsed.index]
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function save(history: NavHistory): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage unavailable (a private window, blocked site data): the record still
    // works for this page's lifetime, it just does not survive a reload.
  }
}

const NavHistoryContext = createContext<NavHistory | null>(null);

/** The browser router's position counter for the current entry, when there is one. */
function browserIdx(): number | null {
  if (typeof window === "undefined") return null;
  const state: unknown = window.history.state;
  const idx =
    state && typeof state === "object" && "idx" in state ? state.idx : null;
  return typeof idx === "number" ? idx : null;
}

/**
 * Record the tab's in-app history for every back control beneath it. The gallery app
 * mounts this once around its routes; without it every back control uses its fallback.
 */
export function NavHistoryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const type = useNavigationType();
  const [recorded, setRecorded] = useState<NavHistory | null>(load);
  // Folded during render (React's derived-state pattern), so a page rendered for this
  // location already sees itself as the current entry. A navigation already folded in
  // returns the record unchanged, which ends the re-render.
  const history = advanceHistory(recorded, type, {
    key: location.key,
    pathname: location.pathname,
    href: `${location.pathname}${location.search}${location.hash}`,
    idx: browserIdx(),
  });
  if (history !== recorded) setRecorded(history);
  useEffect(() => save(history), [history]);
  return (
    <NavHistoryContext.Provider value={history}>
      {children}
    </NavHistoryContext.Provider>
  );
}

/**
 * A page's scope: the path its tabs and sub-views all live under, or several where the
 * page answers to more than one (a model opened by an alias as well as its slug).
 */
export type BackScope = string | readonly string[];

/** Whether `pathname` is within `scope`: one of its paths or a route beneath one. */
export function withinScope(pathname: string, scope: BackScope): boolean {
  return (typeof scope === "string" ? [scope] : scope).some((path) => {
    const base = path.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
    return pathname === base || pathname.startsWith(`${base}/`);
  });
}

/** Where a back control leads, and how to take the step. */
export interface BackTarget {
  /** The URL the control points at: the previous page, or the fallback. */
  href: string;
  /** Whether `href` is the previous page from history rather than the fallback. */
  fromHistory: boolean;
  /** Take the step: back through history to the previous page, else to the fallback. */
  go: () => void;
  /**
   * A link's click handler: takes the step through history for a plain click, and
   * leaves a modified click (a new tab, a new window) to the link's own `href`.
   */
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Resolve a back control for the page spanning `scope` (its own path, under which
 * its tabs and sub-views live): the most recent history entry outside that scope,
 * else `fallback`. A `null` scope opts out of history and always uses the fallback.
 */
export function useBackTarget(
  scope: BackScope | null,
  fallback: string,
): BackTarget {
  const history = useContext(NavHistoryContext);
  const location = useLocation();
  const navigate = useNavigate();

  let targetIndex = -1;
  // The record must be describing this very location, or its neighbours are not
  // this page's.
  if (scope !== null && history?.entries[history.index]?.key === location.key) {
    for (let i = history.index - 1; i >= 0; i--) {
      if (!withinScope(history.entries[i]!.pathname, scope)) {
        targetIndex = i;
        break;
      }
    }
  }
  const target = targetIndex >= 0 ? history!.entries[targetIndex]! : null;
  const current = history?.entries[history.index];
  const delta = !target
    ? 0
    : typeof target.idx === "number" && typeof current?.idx === "number"
      ? target.idx - current.idx
      : targetIndex - history!.index;

  const go = useCallback(() => {
    if (delta < 0) void navigate(delta);
    else void navigate(fallback);
  }, [delta, fallback, navigate]);

  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }
      // A link to the fallback is an ordinary link and navigates itself.
      if (delta >= 0) return;
      event.preventDefault();
      go();
    },
    [delta, go],
  );

  return {
    href: target ? target.href : fallback,
    fromHistory: target !== null,
    go,
    onClick,
  };
}
