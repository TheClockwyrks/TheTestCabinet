import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { CoveragePlanSummary } from "@test-cabinet/run-record/coverage";
import type { LadderProgress } from "@test-cabinet/run-record/ladders";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { useGalleryData } from "../../data/galleryContext";
import { routes } from "../../routes";
import styles from "./ReviewerWidgets.module.scss";

// The at-a-glance reviewer cards on the home page: coverage progress (rolled up
// across every coverage plan), where the ladders have stopped, and the count of runs
// nobody has reviewed. All are per-account/console-only, so the caller renders this
// only when the host can execute runs and a reviewer is signed in — the data behind
// it needs a bearer token and a backend the static site does not have.
export function ReviewerWidgets() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { queryRunSummaries } = useGalleryData();

  const [plans, setPlans] = useState<CoveragePlanSummary[] | null>(null);
  const [boards, setBoards] = useState<LadderProgress[] | null>(null);
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

  // The ladders' boards. A board is a request per ladder, so the cheap listing is
  // asked first and the boards are only fetched when there is at least one ladder —
  // which is what keeps this card free for the accounts that do not use ladders. A
  // board that fails to load is simply left out of the roll-up rather than hiding the
  // card; the widget is a glance, and the ladders page is where the truth is.
  const loadLadders = useCallback(async () => {
    const boardOf = backend?.getLadderProgress;
    if (!backend?.listLadders || !boardOf || !token) return;
    try {
      const ladders = await backend.listLadders(token);
      if (ladders.length === 0) {
        setBoards([]);
        return;
      }
      const settled = await Promise.allSettled(
        ladders.map((entry) => boardOf.call(backend, entry.id, token)),
      );
      setBoards(
        settled.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        ),
      );
    } catch {
      /* the widget stays hidden on a ladders error */
    }
  }, [backend, token]);

  useEffect(() => {
    void loadLadders();
  }, [loadLadders]);

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
  const cellsSatisfied =
    plans?.reduce((sum, p) => sum + p.cellsSatisfied, 0) ?? 0;
  const runsMissing = plans?.reduce((sum, p) => sum + p.runsMissing, 0) ?? 0;

  // The ladder rollup across every board: how many climbers have stopped, and how.
  // "Walled" is the headline because it is the answer a ladder exists to produce —
  // the models that got as far as they are going to get.
  const climbers = boards?.reduce((sum, b) => sum + b.climbers.length, 0) ?? 0;
  const walled = boards?.reduce((sum, b) => sum + b.climbersWalled, 0) ?? 0;
  const toppedOut =
    boards?.reduce((sum, b) => sum + b.climbersToppedOut, 0) ?? 0;

  // Nothing to show until at least one card has data.
  const hasCoverage = plans !== null && cellsTotal > 0;
  const hasLadders = boards !== null && climbers > 0;
  const hasUnreviewed = unreviewed !== null && unreviewed > 0;
  if (!hasCoverage && !hasLadders && !hasUnreviewed) return null;

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

      {/* Only shown once a ladder has climbers: an account that does not use ladders
          should not be advertised a section, and a ladder with nobody on it has
          nothing to report. */}
      {hasLadders && (
        <Link className={styles.widget} to={routes.accountLadders()}>
          <span className={styles.widgetLabel}>Ladders</span>
          <span className={styles.widgetStat}>
            <strong>{walled}</strong> walled · <strong>{toppedOut}</strong>{" "}
            topped out of <strong>{climbers}</strong>
          </span>
        </Link>
      )}

      <Link className={styles.widget} to={routes.runUnreviewed()}>
        <span className={styles.widgetLabel}>Unreviewed</span>
        <span className={styles.widgetStat}>
          <strong>{unreviewed ?? 0}</strong> runs need a first review
        </span>
      </Link>
    </div>
  );
}
