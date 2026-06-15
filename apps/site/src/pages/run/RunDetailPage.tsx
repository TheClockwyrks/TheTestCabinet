import { useParams } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { findRun } from "../../data/runs";
import { findWriteup } from "../../data/writeups";
import { formatInteger, formatRunTime, formatUsd } from "../../format";
import { PlayableSection } from "./PlayableSection";
import styles from "./RunDetailPage.module.scss";

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const run = runId ? findRun(runId) : undefined;

  if (!run) {
    return (
      <PageLayout>
        <p className={styles.notFound}>No run found for &ldquo;{runId}&rdquo;.</p>
      </PageLayout>
    );
  }

  const { subject, metrics, validation, links, status } = run;

  return (
    <PageLayout>
      <h2 className={styles.title}>
        {subject.testCaseSlug} &mdash; {subject.harnessSlug}
      </h2>
      <p className={styles.subject}>
        {subject.modelId} &middot; test case {subject.testCaseVersion}
        {subject.harnessVersion
          ? ` · harness v${subject.harnessVersion}`
          : ""}
      </p>

      {/* Play the implementation, gated behind its writeup when one exists. */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Play</h3>
        <PlayableSection run={run} writeup={findWriteup(run.id)} />
      </section>

      {/* Primary metrics: tokens and cost. Run time is secondary. */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Metrics</h3>
        <div className={styles.metricsGrid}>
          <Metric label="Uncached input tokens" value={formatInteger(metrics.tokens.uncachedInput)} />
          <Metric label="Cached input tokens" value={formatInteger(metrics.tokens.cachedInput)} />
          <Metric label="Output tokens" value={formatInteger(metrics.tokens.output)} />
          <Metric label="Reasoning tokens" value={formatInteger(metrics.tokens.reasoning)} />
          <Metric label="Comparable cost" value={formatUsd(metrics.cost.comparable)} />
          <Metric label="Actual cost" value={formatUsd(metrics.cost.actual)} />
          <Metric
            label="Run time (provider dependent)"
            value={formatRunTime(metrics.runTimeSeconds)}
            secondary
          />
        </div>
      </section>

      {/* Validation signals. */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Validation</h3>
        <p>
          Loaded:{" "}
          <span className={validation.loaded ? styles.loaded : styles.notLoaded}>
            {validation.loaded ? "Yes" : "No"}
          </span>
        </p>
        {validation.checks.length > 0 && (
          <ul className={styles.list}>
            {validation.checks.map((check) => (
              <li key={check.view}>
                {check.reached
                  ? `${check.view}: ${(check.similarity * 100).toFixed(1)}% similarity`
                  : `${check.view}: not reached${check.detail ? ` (${check.detail})` : ""}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Clone the source for yourself. */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Source</h3>
        {links.sourceRepo ? (
          <a href={links.sourceRepo} target="_blank" rel="noreferrer">
            {links.sourceRepo}
          </a>
        ) : (
          <span className={styles.secondary}>
            No source repository was published.
          </span>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Status</h3>
        <p>
          {status.state}
          {status.detail ? ` — ${status.detail}` : ""}
        </p>
      </section>
    </PageLayout>
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
