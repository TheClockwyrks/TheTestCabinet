import { useMemo } from "react";
import {
  CATEGORICAL_COLORS,
  DonutChartWidget,
  ReliabilityRingWidget,
  Spinner,
  type DonutSegment,
  type ReliabilitySegment,
} from "@clockwyrks/ui";
import { rollupRuns } from "@clockwyrks/run-stats/rollup";
import type {
  ModelCandidates,
  RacAccuracy,
  ToolCallingAccuracy,
} from "../../../../client/types";
import type { ModelSummary } from "../../../data/models";
import { useModelAccuracy } from "../../../data/useModelAccuracy";
import { useModelCandidates } from "../../../data/useModelCandidates";
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
// the catalog — its curated list price beside the observed billed rate of its
// official endpoint, and the context window and release date resolved from
// OpenRouter. Figures that could not be resolved show a muted dash rather than
// being hidden, so the layout stays stable across models.
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

      {/* List price: the developer's published figures the comparable cost is
          computed from, per Mtok, with the date the operator took them. A model
          without one is refused at enqueue, which the empty state names. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>List price</h2>
        <div className={styles.grid}>
          {model.listPrice ? (
            <>
              <Stat
                label="Uncached input / Mtok"
                value={formatUsd(perMillion(model.listPrice.uncachedInput))}
              />
              <Stat
                label="Cached input / Mtok"
                value={formatUsd(perMillion(model.listPrice.cachedInput))}
              />
              <Stat
                label="Output / Mtok"
                value={formatUsd(perMillion(model.listPrice.output))}
              />
              {model.listPriceAsOf && (
                <Stat
                  label="Prices taken on"
                  value={formatReleaseDate(model.listPriceAsOf)}
                />
              )}
            </>
          ) : (
            <Stat
              label="No list price — runs of this model are refused at enqueue"
              value="—"
              muted
            />
          )}
        </div>
      </section>

      {/* Billed rate: the official endpoint's observed current price, per Mtok.
          Where the list price is known too, each class carries the difference as
          a signed percentage of the list figure — the gap that says the endpoint
          is discounting, surcharging, or has drifted from what a run is priced
          at. Within half a percent the two read as the same price and the delta
          is muted. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Billed rate</h2>
        <div className={styles.grid}>
          {model.prices ? (
            <>
              <Stat
                label="Uncached input / Mtok"
                value={formatUsd(perMillion(model.prices.uncachedInput))}
                delta={priceDelta(
                  model.prices.uncachedInput,
                  model.listPrice?.uncachedInput ?? null,
                )}
              />
              <Stat
                label="Cached input / Mtok"
                value={formatUsd(perMillion(model.prices.cachedInput))}
                delta={priceDelta(
                  model.prices.cachedInput,
                  model.listPrice?.cachedInput ?? null,
                )}
              />
              <Stat
                label="Output / Mtok"
                value={formatUsd(perMillion(model.prices.output))}
                delta={priceDelta(
                  model.prices.output,
                  model.listPrice?.output ?? null,
                )}
              />
            </>
          ) : (
            <Stat label="No billed rate observed yet" value="—" muted />
          )}
        </div>
      </section>

      <ProviderCandidates model={model} />

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

// Provider candidates: the list the next gg enqueue of the model would build
// from OpenRouter's endpoints listing, in the order a run tries them, or the
// reason it would refuse. Read live and Bearer-gated, so it is absent where the
// transport cannot read it (the static site) and asks a signed-out viewer to
// sign in.
function ProviderCandidates({ model }: { model: ModelSummary }) {
  const state = useModelCandidates(model.slug);
  if (state.status === "unavailable") return null;
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Provider candidates</h2>
      {state.status === "signedOut" && (
        <p className={styles.accuracyNote}>
          Sign in to see the providers a gg run of this model would use, using
          the account control in the top bar.
        </p>
      )}
      {state.status === "loading" && (
        <Spinner variant="flap" label="Reading OpenRouter's endpoints…" />
      )}
      {state.status === "error" && (
        <p className={styles.accuracyNote} role="alert">
          Couldn&apos;t read the provider candidates. {state.message}
        </p>
      )}
      {state.status === "ready" && (
        <CandidateList model={model} list={state.candidates} />
      )}
    </section>
  );
}

function CandidateList({
  model,
  list,
}: {
  model: ModelSummary;
  list: ModelCandidates;
}) {
  const policy = policySummary(model, list);
  return (
    <>
      {list.refusal ? (
        <p className={styles.refusal} role="alert">
          A gg run of this model would be refused: {list.refusal}.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.candidates}>
            <thead>
              <tr>
                <th>#</th>
                <th>Provider</th>
                <th>Quantization</th>
                <th className={styles.numeric}>Input / Mtok</th>
                <th className={styles.numeric}>Output / Mtok</th>
                <th className={styles.numeric}>Cache read / Mtok</th>
                <th className={styles.numeric}>Fault rate</th>
              </tr>
            </thead>
            <tbody>
              {list.candidates.map((candidate, index) => (
                <tr key={candidate.provider}>
                  <td>{index + 1}</td>
                  <td>
                    {candidate.provider}
                    {candidate.developer && (
                      <span className={styles.developer}>developer</span>
                    )}
                  </td>
                  <td>{candidate.quantization}</td>
                  <td className={styles.numeric}>
                    {formatUsd(candidate.inputPrice)}
                  </td>
                  <td className={styles.numeric}>
                    {formatUsd(candidate.outputPrice)}
                  </td>
                  <td className={styles.numeric}>
                    {formatUsd(candidate.cacheReadPrice)}
                  </td>
                  <td className={styles.numeric}>
                    {formatFaultRate(candidate.faultRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.accuracyNote}>
        {policy}. The list is read from OpenRouter now, for an agent that sets
        no reasoning; an enqueue whose agents set one also drops the providers
        that do not support it. A fault rate of — means no recorded run used the
        provider.
      </p>
    </>
  );
}

// One line naming what the list was filtered by: the native level, the
// developer provider, and the catalog entry's own settings where it has any.
function policySummary(model: ModelSummary, list: ModelCandidates): string {
  const parts = [
    `Native quantization ${list.nativeQuantization ?? "unknown"}${
      model.nativeQuantization ? " (set by hand)" : ""
    }`,
  ];
  if (model.providerPin) {
    parts.push(
      `developer provider ${model.providerPin}${
        model.providerPinSetByHand ? " (set by hand)" : ""
      }`,
    );
  }
  if (model.maxInputPrice != null && model.maxOutputPrice != null) {
    parts.push(
      `price ceiling ${formatUsd(model.maxInputPrice)} / ${formatUsd(
        model.maxOutputPrice,
      )} per Mtok when no developer endpoint is listed`,
    );
  }
  if (model.bannedProviders.length > 0) {
    parts.push(`banned: ${model.bannedProviders.join(", ")}`);
  }
  return parts.join(" · ");
}

// A fault rate as a percentage, or an em dash for a provider no recorded run
// used (which the order reads as zero).
function formatFaultRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`;
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
  /** The billed-vs-list difference under the value, signed and muted when the
   * two are the same price for practical purposes. Absent when there is no
   * list figure to compare against. */
  delta?: { text: string; muted: boolean };
}

function Stat({ label, value, muted = false, delta }: StatProps) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue}${muted ? ` ${styles.muted}` : ""}`}>
        {value}
      </span>
      {delta && (
        <span
          className={`${styles.statDelta}${delta.muted ? ` ${styles.muted}` : ""}`}
        >
          {delta.text}
        </span>
      )}
    </div>
  );
}

// The billed rate's difference from the list price for one price class, as a
// signed percentage of the list figure ("+12.0% vs list") — the drift between
// what a run is priced at and what the endpoint currently charges. Null when
// either side is unknown; a zero list figure has no meaningful percentage. Half
// a percent either way is the same price for practical purposes and mutes.
function priceDelta(
  billed: number | null,
  list: number | null,
): { text: string; muted: boolean } | undefined {
  if (billed === null || list === null || list === 0) return undefined;
  const fraction = (billed - list) / list;
  const percent = fraction * 100;
  return {
    text: `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}% vs list`,
    muted: Math.abs(percent) < 0.5,
  };
}
