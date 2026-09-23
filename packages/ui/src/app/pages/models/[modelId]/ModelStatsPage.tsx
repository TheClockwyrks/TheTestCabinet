import { useMemo } from "react";
import {
  CATEGORICAL_COLORS,
  DonutChartWidget,
  ReliabilityRingWidget,
  type DonutSegment,
  type ReliabilitySegment,
} from "@clockwyrks/ui";
import { rollupRuns } from "@clockwyrks/run-stats/rollup";
import type {
  RacAccuracy,
  ToolCallingAccuracy,
} from "../../../../client/types";
import type { ModelSummary } from "../../../data/models";
import { useModelAccuracy } from "../../../data/useModelAccuracy";
import { useModelRunSummaries } from "../../../data/useModelRunSummaries";
import {
  formatCompact,
  formatReleaseDate,
  formatUsd,
  perMillion,
} from "../../../format";
import { ModelDetailLayout } from "../../../layouts/models/ModelDetailLayout";
import styles from "./ModelStatsPage.module.scss";

// The Stats tab (`/models/:modelId/stats`): the model's quantitative facts from
// the catalog — its comparable per-token prices and the context window and
// release date resolved from OpenRouter. Figures that could not be resolved show
// a muted dash rather than being hidden, so the layout stays stable across
// models.
export function ModelStatsPage() {
  return (
    <ModelDetailLayout tab="stats">
      {({ model }) => <StatsContent model={model} />}
    </ModelDetailLayout>
  );
}

