import { useMemo } from "react";
import { LoadingState } from "../../components/LoadingState";
import type {
  ProbeProviderStats,
  ProviderCallStats,
  ProviderStatsEntry,
} from "../../../client/types";
import { useModels } from "../../data/useModels";
import { useProviderStats } from "../../data/useProviderStats";
import { formatCompact, formatUsd } from "../../format";
import styles from "./ProvidersView.module.scss";

// The Providers tab's body: per-provider health folded from recorded gg runs,
// with the probe corpus as a second, clearly separated evidence source. Run
// evidence says what actually happened on real runs (calls served, spend,
// length-capped rejections, and how the turns those calls carried came out);
// probe evidence says how a provider's completions classified under the
// readiness probes. The two are never mixed: a probe is a synthetic call, not a
// run.
export function ProvidersView() {
  const state = useProviderStats();
  const { models } = useModels();

  // Map a raw model id to its catalog display name, falling back to the id for
  // a model the catalog hasn't curated. Null means the run's slices could not
  // name a model at all (recorded before the agent's model was known).
  const nameOf = useMemo(() => {
    return (modelId: string | null): string => {
      if (modelId == null) return "Unknown model";
      const match = models.find((model) => model.modelIds.includes(modelId));
      return match ? match.name : modelId;
    };
  }, [models]);

  if (state.status === "loading") {
    return <LoadingState label="Loading provider statistics…" />;
  }
  if (state.status === "unavailable") {
    return (
      <p className={styles.empty}>
        Provider statistics need a connected backend — they aren&apos;t part of
        the static gallery.
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className={styles.empty}>
        Couldn&apos;t load provider statistics — {state.message}
      </p>
    );
  }

  const { stats } = state;
  const noEvidence = stats.providers.length === 0 && stats.probes.length === 0;

  return (
    <div className={styles.view}>
      {/* The honesty line: how much of the corpus can say anything about
          providers at all. Provider attribution is recorded per model call, so
          runs recorded before it existed carry none — absent data reads as
          absent, never as a zero. */}
      <p className={styles.scanned}>
        {formatCompact(stats.runsScanned)} gg runs scanned ·{" "}
        {formatCompact(stats.runsWithProviderData)} with provider attribution
      </p>

      {noEvidence ? (
        <p className={styles.empty}>
          No provider data yet. Providers are recorded per model call on newly
          recorded gg runs — older runs carry none — and no probes have been
          run.
        </p>
      ) : (
        <>
          {stats.providers.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Run evidence</h2>
              {stats.providers.map((entry) => (
                <ProviderBlock
                  key={entry.provider ?? "\u0000unattributed"}
                  entry={entry}
                  nameOf={nameOf}
                />
              ))}
            </section>
          )}

          {stats.probes.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Probe evidence</h2>
              <p className={styles.sectionNote}>
                From readiness probes — synthetic completion calls, not recorded
                runs.
              </p>
              {stats.probes.map((entry) => (
                <ProbeBlock
                  key={entry.provider ?? "\u0000unattributed"}
                  entry={entry}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// One provider's run evidence: a header with the rolled-up totals, then a row
// per model it served.
function ProviderBlock({
  entry,
  nameOf,
}: {
  entry: ProviderStatsEntry;
  nameOf: (modelId: string | null) => string;
}) {
  return (
    <div className={styles.provider}>
      <div className={styles.providerHead}>
        <span className={styles.providerName}>
          {entry.provider ?? "Unattributed"}
        </span>
        <span className={styles.providerSummary}>
          {formatCompact(entry.totals.calls)} calls ·{" "}
          {entry.models.length === 1
            ? "1 model"
            : `${entry.models.length} models`}{" "}
          · valid {validShare(entry.totals)}
        </span>
      </div>
      <div className={styles.table} role="table">
        <div className={`${styles.row} ${styles.head}`} role="row">
          <span>MODEL</span>
          <span className={styles.num}>CALLS</span>
          <span className={styles.num}>TOKENS</span>
          <span className={styles.num}>COST</span>
          <span className={styles.num}>REJECTED</span>
          <span className={styles.num}>TURNS</span>
          <span className={styles.num}>VALID</span>
          <span>ERRORS</span>
        </div>
        {entry.models.map((row) => (
          <div className={styles.row} role="row" key={row.modelId ?? "\u0000unknown"}>
            <span className={row.modelId == null ? styles.muted : undefined}>
              {nameOf(row.modelId)}
            </span>
            <span className={styles.num}>{formatCompact(row.stats.calls)}</span>
            <span className={styles.num}>
              {formatCompact(row.stats.totalTokens)}
            </span>
            <span
              className={`${styles.num}${row.stats.cost == null ? ` ${styles.muted}` : ""}`}
            >
              {row.stats.cost != null ? formatUsd(row.stats.cost) : "—"}
            </span>
            <span className={styles.num}>
              {formatCompact(row.stats.rejected)}
            </span>
            <span className={styles.num}>{formatCompact(row.stats.turns)}</span>
            <span className={styles.num}>{validShare(row.stats)}</span>
            <span className={styles.errors}>{errorSummary(row.stats)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// One provider's probe evidence: a row per probed model. The clean rate is
// judged calls only — an errored call classified nothing, so it is excluded
// from the denominator exactly as the probe verdict computes it.
function ProbeBlock({ entry }: { entry: ProbeProviderStats }) {
  return (
    <div className={styles.provider}>
      <div className={styles.providerHead}>
        <span className={styles.providerName}>
          {entry.provider ?? "Unattributed"}
        </span>
      </div>
      <div className={`${styles.table} ${styles.probeTable}`} role="table">
        <div className={`${styles.row} ${styles.head}`} role="row">
          <span>MODEL</span>
          <span className={styles.num}>CALLS</span>
          <span className={styles.num}>CLEAN</span>
          <span className={styles.num}>ERRORED</span>
          <span className={styles.num}>CLEAN RATE</span>
        </div>
        {entry.models.map((row) => {
          const judged = row.items - row.errored;
          return (
            <div className={styles.row} role="row" key={row.modelSlug}>
              <span>{row.modelSlug}</span>
              <span className={styles.num}>{formatCompact(row.items)}</span>
              <span className={styles.num}>{formatCompact(row.clean)}</span>
              <span className={styles.num}>{formatCompact(row.errored)}</span>
              <span className={styles.num}>
                {judged > 0 ? formatPercent(row.clean / judged) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The share of a cell's turns that worked, or a dash when no turn was
// attributed to it (calls with usage but no observed outcome).
function validShare(stats: ProviderCallStats): string {
  return stats.turns > 0 ? formatPercent(stats.working / stats.turns) : "—";
}

// The errored turns by type, e.g. "transpile_compile ×3, sandbox_trap ×1" —
// or a muted "none". Wire order (the type id, alphabetically) is kept: the
// figures are small enough to read whole.
function errorSummary(stats: ProviderCallStats): string {
  const entries = Object.entries(stats.errors);
  if (entries.length === 0) return "none";
  return entries.map(([type, count]) => `${type} ×${count}`).join(", ");
}

// Format a share for a stats cell: an exact "0%" when there are none, a "<1%"
// floor so a rare-but-present outcome never rounds away, and a rounded whole
// percent otherwise (mirrors the ring widgets' legend formatter).
function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}
