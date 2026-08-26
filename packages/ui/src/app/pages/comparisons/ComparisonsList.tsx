import { Link } from "react-router";
import { Panel } from "@test-cabinet/ui";
import { useAuth } from "../../../client/auth";
import { LoadingState } from "../../components/LoadingState";
import { useGalleryData } from "../../data/galleryContext";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import { useComparisons } from "../../data/useComparisons";
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
  const { comparisons, loading, error } = useComparisons();
  const testCaseName = useTestCaseName();

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
    <div className={styles.list}>
      {comparisons.map((comparison) => (
        <Link
          key={comparison.id}
          className={styles.rowCard}
          to={routes.comparisonDetail(comparison.id)}
        >
          <div className={styles.rowMain}>
            <span className={styles.rowTitleLink}>{comparison.name}</span>
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
          </div>
        </Link>
      ))}
    </div>
  );
}
