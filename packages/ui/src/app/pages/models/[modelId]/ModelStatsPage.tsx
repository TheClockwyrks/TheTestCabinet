import { useMemo } from "react";
import {
  ReliabilityRingWidget,
  type ReliabilitySegment,
} from "@test-cabinet/ui";
import { rollupRuns } from "@test-cabinet/run-stats/rollup";
import type { ModelSummary } from "../../../data/models";
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
      { label: "Hangs", value: outcomes.hung, tone: "hung" },
    ];
    return { segments, totalRuns: runs };
  }, [summaries]);

  return (
    <>
      {/* Reliability: how the model's published runs broke down — completed vs
          every publishable failure tier (catastrophic, timeouts, harness errors,
          hangs). Hidden while the runs are still loading so the ring never flashes
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

      {/* Specs: the context window and release date OpenRouter reports. */}
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
        </div>
      </section>
    </>
  );
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
