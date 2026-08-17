import { useCallback, useId, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  DonutChartWidget,
  Panel,
  ReliabilityRingWidget,
  type DonutSegment,
  type ReliabilitySegment,
} from "@test-cabinet/ui";
import { rollupRuns } from "@test-cabinet/run-stats/rollup";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { LoadingState } from "../../../components/LoadingState";
import {
  useVersionScope,
  versionInScope,
  VersionScopeControl,
} from "../../../components/VersionScope";
import type { ModelSummary } from "../../../data/models";
import {
  meanReported,
  modelCaseOptions,
  runIsModel,
  standInField,
  type FieldStanding,
  type ModelCaseOption,
  type ModelVariantOption,
} from "../../../data/modelComparison";
import { RATINGS, RATING_META } from "../../../data/ratings";
import { useModelRunSummaries } from "../../../data/useModelRunSummaries";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { compareVersions } from "../../../data/versions";
import {
  formatCompact,
  formatInteger,
  formatRunTime,
  formatUsd,
  totalTokens,
} from "../../../format";
import { ModelDetailLayout } from "../../../layouts/models/ModelDetailLayout";
import styles from "./ModelOverviewPage.module.scss";

// The query-string keys the selected cohort is carried in, so a specific case +
// variant view of a model is linkable and survives a tab switch. The default
// selection is the absence of the parameter, keeping the plain `/models/<id>` URL
// clean (the same convention the case detail's variant picker follows).
const CASE_PARAM = "case";
const VARIANT_PARAM = "variant";

// Value accessors for the compared figures. Module-level so their identity is
// stable across renders. Each returns null for a run that did not report the
// figure, which keeps it out of the average and out of the field rather than
// dragging either toward zero.
const costValue = (run: RunSummary): number | null => run.metrics.cost.comparable;
const tokensValue = (run: RunSummary): number | null => totalTokens(run.metrics);
// A run's reviewer score as a fraction of the points on offer. A checklist with
// nothing on offer has no fraction to contribute, so it is unreported rather than
// a perfect (or zero) score.
const scoreValue = (run: RunSummary): number | null =>
  run.score && run.score.total > 0 ? run.score.earned / run.score.total : null;

// The Overview tab (`/models/:modelId`): how the model has actually done, one
// test case at a time.
//
// The organizing rule is that figures from different test cases are never mixed.
// A model's mean cost across a sprite case and a full end-to-end game is not a
// fact about the model, it is an artefact of which cases happened to be run — so
// this tab picks ONE case + variant (+ version scope) and reports that cohort,
// with a picker to move between the cohorts the model has runs for. The
// comparison against other models is taken over the same cohort for the same
// reason: "more expensive than 78% of models" only means something when every
// model in the field was asked to build the same thing.
export function ModelOverviewPage() {
  return (
    <ModelDetailLayout tab="overview">
      {({ model }) => <OverviewContent model={model} />}
    </ModelDetailLayout>
  );
}

function OverviewContent({ model }: { model: ModelSummary }) {
  // Every published run of the model, across all of its covered ids — the set the
  // case/variant picker is built from, so the picker offers exactly the cohorts
  // there is data for and can never land on an empty aggregation.
  const { summaries, loading } = useModelRunSummaries(model.modelIds);
  const options = useMemo(() => modelCaseOptions(summaries), [summaries]);
  const { testCase, variant, selectCase, selectVariant } =
    useCohortSelection(options);

  if (loading) {
    return <LoadingState size="section" label={`Loading ${model.name} runs…`} />;
  }

  if (!testCase || !variant) {
    return (
      <Panel>
        <p className={styles.empty}>
          No published runs have used {model.name} yet. Once a run of this model
          is published, its per-case breakdown appears here.
        </p>
      </Panel>
    );
  }

  return (
    <section className={styles.section}>
      <CohortPicker
        options={options}
        testCase={testCase}
        variant={variant}
        onSelectCase={selectCase}
        onSelectVariant={selectVariant}
      />
      {/* Remounting per cohort keeps the version scope from carrying a stale
          `specific` version across a case switch, and restarts the case-scoped
          fetch cleanly. */}
      <CohortReport
        key={`${testCase.slug}/${variant.slug}`}
        model={model}
        testCase={testCase}
        variant={variant}
      />
    </section>
  );
}

/** The cohort the visitor has selected, resolved against what the model has run. */
interface CohortSelection {
  testCase: ModelCaseOption | undefined;
  variant: ModelVariantOption | undefined;
  selectCase: (slug: string) => void;
  selectVariant: (slug: string) => void;
}

