import type {
  LadderClimber,
  LadderProgressRung,
  LadderSlot,
} from "@clockwyrks/backend-api/ladders";
import type { RunSummary } from "@clockwyrks/backend-api/snapshot";
import { useEffect, useMemo, useState } from "react";
import { canonicalModelId } from "@clockwyrks/ui";
import { LoadingState } from "../../components/LoadingState";
import { RunLog, useRunTable } from "../../components/RunLog";
import { claimSectionReturn } from "../../components/backReturn";
import { useGalleryData } from "../../data/galleryContext";
import { resolveEngineSlug } from "../../data/engines";
import { ggConfigKey } from "./comboLabels";
import { caseEngine } from "./caseLabels";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import ladderStyles from "./Ladder.module.scss";
import styles from "./Coverage.module.scss";

// The runs behind one rung slot's verdict, for one climber, listed under the rung
// itself — only the runs the latest dispatch launched for that slot, because only
// those count for it: a run of the same case and model from a plan, a hand launch or
// an earlier dispatch is not this dispatch's evidence.
//
// The board says a climber passed or failed a rung, and the way to see why is to look
// at the runs the gate counted. Listing them here rather than
// linking to a pre-filtered Runs page keeps the reader on the board they were reading —
// they open a run, label it if they like, and come back to the same expanded rung.
//
// It is the shared run log, not a bespoke list: these are ordinary runs, and a rung's
// runs must show the same columns, the same ratings, the same right-click menu, and the
// same live spinner rows as every other listing of runs in the console.

// How many of a rung's runs to hold. A rung is one case × one climber, so its runs are
// counted in single figures, and a window this size over the cell's runs is a ceiling
// the dispatch's own runs never reach in practice.
const RUN_LIMIT = 100;

export function RungRuns({
  rung,
  climber,
  slot,
}: {
  rung: LadderProgressRung;
  climber: LadderClimber;
  /** The dispatch's slot: its counted runs and its jobs still in flight. */
  slot: LadderSlot;
}) {
  const { queryRunSummaries, localIds, writeups } = useGalleryData();
  const { inProgress, refreshToken } = useRunsRuntime();
  const [summaries, setSummaries] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const { slug, version, variant } = rung;
  // The rung's engine, resolved. It is part of the rung's identity within the climb —
  // one ladder holds the same case at the same version and variant twice when the two
  // pins name different engines — and the gate counts through the same segment, so a
  // listing that ignored it would show the other rung's runs as the evidence behind
  // this rung's verdict.
  const engine = caseEngine(rung);
  const { harness, model } = climber;
  // A gg climber's runs are the ones launched from its configuration, which the
  // harness and the model alone do not say: every gg climber on this model runs the
  // `gg` harness. The rung's verdict counts by the configuration's id, so the listing
  // behind it narrows by the same id.
  const ggConfigId = ggConfigKey(climber.ggConfigId);
  // The dispatch's own runs of this slot: its counted runs (records) and its jobs still
  // in flight. Keyed by their joined ids so a re-read board with the same runs does not
  // re-query.
  const runIdsKey = slot.runIds.join("|");
  const jobIdsKey = slot.jobIds.join("|");
  const runIds = useMemo(
    () => new Set(runIdsKey ? runIdsKey.split("|") : []),
    [runIdsKey],
  );
  const jobIds = useMemo(
    () => new Set(jobIdsKey ? jobIdsKey.split("|") : []),
    [jobIdsKey],
  );

  // Re-queried on `refreshToken` as well as on the rung's identity: that token is
  // bumped by the console stream's `finished` run events, so a run that completes while
  // this list is open leaves the spinner rows above and takes its place as a record —
  // rating, duration and all — without a navigation.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      // Produced-but-unpublished runs included: a validator-rated run is rated the
      // moment it completes, published or not, and the gate counts it either way.
      state: "any",
      testCase: slug,
      version,
      variant,
      harness,
      model,
      engine,
      ggConfigId: ggConfigId || undefined,
      // A rung pins an exact version, which the listing's "current versions only"
      // default would otherwise filter away.
      latestVersions: false,
      limit: RUN_LIMIT,
    })
      .then((result) => {
        if (!active) return;
        setSummaries(result.summaries.filter((run) => runIds.has(run.id)));
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
  }, [
    queryRunSummaries,
    slug,
    version,
    variant,
    engine,
    harness,
    model,
    ggConfigId,
    runIds,
    refreshToken,
  ]);

  // The slot's runs that are still executing. They have no record to query yet, so
  // they are matched out of the runtime's in-flight list by the dispatch's job ids, and
  // by the same identity the query filters on — the model ids are canonicalized because
  // a launch may name a model in a form the catalog spells differently.
  const active = useMemo(
    () =>
      inProgress.filter(
        (run) =>
          jobIds.has(run.runId) &&
          run.testCaseSlug === slug &&
          run.testCaseVersion === version &&
          run.variant === variant &&
          // Resolved on both sides: an engineless run is spelled as an absent field by
          // a launch that named none and as `none` by one that named it, and the two
          // are one engine.
          resolveEngineSlug(run.engine) === engine &&
          run.harnessSlug === harness &&
          canonicalModelId(run.modelId) === canonicalModelId(model),
      ),
    [inProgress, jobIds, slug, version, variant, engine, harness, model],
  );

  // The case, its version, variant and engine, the harness and the model are all fixed
  // by the rung and the climber, so the log drops the columns that would repeat them.
  const table = useRunTable({
    runs: summaries,
    localIds,
    localWriteups: writeups,
    scope: "variant",
  });

  const empty = summaries.length === 0 && active.length === 0;

  return (
    // Any link out of this list leads into a run's pages, so the claim is made
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
          No runs of this rung yet for {climber.model} in this dispatch. The
          ladder launches them as the climber reaches the rung.
        </p>
      ) : (
        <RunLog rows={table.rows} active={active} controls={table.controls} />
      )}
    </div>
  );
}
