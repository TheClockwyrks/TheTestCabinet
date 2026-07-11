import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { CoverageMatrix } from "@test-cabinet/run-record/review-plan";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import { useGalleryData } from "../../data/galleryContext";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { launchBatch } from "../runs/launchBatch";
import { itemsForCells } from "../runs/CoveragePage";
import { routes } from "../../routes";
import styles from "./ReviewerWidgets.module.scss";

// The two at-a-glance reviewer cards on the home page: coverage progress (with a
// one-click "trigger all missing") and the count of runs nobody has reviewed. Both
// are per-account/console-only, so the caller renders this only when the host can
// execute runs and a reviewer is signed in — the data behind it needs a bearer
// token and a backend the static site does not have.
export function ReviewerWidgets() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const { queryRunSummaries } = useGalleryData();

  const [coverage, setCoverage] = useState<CoverageMatrix | null>(null);
  const [unreviewed, setUnreviewed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCoverage = useCallback(async () => {
    if (!backend?.getCoverage || !token) return;
    try {
      setCoverage(await backend.getCoverage(token));
    } catch {
      /* the widget stays hidden on a coverage error */
    }
  }, [backend, token]);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  // A cheap page-0 summary query returns the total unreviewed count without
  // fetching a full page of cards.
  useEffect(() => {
    let active = true;
    queryRunSummaries({ state: "unreviewed", offset: 0, limit: 1 })
      .then((res) => active && setUnreviewed(res.total))
      .catch(() => active && setUnreviewed(null));
    return () => {
      active = false;
    };
  }, [queryRunSummaries]);

  const canTrigger = Boolean(worker && (worker.local || token));

  async function triggerAllMissing() {
    if (!coverage || !worker || !canTrigger) return;
    const items = itemsForCells(coverage.cells.filter((c) => c.remaining > 0));
    if (items.length === 0) return;
    setBusy(true);
    try {
      await launchBatch(worker, token, runtime.track, items);
      await loadCoverage();
    } finally {
      setBusy(false);
    }
  }

  // Nothing to show until at least one card has data.
  const hasCoverage = coverage !== null && coverage.cellsTotal > 0;
  const hasUnreviewed = unreviewed !== null && unreviewed > 0;
  if (!hasCoverage && !hasUnreviewed) return null;

  return (
    <div className={styles.widgets}>
      <Link className={styles.widget} to={routes.runCoverage()}>
        <span className={styles.widgetLabel}>Coverage</span>
        {hasCoverage ? (
          <>
            <span className={styles.widgetStat}>
              <strong>
                {coverage!.cellsSatisfied}/{coverage!.cellsTotal}
              </strong>{" "}
              cells · <strong>{coverage!.runsMissing}</strong> runs missing
            </span>
            {coverage!.runsMissing > 0 && (
              <button
                type="button"
                className={styles.widgetAction}
                disabled={busy || !canTrigger}
                onClick={(e) => {
                  // The card is a link; keep the button from navigating.
                  e.preventDefault();
                  void triggerAllMissing();
                }}
              >
                {busy ? "Triggering…" : "Trigger all missing"}
              </button>
            )}
          </>
        ) : (
          <span className={styles.widgetStat}>Set up your review plan →</span>
        )}
      </Link>

      <Link className={styles.widget} to={routes.runUnreviewed()}>
        <span className={styles.widgetLabel}>Unreviewed</span>
        <span className={styles.widgetStat}>
          <strong>{unreviewed ?? 0}</strong> runs need a first review
        </span>
      </Link>
    </div>
  );
}
