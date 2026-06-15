import { useParams } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { useRuns } from "../../data/useRuns";
import { findWriteup } from "../../data/writeups";
import { formatInteger, formatRunTime, formatUsd } from "../../format";
import { PlayableSection } from "./PlayableSection";
import styles from "./RunDetailPage.module.scss";

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { runs, localIds, loading } = useRuns();
  const run = runId ? runs.find((candidate) => candidate.id === runId) : undefined;

  if (!run) {
    return (
      <PageLayout>
        <p className={styles.notFound}>
          {loading ? "Loading…" : <>No run found for &ldquo;{runId}&rdquo;.</>}
        </p>
      </PageLayout>
    );
  }

  const { subject, environment, metrics, validation, links, status } = run;
  const isLocal = localIds.has(run.id);

  return (
    <PageLayout>
      <h2 className={styles.title}>
        {subject.testCaseSlug} &mdash; {subject.harnessSlug}
        {isLocal && <UnpublishedTag className={styles.tag} />}
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

      {/* Validation signals: did it boot, and how did each declared check fare. */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Validation</h3>
        <p>
          Loaded:{" "}
          <span className={validation.loaded ? styles.loaded : styles.notLoaded}>
            {validation.loaded ? "Yes" : "No"}
          </span>
          {validation.detail ? (
            <span className={styles.secondary}> — {validation.detail}</span>
          ) : null}
        </p>
        {validation.checks.length > 0 ? (
          <table className={styles.checks}>
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Reached</th>
                <th scope="col">Similarity</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {validation.checks.map((check) => (
                <tr key={check.view}>
                  <th scope="row" className={styles.checkName}>
                    {check.name}
                  </th>
                  <td>
                    <span
                      className={check.reached ? styles.loaded : styles.notLoaded}
                    >
                      {check.reached ? "Yes" : "No"}
                    </span>
                  </td>
                  <td>{check.reached ? `${(check.similarity * 100).toFixed(1)}%` : "—"}</td>
                  <td className={styles.secondary}>{check.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.secondary}>This test case declares no checks.</p>
        )}
      </section>

      {/* The container the run executed in (sourced from inside the container). */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Environment</h3>
        <div className={styles.metricsGrid}>
          <Metric label="Operating system" value={environment.os} />
          <Metric label="Container image" value={environment.containerImage} />
          <Metric label="Node version" value={environment.nodeVersion ?? "Unknown"} />
          <Metric
            label="Harness version"
            value={subject.harnessVersion ? `v${subject.harnessVersion}` : "Unknown"}
          />
        </div>
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
