import { useEffect, useMemo, useState } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type {
  LadderClimber,
  LadderProgressRung,
} from "@test-cabinet/run-record/ladders";
import { canonicalModelId } from "@test-cabinet/ui";
import { LoadingState } from "../../components/LoadingState";
import { RunLog, useRunTable } from "../../components/RunLog";
import { claimSectionReturn } from "../../components/backReturn";
import { useGalleryData } from "../../data/galleryContext";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import ladderStyles from "./Ladder.module.scss";
import styles from "./Coverage.module.scss";

// The runs behind one rung's verdict, for one climber, listed under the rung itself.
//
// This is the other half of the review loop the ladder dashboard exists to serve: the
// board says a climber walled, and the only way to agree or disagree with that is to
// look at the runs the gate counted. Listing them here rather than linking to a
// pre-filtered Runs page keeps the reviewer on the board they were reading — they open
// a run, review it, and come back to the same expanded rung.
//
// It is the shared run log, not a bespoke list: these are ordinary runs, and a rung's
// runs must show the same columns, the same ratings, the same right-click menu, and the
// same live spinner rows as every other listing of runs in the console.

// How many of a rung's runs to hold. A rung is one case × one climber, so its runs are
// counted in single figures — a ladder asks for `runsPerCell` of them, plus whatever a
// re-pin or a hand-launched run added — and a window this size is a ceiling nothing
// real reaches rather than a page.
const RUN_LIMIT = 100;

export function RungRuns({
  rung,
  climber,
}: {
  rung: LadderProgressRung;
  climber: LadderClimber;
}) {
  const { queryRunSummaries, localIds, writeups } = useGalleryData();
  const { inProgress, refreshToken } = useRunsRuntime();
  const [summaries, setSummaries] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const { slug, version, variant } = rung;
  const { harness, model } = climber;

  // Re-queried on `refreshToken` as well as on the rung's identity: that token is
  // bumped by the console stream's `finished` run events, so a run that completes while
  // this list is open leaves the spinner rows above and takes its place as a record —
  // rating, duration and all — without a navigation.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      // Produced-but-unpublished runs included: on a ladder those are precisely the
      // runs still waiting on the review that will decide the rung.
      state: "any",
      testCase: slug,
      version,
      variant,
      harness,
      model,
      // A rung pins an exact version, which the listing's "current versions only"
      // default would otherwise filter away.
      latestVersions: false,
      limit: RUN_LIMIT,
    })
      .then((result) => {
        if (!active) return;
        setSummaries(result.summaries);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSummaries([]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [queryRunSummaries, slug, version, variant, harness, model, refreshToken]);

  // The runs of this cell that are still executing. They have no record to query yet,
  // so they are matched out of the runtime's in-flight list by the same identity the
  // query filters on — the model ids are canonicalized because a launch may name a
  // model in a form the catalog spells differently.
  const active = useMemo(
    () =>
      inProgress.filter(
        (run) =>
          run.testCaseSlug === slug &&
          run.testCaseVersion === version &&
          run.variant === variant &&
          run.harnessSlug === harness &&
          canonicalModelId(run.modelId) === canonicalModelId(model),
      ),
    [inProgress, slug, version, variant, harness, model],
  );

  // The case, its version and variant, the harness and the model are all fixed by the
  // rung and the climber, so the log drops the columns that would repeat them.
  const table = useRunTable({
    runs: summaries,
    localIds,
    localWriteups: writeups,
    scope: "variant",
  });

  const empty = summaries.length === 0 && active.length === 0;

  return (
    // Any link out of this list is a step *into* the review loop, so the claim is made
    // for the whole list rather than per row: a run opened from here returns to this
    // ladder, not to the global runs index.
    <div
      className={ladderStyles.rungRuns}
      onClickCapture={() =>
        claimSectionReturn("coverage", "Back to the ladder")
      }
    >
      {loading && empty ? (
        <LoadingState size="section" label="Loading this rung's runs…" />
      ) : empty ? (
        <p className={styles.empty}>
          No runs of this rung yet for {climber.model}. Topping the ladder up is
          what asks for them.
        </p>
      ) : (
        <RunLog rows={table.rows} active={active} controls={table.controls} />
      )}
    </div>
  );
}
