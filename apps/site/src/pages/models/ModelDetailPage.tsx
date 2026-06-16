import type { RunRecord } from "@test-cabinet/run-record";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Chart } from "../../components/Chart";
import { Markdown } from "../../components/Markdown";
import { Panel } from "../../components/Panel";
import { PageLayout } from "../../components/PageLayout";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { boxAndWhisker } from "../../components/plot/charts";
import { useModels } from "../../data/useModels";
import { useRuns } from "../../data/useRuns";
import {
  formatCompact,
  formatRunTime,
  formatSlug,
  formatUsd,
  totalTokens,
} from "../../format";
import { routes } from "../../routes";
import styles from "./ModelDetailPage.module.scss";

// Model detail: the model's identity (name, provider, OpenRouter link), its
// catalog/observed cost, its description prose, and the test-case runs that used
// it (any harness), newest first. Runs map to the model via the catalog's
// `modelIds` matched against each run's `subject.modelId`. There is no ranking —
// the cost chart shows the spread of observed run cost, never a score.
export function ModelDetailPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const { models } = useModels();
  const { runs, localIds } = useRuns();

  // Resolve by catalog slug first, then by a covered model id, so both
  // `/models/<slug>` and `/models/<modelId>` links land here.
  const model = models.find(
    (entry) => entry.slug === modelId || entry.modelIds.includes(modelId ?? ""),
  );

  // This model's runs, newest first. A model may cover several ids, so match
  // any of them against the run's subject.
  const modelRuns = useMemo(() => {
    if (!model) return [];
    const ids = new Set(model.modelIds);
    return runs
      .filter((run) => ids.has(run.subject.modelId))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [model, runs]);

  if (!model) {
    return (
      <PageLayout>
        <p className={styles.empty}>Unknown model: {modelId}</p>
        <p className={styles.line}>
          <Link to={routes.models()}>&larr; All models</Link>
        </p>
      </PageLayout>
    );
  }

  // Observed comparable cost across this model's runs — a real-world counterpart
  // to the catalog's per-token list price.
  const observed = observedCost(modelRuns);

  return (
    <PageLayout>
      <header className={styles.identity}>
        <p className={styles.crumb}>
          <Link to={routes.models()}>&larr; Models</Link>
        </p>
        <h1 className={styles.title}>{model.name}</h1>
        <p className={styles.provider}>{model.provider}</p>
        {model.openrouterUrl && (
          <a
            className={styles.openrouter}
            href={model.openrouterUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on OpenRouter &rsaquo;
          </a>
        )}
      </header>

      {/* Cost: per-token catalog prices (when known) and the cost actually
          observed across this model's runs. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cost</h2>
        <div className={styles.metricsGrid}>
          {model.prices ? (
            <>
              <Metric
                label="Uncached input / Mtok"
                value={formatUsd(model.prices.uncachedInput * 1e6)}
              />
              <Metric
                label="Cached input / Mtok"
                value={formatUsd(model.prices.cachedInput * 1e6)}
              />
              <Metric
                label="Output / Mtok"
                value={formatUsd(model.prices.output * 1e6)}
              />
            </>
          ) : (
            <Metric label="Catalog prices" value="—" secondary />
          )}
          {observed && (
            <>
              <Metric
                label={`Observed cost / run (n=${observed.count})`}
                value={formatUsd(observed.mean)}
              />
              <Metric
                label="Observed cost (total)"
                value={formatUsd(observed.total)}
                secondary
              />
            </>
          )}
        </div>
        {modelRuns.length > 1 && (
          <Chart
            className={styles.chart}
            title={`Comparable cost per run for ${model.name}`}
            spec={(palette) =>
              boxAndWhisker(
                modelRuns.map((run) => ({
                  group: "cost",
                  value: run.metrics.cost.comparable,
                })),
                palette,
                { y: "USD / run" },
              )
            }
          />
        )}
      </section>

      {/* Model description prose, rendered through the shared Markdown component
          and wrapped so it stays legible over the backdrop. */}
      {model.description && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>About</h2>
          <Panel>
            <Markdown>{model.description}</Markdown>
          </Panel>
        </section>
      )}

      {/* Test-case runs that used this model, newest first. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Runs</h2>
        {modelRuns.length === 0 ? (
          <p className={styles.empty}>No runs have used this model yet.</p>
        ) : (
          <div className={styles.log}>
            <div className={`${styles.row} ${styles.head}`}>
              <span />
              <span>TEST</span>
              <span>HARNESS</span>
              <span className={styles.num}>TOKENS</span>
              <span className={styles.num}>COST</span>
              <span className={styles.num}>TIME</span>
              <span className={styles.num}>OK</span>
            </div>
            {modelRuns.map((run) => (
              <RunRow key={run.id} run={run} local={localIds.has(run.id)} />
            ))}
          </div>
        )}
      </section>
    </PageLayout>
  );
}

// One run line in the model's run log. Mirrors the Home gallery's row layout but
// drops the model column — every run here is this model.
function RunRow({ run, local }: { run: RunRecord; local: boolean }) {
  const { subject, metrics, validation } = run;
  return (
    <Link to={routes.runDetail(run.id)} className={styles.row}>
      <span className={styles.rowCaret}>&rsaquo;</span>
      <span className={styles.test}>
        {formatSlug(subject.testCaseSlug)}
        {local && <UnpublishedTag className={styles.tag} />}
      </span>
      <span>{subject.harnessSlug}</span>
      <span className={styles.num}>{formatCompact(totalTokens(metrics))}</span>
      <span className={styles.num}>{formatUsd(metrics.cost.comparable)}</span>
      <span className={styles.num}>{formatRunTime(metrics.runTimeSeconds)}</span>
      <span
        className={`${styles.num} ${validation.loaded ? styles.ok : styles.bad}`}
      >
        {validation.loaded ? "[Y]" : "[N]"}
      </span>
    </Link>
  );
}

interface ObservedCost {
  count: number;
  total: number;
  mean: number;
}

// Summarizes the comparable cost across a model's runs. Returns null when there
// are no runs, so callers can omit the figures entirely rather than show zeros.
function observedCost(runs: readonly RunRecord[]): ObservedCost | null {
  if (runs.length === 0) return null;
  const total = runs.reduce((sum, run) => sum + run.metrics.cost.comparable, 0);
  return { count: runs.length, total, mean: total / runs.length };
}

interface MetricProps {
  label: string;
  value: string;
  secondary?: boolean;
}

function Metric({ label, value, secondary = false }: MetricProps) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span
        className={`${styles.metricValue}${secondary ? ` ${styles.secondary}` : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
