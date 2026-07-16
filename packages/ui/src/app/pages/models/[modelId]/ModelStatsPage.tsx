import { useMemo } from "react";
import { HarnessErrorRingWidget } from "@test-cabinet/ui";
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
  // Every published run of the model, across all of its ids. The harness-error
  // ring is a fraction of these, so it reads the same on the public site (where
  // the set is exactly the published runs) and the console.
  const { summaries, loading } = useModelRunSummaries(model.modelIds);
  const { harnessErrors, totalRuns } = useMemo(() => {
    let harnessErrors = 0;
    for (const run of summaries) {
      if (run.state === "harness_error") harnessErrors += 1;
    }
    return { harnessErrors, totalRuns: summaries.length };
  }, [summaries]);

  return (
    <>
      {/* Reliability: the share of the model's runs that drove the harness to
          exit early. Hidden while the runs are still loading so the ring never
          flashes a misleading 0%. */}
      {!loading && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Reliability</h2>
          <div className={styles.grid}>
            <HarnessErrorRingWidget
              title="Harness errors"
              harnessErrors={harnessErrors}
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
            value={
              model.releasedAt ? formatReleaseDate(model.releasedAt) : "—"
            }
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
      <span
        className={`${styles.statValue}${muted ? ` ${styles.muted}` : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
