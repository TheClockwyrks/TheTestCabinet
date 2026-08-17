import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { PageLayout } from "./PageLayout";
import { routes } from "../routes";
import styles from "./PageErrorBoundary.module.scss";

// The routed body's error boundary.
//
// A React component that throws while rendering unmounts *the whole tree* unless
// something catches it — so before this existed, one page reading a field a
// backend hadn't sent (a case summary with no `name`, sorted by name in the run
// filter bar) blanked the entire console: no topbar, no nav, no way out but the
// browser's back button, and nothing on screen saying what happened. The bug that
// cost a page should cost that page, and this is what makes that true. It is the
// runtime half of the safeguard; the route smoke test
// (`pages/routeSmoke.test.tsx`) is the half that stops a page from getting here.
//
// It deliberately keeps the app's chrome: the section nav is how somebody leaves a
// page that failed, which is worth more than a bare full-screen message.

interface PageErrorBoundaryProps {
  /** The routed body to guard. */
  children: ReactNode;
  /** Changing this clears a caught error and re-renders `children` — the host
   * passes the current path, so navigating away from a broken page recovers
   * rather than sticking on its message. */
  resetKey: string;
}

interface PageErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previous: PageErrorBoundaryProps): void {
    // A new route is a fresh attempt: drop the caught error so the next page
    // renders. Without this the boundary would hold its message over every
    // subsequent navigation.
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack and the component trace in the console: this boundary makes
    // the failure survivable, and a survivable failure must not also be a silent
    // one — the report is how it still gets diagnosed and fixed.
    console.error("Page failed to render:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <PageLayout>
        <div className={styles.panel} role="alert">
          <h1 className={styles.title}>This page hit an error</h1>
          <p className={styles.body}>
            Something on this page failed to render. The rest of the app still
            works — use the navigation above, or reload to try again.
          </p>
          {/* The message, not the stack: enough to recognize and report the
              failure without turning the page into a debugger. The full error and
              component trace go to the browser console. */}
          <pre className={styles.detail}>{error.message || String(error)}</pre>
          <p className={styles.actions}>
            <Link className={styles.link} to={routes.home()}>
              Go home
            </Link>
          </p>
        </div>
      </PageLayout>
    );
  }
}

/**
 * Guard the routed page body, resetting whenever the path changes.
 *
 * A function wrapper so the reset key can come from the router — an error
 * boundary has to be a class component, and a class cannot call `useLocation`.
 */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
