import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { CoveragePlanSummary } from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { useGalleryData } from "../../data/galleryContext";
import { routes } from "../../routes";
import styles from "./ReviewerWidgets.module.scss";

// The two at-a-glance reviewer cards on the home page: coverage progress (rolled up
// across every coverage plan) and the count of runs nobody has reviewed. Both are
// per-account/console-only, so the caller renders this only when the host can
// execute runs and a reviewer is signed in — the data behind it needs a bearer
// token and a backend the static site does not have.
export function ReviewerWidgets() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { queryRunSummaries } = useGalleryData();

  const [plans, setPlans] = useState<CoveragePlanSummary[] | null>(null);
  const [unreviewed, setUnreviewed] = useState<number | null>(null);

  const loadCoverage = useCallback(async () => {
    if (!backend?.getCoveragePlansSummary || !token) return;
    try {
      setPlans(await backend.getCoveragePlansSummary(token));
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

  // The coverage rollup across every plan: total cells, how many are satisfied, and
  // the runs still missing.
  const cellsTotal = plans?.reduce((sum, p) => sum + p.cellsTotal, 0) ?? 0;
  const cellsSatisfied = plans?.reduce((sum, p) => sum + p.cellsSatisfied, 0) ?? 0;
  const runsMissing = plans?.reduce((sum, p) => sum + p.runsMissing, 0) ?? 0;

  // Nothing to show until at least one card has data.
  const hasCoverage = plans !== null && cellsTotal > 0;
  const hasUnreviewed = unreviewed !== null && unreviewed > 0;
  if (!hasCoverage && !hasUnreviewed) return null;

  return (
    <div className={styles.widgets}>
      <Link className={styles.widget} to={routes.accountCoverage()}>
        <span className={styles.widgetLabel}>Coverage</span>
        {hasCoverage ? (
          <span className={styles.widgetStat}>
            <strong>
              {cellsSatisfied}/{cellsTotal}
            </strong>{" "}
            cells · <strong>{runsMissing}</strong> runs missing
          </span>
        ) : (
          <span className={styles.widgetStat}>Set up a coverage plan →</span>
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