function StatsContent({ model }: { model: ModelSummary }) {
  // The deployment-wide accuracy fold, narrowed to this model's covered ids.
  // Absent halves stay absent: a model with no gg runs of a mode charts nothing
  // for it rather than a fabricated zero.
  const accuracyState = useModelAccuracy();
  const accuracy = useMemo(() => {
    if (accuracyState.status !== "ready") return null;
    const mine = accuracyState.accuracy.models.filter((entry) =>
      model.modelIds.includes(entry.modelId),
    );
    return {
      rac: foldRac(
        mine.map((entry) => entry.rac).filter((r): r is RacAccuracy => !!r),
      ),
      tool: foldTool(
        mine
          .map((entry) => entry.toolCalling)
          .filter((t): t is ToolCallingAccuracy => !!t),
      ),
    };
  }, [accuracyState, model.modelIds]);
  // Every published run of the model, across all of its ids. The reliability
  // ring is a breakdown of these, so it reads the same on the public site (where
  // the set is exactly the published runs) and the console.
  const { summaries, loading } = useModelRunSummaries(model.modelIds);
  const { segments, totalRuns } = useMemo(() => {
    // The shared rollup, rather than a tally written out here: anything else that
    // reports this model's outcomes — a write-up that freezes them, a later live
    // recomputation of the same figures — reduces the run set with this same
    // function, so the numbers agree by construction.
    const { outcomes, runs } = rollupRuns(summaries);
    // One segment per publishable state, in `RunState::ALL` order: the positive
    // outcome first, then the failure tiers as the contract enumerates them. That
    // covers every run this page can see — `infrastructure` is the only state
    // without a segment, and it is never publishable and excluded from every model
    // statistic — so the legend tallies sum to the ring's center total.
    const segments: ReliabilitySegment[] = [
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
      {
        label: "Execution ceilings",
        value: outcomes.limit_exceeded,
        tone: "limitExceeded",
      },
      { label: "Hangs", value: outcomes.hung, tone: "hung" },
    ];
    return { segments, totalRuns: runs };
  }, [summaries]);

  return (
    <>
      {/* Reliability: how the model's published runs broke down — completed vs
          every publishable failure tier (catastrophic, timeouts, harness errors,
          execution ceilings, hangs). Hidden while the runs are still loading so the ring never flashes
          a misleading 0%. */}
      {!loading && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Reliability</h2>
          <div className={styles.grid}>
            <ReliabilityRingWidget
              title="Run outcomes"
              segments={segments}
              totalRuns={totalRuns}
            />
          </div>
        </section>
      )}

      {/* Accuracy: how the model's gg turns came out, per execution mode —
          responses-as-code turns split valid vs the error classes, tool-calling
          dispatches split ok vs the failure classes. Rendered only where the
          fold is served (a connected backend) and never while loading, so the
          rings don't flash misleading zeros; each ring's empty state names the
          mode it has no data for. */}
      {(accuracy || accuracyState.status === "error") && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Accuracy</h2>
          {accuracyState.status === "error" ? (
            <p className={styles.accuracyNote}>
              Couldn&apos;t load accuracy statistics. {accuracyState.message}
            </p>
          ) : (
            accuracy && (
              <div className={styles.grid}>
                <div>
                  <DonutChartWidget
                    title="Responses as code"
                    segments={racSegments(accuracy.rac)}
                    total={accuracy.rac?.turns ?? 0}
                    centerLabel="turns"
                    emptyMessage="No responses-as-code gg runs recorded for this model."
                  />
                  {accuracy.rac && (
                    <p className={styles.accuracyNote}>
                      {accuracy.rac.runs}{" "}
                      {accuracy.rac.runs === 1 ? "run" : "runs"}
                      {accuracy.rac.approximateRuns > 0 &&
                        ` · ${accuracy.rac.approximateRuns} predate exact turn accounting`}
                    </p>
                  )}
                </div>
                <div>
                  <DonutChartWidget
                    title="Tool calling"
                    segments={toolSegments(accuracy.tool)}
                    total={accuracy.tool?.calls ?? 0}
                    centerLabel="tool calls"
                    emptyMessage="No tool-calling gg runs with recorded call totals for this model."
                  />
                  {accuracy.tool && (
                    <p className={styles.accuracyNote}>
                      {accuracy.tool.runs}{" "}
                      {accuracy.tool.runs === 1 ? "run" : "runs"}
                      {accuracy.tool.runsWithoutCallTotals > 0 &&
                        ` · ${accuracy.tool.runsWithoutCallTotals} predate call totals`}
                    </p>
                  )}
                </div>
              </div>
            )
          )}
        </section>
      )}

      {/* Pricing: per-token catalog list prices, when known. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pricing</h2>
        <div className={styles.grid}>
          {model.prices ? (
            <>
              <Stat
                label="Uncached input / Mtok"
                value={formatUsd(perMillion(model.prices.uncachedInput))}
              />
              <Stat
                label="Cached input / Mtok"
                value={formatUsd(perMillion(model.prices.cachedInput))}
              />
              <Stat
                label="Output / Mtok"
                value={formatUsd(perMillion(model.prices.output))}
              />
            </>
          ) : (
            <Stat label="Catalog prices" value="—" muted />
          )}
        </div>
      </section>

      {/* Specs: the context window, release date, and accepted input modalities
          OpenRouter reports. The modalities are not trivia — they decide whether a
          gg run may show this model the reference images a test case's specs ship,
          so a text-only model is worth seeing at a glance. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Specs</h2>
        <div className={styles.grid}>
          <Stat
            label="Context length"
            value={
              model.contextLength != null
                ? `${formatCompact(model.contextLength)} tokens`
                : "—"
            }
            muted={model.contextLength == null}
          />
          <Stat
            label="Provider pin"
            value={model.providerPin ?? "no official endpoint"}
            muted={model.providerPin == null}
          />
          <Stat
            label="Release date"
            value={model.releasedAt ? formatReleaseDate(model.releasedAt) : "—"}
            muted={!model.releasedAt}
          />
          <Stat
            label="Input modalities"
            // An empty list is "not observed yet", not "text only" — showing a dash
            // rather than claiming text-only keeps the two apart.
            value={
              model.inputModalities.length > 0
                ? model.inputModalities.map(formatModality).join(", ")
                : "—"
            }
            muted={model.inputModalities.length === 0}
          />
          <Stat
            label="Vision"
            value={
              model.inputModalities.length === 0
                ? "—"
                : model.inputModalities.includes("image")
                  ? "Accepts images"
                  : "Text only"
            }
            muted={model.inputModalities.length === 0}
          />
        </div>
      </section>
    </>
  );
}

// Title-case a modality token for display (`image` → `Image`). The catalog stores
// them lowercased so comparisons are exact; only the label is prettified.
function formatModality(modality: string): string {
  return modality.charAt(0).toUpperCase() + modality.slice(1);
}

// Sum the RaC accuracy halves of a model's covered ids into one reading, or
// null when none carries one — the multi-id analogue of the run-summary dedup
// above, so an aliased model reports all of its runs once.
function foldRac(parts: RacAccuracy[]): RacAccuracy | null {
  if (parts.length === 0) return null;
  const acc: RacAccuracy = {
    runs: 0,
    turns: 0,
    valid: 0,
    compile: 0,
    runtime: 0,
    modelErrors: 0,
    missing: 0,
    byType: {},
    approximateRuns: 0,
  };
  for (const part of parts) {
    acc.runs += part.runs;
    acc.turns += part.turns;
    acc.valid += part.valid;
    acc.compile += part.compile;
    acc.runtime += part.runtime;
    acc.modelErrors += part.modelErrors;
    acc.missing += part.missing;
    acc.approximateRuns += part.approximateRuns;
    for (const [type, count] of Object.entries(part.byType)) {
      acc.byType[type] = (acc.byType[type] ?? 0) + count;
    }
  }
  return acc;
}

// The tool-calling analogue of `foldRac`.
function foldTool(parts: ToolCallingAccuracy[]): ToolCallingAccuracy | null {
  if (parts.length === 0) return null;
  const acc: ToolCallingAccuracy = {
    runs: 0,
    calls: 0,
    ok: 0,
    failures: {},
    runsWithoutCallTotals: 0,
  };
  for (const part of parts) {
    acc.runs += part.runs;
    acc.calls += part.calls;
    acc.ok += part.ok;
    acc.runsWithoutCallTotals += part.runsWithoutCallTotals;
    for (const [failure, count] of Object.entries(part.failures)) {
      acc.failures[failure] = (acc.failures[failure] ?? 0) + count;
    }
  }
  return acc;
}

// Fixed categorical assignments so a class keeps its color across models and
// visits: valid/ok get the palette's green, the error classes each a fixed
// non-green hue. Zero-count classes are omitted — an absent failure mode is
// not a legend entry. Any shortfall against the ring's total (fatal turns,
// which belong to no error class) shows through as the uncolored track.
const GREEN = CATEGORICAL_COLORS[3]!;

function racSegments(rac: RacAccuracy | null): DonutSegment[] {
  if (!rac) return [];
  const slices: DonutSegment[] = [
    { label: "Valid", value: rac.valid, color: GREEN },
    {
      label: "Compile errors",
      value: rac.compile,
      color: CATEGORICAL_COLORS[0]!,
    },
    {
      label: "Runtime errors",
      value: rac.runtime,
      color: CATEGORICAL_COLORS[4]!,
    },
    {
      label: "Model errors",
      value: rac.modelErrors,
      color: CATEGORICAL_COLORS[2]!,
    },
    {
      label: "Missing replies",
      value: rac.missing,
      color: CATEGORICAL_COLORS[5]!,
    },
  ];
  return slices.filter((slice) => slice.value > 0);
}

// The non-green palette entries, assigned to failure classes in wire (BTreeMap,
// alphabetical) order so a class keeps its hue as long as the roster does; a
// roster longer than the palette repeats the last color, per the palette's own
// no-cycling rule.
const FAILURE_COLORS = [0, 1, 2, 4, 5].map((i) => CATEGORICAL_COLORS[i]!);

function toolSegments(tool: ToolCallingAccuracy | null): DonutSegment[] {
  if (!tool) return [];
  const failures = Object.entries(tool.failures).filter(
    ([, count]) => count > 0,
  );
  const slices: DonutSegment[] = [
    { label: "Ok", value: tool.ok, color: GREEN },
    ...failures.map(([failure, count], index) => ({
      label: failure,
      value: count,
      color: FAILURE_COLORS[Math.min(index, FAILURE_COLORS.length - 1)]!,
    })),
  ];
  return slices.filter((slice) => slice.value > 0);
}

interface StatProps {
  label: string;
  value: string;
  /** Render the value muted, without the accent glow (used for missing data). */
  muted?: boolean;
}

function Stat({ label, value, muted = false }: StatProps) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue}${muted ? ` ${styles.muted}` : ""}`}>
        {value}
      </span>
    </div>
  );
}
