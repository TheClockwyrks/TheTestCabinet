import { useCallback, useState } from "react";
import { Link } from "react-router";
import { Panel } from "@clockwyrks/ui";
import type { Comparison } from "@clockwyrks/run-record/comparison";
import { useAuth } from "../../../client/auth";
import { useOptionalBackend } from "../../../client/context";
import { LoadingState } from "../../components/LoadingState";
import { SubmitNotice } from "../../components/SubmitNotice";
import { useConfirm } from "../../components/ConfirmDialog";
import { useGalleryData } from "../../data/galleryContext";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import { useComparisons } from "../../data/useComparisons";
import exec from "../runs/RunExec.module.scss";
import styles from "./Comparisons.module.scss";

// The Comparisons list body (`/runs/comparisons`): the signed-in account's saved
// comparisons, each a card naming its case/variant, arm count, `N`, and published
// state, linking to its detail view. Rendered inside the Runs section's tabbed
// page, which owns the surrounding chrome and the "New comparison" header action
// — mirroring how `TournamentsList`/`GameJamsList` are the content for their
// own tabs. A
// comparison is per-account (like a coverage plan or a gg configuration), so a
// signed-out visitor sees a sign-in prompt in place of the list.
export function ComparisonsList() {
  const { token } = useAuth();
  const { canExecute } = useGalleryData();
  // Optional: the read-only static site mounts no backend provider at all, and
  // renders this list off the published snapshot. No client ⇒ nothing to delete.
  const backend = useOptionalBackend()?.client ?? null;
  const { comparisons, loading, error, reload } = useComparisons();
  const testCaseName = useTestCaseName();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Deleting is a per-account mutation, so it is console-only and signed-in —
  // the public gallery renders the same list without the affordance.
  const canDelete = Boolean(canExecute && token && backend?.deleteComparison);

  const deleteComparison = useCallback(
    async (comparison: Comparison) => {
      if (!backend?.deleteComparison || !token) return;
      // Destructive, so it asks through the app's own themed dialog rather than
      // the browser's `confirm()` (docs/components/ui/overview.md, "Dialogs").
      const confirmed = await confirm({
        title: "Delete comparison",
        message: (
          <>
            Delete <strong>{comparison.name}</strong>? Its configuration and
            every figure computed from it are removed. The runs it launched are
            ordinary runs and are <strong>not</strong> deleted. This cannot be
            undone.
          </>
        ),
        confirmLabel: "Delete comparison",
      });
      if (!confirmed) return;
      setBusy(true);
      setActionError(null);
      try {
        await backend.deleteComparison(comparison.id, token);
        await reload();
      } catch (e) {
        setActionError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, confirm, reload],
  );

  // A console (can execute) needs a signed-in account, since comparisons are saved
  // per-account. A read-only host (the static site) renders the published set with
  // no sign-in — so the prompt shows only on a signed-out console.
  if (canExecute && !token) {
    return (
      <Panel>
        <p className={styles.empty}>
          Sign in to use harness comparisons. They are saved to your account.
          Use the account control in the top bar to register or log in.
        </p>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel>
        <p className={styles.empty}>Could not load comparisons: {error}</p>
      </Panel>
    );
  }
  if (loading) {
    return (
      <Panel>
        <LoadingState size="section" label="Loading comparisons…" />
      </Panel>
    );
  }
  if (comparisons.length === 0) {
    // No call to action here: "New comparison" sits in the page header just
    // above, so a second button would only repeat it.
    return (
      <div className={styles.emptyState}>
        <p className={styles.empty}>
          No comparisons yet.{" "}
          {canExecute ? "Create one to run" : "A comparison runs"} the same case
          under several configurations (harnesses, gg configurations, or both)
          and publishes the cost, token, and score spread side by side.
        </p>
      </div>
    );
  }

  return (
    <>
      <SubmitNotice message={actionError} />
      <div className={styles.list}>
        {comparisons.map((comparison) => (
          // The card element is not an anchor — a card-wide `<a>` cannot hold a
          // delete button (interactive content inside a link), and it dragged
          // the global `a:hover` underline across every span in the row. The
          // whole card still navigates and still lights up on hover: the title
          // link stretches an invisible overlay across it in CSS
          // (`.rowTitleLink::after`), so the row keeps one link, the underline
          // stays on the name alone, and the delete button sits above the
          // overlay.
          <div key={comparison.id} className={styles.rowCard}>
            <div className={styles.rowMain}>
              <Link
                className={styles.rowTitleLink}
                to={routes.comparisonDetail(comparison.id)}
              >
                {comparison.name}
              </Link>
              <span className={styles.rowSub}>
                {testCaseName(comparison.config.controls.caseSlug)} ·{" "}
                {comparison.config.controls.variant} ·{" "}
                {comparison.config.controls.version}
              </span>
            </div>
            <div className={styles.rowRight}>
              <span className={styles.rowStat}>
                {comparison.config.arms.length}{" "}
                {comparison.config.arms.length === 1 ? "arm" : "arms"}
              </span>
              <span className={styles.rowStat}>N={comparison.config.n}</span>
              {comparison.published && (
                <span className={styles.publishedBadge}>Published</span>
              )}
              {canDelete && (
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={exec.danger}
                    disabled={busy}
                    onClick={() => deleteComparison(comparison)}
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