// Resolve the selected case + variant from the query string, falling back to the
// model's most-run cohort. Picking a case drops any variant parameter: a variant
// slug is only unique within its case, so carrying it across would either select
// the wrong variant or nothing at all.
function useCohortSelection(options: ModelCaseOption[]): CohortSelection {
  const [params, setParams] = useSearchParams();

  const requestedCase = params.get(CASE_PARAM);
  const testCase =
    options.find((option) => option.slug === requestedCase) ?? options[0];
  const requestedVariant = params.get(VARIANT_PARAM);
  const variant =
    testCase?.variants.find((entry) => entry.slug === requestedVariant) ??
    testCase?.variants[0];

  const defaultCase = options[0]?.slug;

  const selectCase = useCallback(
    (slug: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (slug === defaultCase) next.delete(CASE_PARAM);
          else next.set(CASE_PARAM, slug);
          next.delete(VARIANT_PARAM);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaultCase],
  );

  const defaultVariant = testCase?.variants[0]?.slug;

  const selectVariant = useCallback(
    (slug: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (slug === defaultVariant) next.delete(VARIANT_PARAM);
          else next.set(VARIANT_PARAM, slug);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaultVariant],
  );

  return { testCase, variant, selectCase, selectVariant };
}

// The two dropdowns that move between cohorts. Each option carries its run count
// so the visitor can see which cohorts are worth reading before switching to one.
// The variant picker is hidden for a case the model has only ever run one variant
// of — there is no choice to make, and the heading below names it anyway.
function CohortPicker({
  options,
  testCase,
  variant,
  onSelectCase,
  onSelectVariant,
}: {
  options: ModelCaseOption[];
  testCase: ModelCaseOption;
  variant: ModelVariantOption;
  onSelectCase: (slug: string) => void;
  onSelectVariant: (slug: string) => void;
}) {
  const caseId = useId();
  const variantId = useId();

  return (
    <div className={styles.pickers}>
      <div className={styles.picker}>
        <label className={styles.pickerLabel} htmlFor={caseId}>
          Test case
        </label>
        <select
          id={caseId}
          className={styles.select}
          value={testCase.slug}
          onChange={(event) => onSelectCase(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name} ({option.runs}{" "}
              {option.runs === 1 ? "run" : "runs"})
            </option>
          ))}
        </select>
      </div>
      {testCase.variants.length > 1 && (
        <div className={styles.picker}>
          <label className={styles.pickerLabel} htmlFor={variantId}>
            Variant
          </label>
          <select
            id={variantId}
            className={styles.select}
            value={variant.slug}
            onChange={(event) => onSelectVariant(event.target.value)}
          >
            {testCase.variants.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.name} ({entry.runs} {entry.runs === 1 ? "run" : "runs"})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// One cohort's report: the model's own figures for the selected case + variant,
// then where those figures land among the other models that ran the same thing.
function CohortReport({
  model,
  testCase,
  variant,
}: {
  model: ModelSummary;
  testCase: ModelCaseOption;
  variant: ModelVariantOption;
}) {
  // Every model's runs of this case — the field the comparison is taken over.
  // Bounded to the one case, so this is a handful of requests however large the
  // cabinet gets.
  const { summaries, localIds, loading } = useCaseRunSummaries(testCase.slug);

  // Published runs of this case and variant, whatever their outcome. Locally
  // produced (so unpublished, unreviewed) console runs are dropped, matching the
  // published-only set the model's own runs were drained from — otherwise the
  // console and the static site would report different figures for the same
  // model.
  const cohort = useMemo(
    () =>
      summaries.filter(
        (run) =>
          !localIds.has(run.id) &&
          run.subject.testCaseSlug === testCase.slug &&
          run.subject.variant === variant.slug,
      ),
    [summaries, localIds, testCase.slug, variant.slug],
  );

  // The scope is anchored on the versions THIS MODEL has runs for, not the case's
  // published versions: a case whose newest version this model never ran would
  // otherwise default to a scope with none of its runs in it. Every model in the
  // field is then narrowed to the same scope, so the comparison stays
  // version-matched.
  const versionSet = useMemo(() => {
    const versions = [
      ...new Set(
        cohort
          .filter((run) => runIsModel(run, model.modelIds))
          .map((run) => run.subject.testCaseVersion),
      ),
    ].sort((a, b) => compareVersions(b, a));
    return { versions, latestVersion: versions[0] ?? "" };
  }, [cohort, model.modelIds]);

  const versionScope = useVersionScope(versionSet);
  const { scope, specificVersion } = versionScope;

  // Filtered with the pure membership test rather than the state's `inScope`
  // closure, so the memo's dependencies are the scope's actual inputs (the same
  // shape the case Metrics tab uses).
  const scoped = useMemo(
    () =>
      cohort.filter((run) =>
        versionInScope(
          run.subject.testCaseVersion,
          scope,
          versionSet.latestVersion,
          specificVersion,
        ),
      ),
    [cohort, scope, versionSet.latestVersion, specificVersion],
  );

  // The model's own runs in scope, and the completed subset. Cost, tokens, score
  // and runtime are only meaningful for a run that finished — a timed-out run
  // reports the timeout, not the model's speed — so the averages and every
  // comparison below are taken over completed runs, while the outcome ring and
  // the ratings ring describe every run.
  const modelRuns = useMemo(
    () => scoped.filter((run) => runIsModel(run, model.modelIds)),
    [scoped, model.modelIds],
  );
  const modelCompleted = useMemo(
    () => modelRuns.filter((run) => run.state === "completed"),
    [modelRuns],
  );
  const fieldCompleted = useMemo(
    () => scoped.filter((run) => run.state === "completed"),
    [scoped],
  );

  const rollup = useMemo(() => rollupRuns(modelRuns), [modelRuns]);

  const standings = useMemo(
    () => ({
      cost: standInField(fieldCompleted, model.modelIds, costValue),
      tokens: standInField(fieldCompleted, model.modelIds, tokensValue),
      score: standInField(fieldCompleted, model.modelIds, scoreValue),
    }),
    [fieldCompleted, model.modelIds],
  );

  const meanRuntime = useMemo(
    () => meanReported(modelCompleted, (run) => run.metrics.runTimeSeconds),
    [modelCompleted],
  );

  if (loading) {
    return (
      <LoadingState size="section" label={`Loading ${testCase.name} runs…`} />
    );
  }

  const cohortLabel =
    testCase.variants.length > 1
      ? `${testCase.name} · ${variant.name}`
      : testCase.name;

  return (
    <>
      <VersionScopeControl state={versionScope} />

      {modelRuns.length === 0 ? (
        <Panel>
          <p className={styles.empty}>
            {model.name} has no runs of {cohortLabel} in the selected versions.
          </p>
        </Panel>
      ) : (
        <>
          <section className={styles.block}>
            <h2 className={styles.blockTitle}>{cohortLabel}</h2>
            {/* A list, so a screen reader announces how many figures there are
                and steps through them rather than reading one run-on line. */}
            <div
              className={styles.tiles}
              role="list"
              aria-label={`${cohortLabel} figures`}
            >
              <Tile label="Runs" value={formatInteger(rollup.runs)} />
              <Tile
                label="Completed"
                value={formatPercent(rollup.completionRate)}
              />
              <Tile
                label="Mean score"
                value={formatPercent(rollup.score?.meanFraction ?? null)}
              />
              <Tile
                label="Mean cost"
                value={formatUsd(standings.cost?.value ?? null)}
              />
              <Tile
                label="Mean tokens"
                value={
                  standings.tokens
                    ? formatCompact(Math.round(standings.tokens.value))
                    : "—"
                }
              />
              <Tile
                label="Mean run time"
                value={meanRuntime === null ? "—" : formatRunTime(meanRuntime)}
              />
            </div>
            {/* The averages above are over completed runs, the two rings below
                over every run — say so rather than let the two disagree
                silently. */}
            <p className={styles.note}>
              Means are over the {modelCompleted.length} completed{" "}
              {modelCompleted.length === 1 ? "run" : "runs"}; the breakdowns
              below cover all {rollup.runs}.
            </p>
          </section>

          <section className={styles.block}>
            <div className={styles.charts}>
              <ReliabilityRingWidget
                title="Outcomes"
                segments={outcomeSegments(rollup.outcomes)}
                totalRuns={rollup.runs}
              />
              <DonutChartWidget
                title="Ratings"
                segments={ratingSegments(rollup.ratings)}
                total={rollup.runs}
                centerLabel="runs"
                emptyMessage="No rated runs in this cohort yet."
              />
            </div>
          </section>

          <ComparisonBlock
            cohortLabel={cohortLabel}
            standings={standings}
            modelName={model.name}
          />
        </>
      )}
    </>
  );
}

// The three comparisons, each placing one of the model's figures among the other
// models that ran the same cohort. A figure the model never reported has no row
// (there is nothing to place), and a cohort this model is alone in says so once
// rather than three times.
function ComparisonBlock({
  cohortLabel,
  standings,
  modelName,
}: {
  cohortLabel: string;
  standings: {
    cost: FieldStanding | null;
    tokens: FieldStanding | null;
    score: FieldStanding | null;
  };
  modelName: string;
}) {
  // Each measure has its own field — a model whose prices could not be resolved
  // is in the token field but not the cost one — so the headline count is the
  // widest of them rather than whichever measure happened to be listed first.
  const present = [standings.cost, standings.tokens, standings.score].filter(
    (standing): standing is FieldStanding => standing !== null,
  );
  if (present.length === 0) return null;
  const others = Math.max(...present.map((s) => s.fieldSize)) - 1;

  return (
    <section className={styles.block}>
      <h2 className={styles.blockTitle}>Against the field</h2>
      {others === 0 ? (
        <Panel>
          <p className={styles.empty}>
            {modelName} is the only model with completed runs of {cohortLabel},
            so there is nothing to compare it against yet.
          </p>
        </Panel>
      ) : (
        <Panel className={styles.comparisons}>
          <p className={styles.sectionLede}>
            Measured against the {others} other {others === 1 ? "model" : "models"}{" "}
            with completed runs of {cohortLabel} — each model reduced to its own
            mean, so a model run many times does not count many times.
          </p>
          <Standing
            label="Cost per run"
            standing={standings.cost}
            format={(value) => formatUsd(value)}
            comparison="more expensive than"
          />
          <Standing
            label="Tokens per run"
            standing={standings.tokens}
            format={(value) => formatCompact(Math.round(value))}
            comparison="heavier than"
          />
          <Standing
            label="Reviewer score"
            standing={standings.score}
            format={(value) => formatPercent(value)}
            comparison="better than"
          />
        </Panel>
      )}
    </section>
  );
}

// One measured figure's standing: the model's own mean, a meter filled to the
// share of the field it is above, and the sentence that reads it. The meter is a
// position on a 0–100% scale rather than a chart — one number, one axis — so it
// carries its own value label and needs no legend.
function Standing({
  label,
  standing,
  format,
  comparison,
}: {
  label: string;
  standing: FieldStanding | null;
  format: (value: number) => string;
  comparison: string;
}) {
  if (!standing || standing.greaterThan === null) return null;
  const percent = Math.round(standing.greaterThan * 100);

  return (
    <div className={styles.standing}>
      <div className={styles.standingHead}>
        <span className={styles.standingLabel}>{label}</span>
        <span className={styles.standingValue}>{format(standing.value)}</span>
      </div>
      <div
        className={styles.meter}
        role="meter"
        aria-label={`${label}: ${comparison} ${percent}% of the field`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.meterFill} style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.standingCaption}>
        <strong className={styles.standingPercent}>{percent}%</strong>{" "}
        {comparison} the rest of the field · rank {standing.rank} of{" "}
        {standing.fieldSize} · field spans {format(standing.min)} –{" "}
        {format(standing.max)}
      </p>
    </div>
  );
}

// One labelled figure in the cohort's tile grid.
function Tile({ label, value }: { label: string; value: string }) {
  const muted = value === "—";
  return (
    <div className={styles.tile} role="listitem">
      <span className={styles.tileLabel}>{label}</span>
      <span
        className={`${styles.tileValue}${muted ? ` ${styles.muted}` : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

// One segment per publishable state, in the contract's order — the same
// breakdown (and the same legend) the Stats tab's reliability ring shows, so the
// two read identically. `infrastructure` is never publishable and so never
// appears in this set.
function outcomeSegments(
  outcomes: ReturnType<typeof rollupRuns>["outcomes"],
): ReliabilitySegment[] {
  return [
    { label: "Completed", value: outcomes.completed, tone: "success" },
    {
      label: "Catastrophic",
      value: outcomes.catastrophic,
      tone: "catastrophic",
    },
    { label: "Timeouts", value: outcomes.timed_out, tone: "timeout" },
    {
      label: "Harness errors",
      value: outcomes.harness_error,
      tone: "harnessError",
    },
    { label: "Hangs", value: outcomes.hung, tone: "hung" },
  ];
}

// The rating tally as donut slices, best tier first and each wearing the shared
// `--tcab-rating-*` token so a rating reads the same color everywhere. Unrated
// runs are deliberately left out of the slices: the ring's total is every run, so
// they show through as uncolored track.
function ratingSegments(
  ratings: ReturnType<typeof rollupRuns>["ratings"],
): DonutSegment[] {
  return RATINGS.map((rating) => ({
    label: RATING_META[rating].label,
    value: ratings[rating],
    color: `var(--tcab-rating-${rating})`,
  }));
}

// A fraction as a whole percent, or an em dash when it is unknown — an unknown
// rate reads as "—" rather than a misleading 0%.
function formatPercent(fraction: number | null): string {
  return fraction === null ? "—" : `${Math.round(fraction * 100)}%`;
}
