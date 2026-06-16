import type { RunRecord } from "@test-cabinet/run-record";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Markdown } from "../../components/Markdown";
import { Panel } from "../../components/Panel";
import { PageLayout } from "../../components/PageLayout";
import { RatingBadge } from "../../components/RatingBadge";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { useModels } from "../../data/useModels";
import type { Rating } from "../../data/ratings";
import { useRuns } from "../../data/useRuns";
import { findReview } from "../../data/writeups";
import {
  formatCompact,
  formatSlug,
  formatUsd,
  totalTokens,
} from "../../format";
import { routes } from "../../routes";
import styles from "./ModelDetailPage.module.scss";

// Model detail: the model's identity (name, provider, an OpenRouter icon link),
// its catalog per-token prices, its description prose, and the test-case runs
// that used it (any harness), newest first. Runs map to the model via the
// catalog's `modelIds` matched against each run's `subject.modelId`. There is no
// ranking — the runs are ordered purely by recency.
export function ModelDetailPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const { models } = useModels();
  const { runs, localIds, localWriteups } = useRuns();

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

  const ratingOf = (run: RunRecord): Rating | null =>
    findReview(run.id, localWriteups)?.rating ?? null;

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

  return (
    <PageLayout>
      <header className={styles.identity}>
        <p className={styles.crumb}>
          <Link to={routes.models()}>&larr; Models</Link>
        </p>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{model.name}</h1>
          {model.openrouterUrl && (
            <a
              className={styles.openrouter}
              href={model.openrouterUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="View on OpenRouter"
              title="View on OpenRouter"
            >
              <span className={styles.openrouterIcon} aria-hidden="true" />
            </a>
          )}
        </div>
        <p className={styles.provider}>{model.provider}</p>
      </header>

      {/* Cost: per-token catalog list prices, when known. */}
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
        </div>
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
              <span>VARIANT</span>
              <span className={styles.num}>TOKENS</span>
              <span className={styles.num}>COST</span>
              <span>RATING</span>
            </div>
            {modelRuns.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                local={localIds.has(run.id)}
                rating={ratingOf(run)}
              />
            ))}
          </div>
        )}
      </section>
    </PageLayout>
  );
}

// One run line in the model's run log. Mirrors the Home gallery's row layout but
// drops the model column — every run here is this model.
function RunRow({
  run,
  local,
  rating,
}: {
  run: RunRecord;
  local: boolean;
  rating: Rating | null;
}) {
  const { subject, metrics } = run;
  return (
    <Link to={routes.runDetail(run.id)} className={styles.row}>
      <span className={styles.rowCaret}>&rsaquo;</span>
      <span className={styles.test}>
        {formatSlug(subject.testCaseSlug)}
        {local && <UnpublishedTag className={styles.tag} />}
      </span>
      <span>{subject.harnessSlug}</span>
      <span className={styles.variant}>{subject.variant}</span>
      <span className={styles.num}>{formatCompact(totalTokens(metrics))}</span>
      <span className={styles.num}>{formatUsd(metrics.cost.comparable)}</span>
      <span className={styles.rating}>
        {rating ? (
          <RatingBadge rating={rating} />
        ) : (
          <span className={styles.noRating}>—</span>
        )}
      </span>
    </Link>
  );
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
