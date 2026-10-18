import { useCallback, useEffect, useRef } from "react";
import { type BlockerFunction, useBlocker, useLocation } from "react-router";

/** What a form holding unsaved work learns about, and does with, an attempt to leave it. */
export interface LeaveGuard {
  /** Whether a navigation away is being held for the operator's answer. */
  held: boolean;
  /** Let the held navigation go on: the work was saved, or the operator discarded it. */
  proceed: () => void;
  /** Drop the held navigation and stay on the form. */
  stay: () => void;
  /**
   * Let the page's own next navigation through unasked. For an exit the page takes itself
   * once the question is settled — after a save, say — while the form still reads as dirty
   * because the baseline it measures against is never re-taken on the way out.
   */
  release: () => void;
}

/**
 * Hold every navigation away from a form while `dirty` is true, so the page can ask
 * before throwing the work away: a link anywhere in the app, the page's own back control,
 * a programmatic `navigate`, and the browser's back and forward alike. A navigation that
 * stays on the same path and query (a hash change, a link to the page itself) leaves the
 * form where it is, so it is not held.
 *
 * The tab going away — closing it, reloading it, typing a new address — is not a router
 * navigation, so no component can answer it; the browser's own prompt covers that case.
 *
 * Requires a data router (`createBrowserRouter`, `createMemoryRouter`), which is the only
 * kind React Router can block navigation on.
 */
export function useLeaveGuard(dirty: boolean): LeaveGuard {
  // Read when a navigation is attempted rather than captured per render: a save that
  // releases and navigates in one handler must not be held by the blocker function the
  // render before it registered.
  const released = useRef(false);

  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        dirty &&
        !released.current &&
        (currentLocation.pathname !== nextLocation.pathname ||
          currentLocation.search !== nextLocation.search),
      [dirty],
    ),
  );

  // A release covers the one exit it was given for. React Router keeps a page mounted
  // across a move between two routes that render it (one configuration's editor to
  // another's), and the form it then loads is guarded afresh.
  const { pathname, search } = useLocation();
  useEffect(() => {
    released.current = false;
  }, [pathname, search]);

  // The blocker as it stands now, for a decision taken after an await: the save the dialog
  // started may finish after some other navigation has already settled the hold, and
  // proceeding with a blocker that is no longer holding anything is an error to the router.
  const current = useRef(blocker);
  useEffect(() => {
    current.current = blocker;
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return {
    held: blocker.state === "blocked",
    proceed: useCallback(() => {
      released.current = true;
      const now = current.current;
      if (now.state === "blocked") now.proceed();
    }, []),
    stay: useCallback(() => {
      const now = current.current;
      if (now.state === "blocked") now.reset();
    }, []),
    release: useCallback(() => {
      released.current = true;
    }, []),
  };
}
