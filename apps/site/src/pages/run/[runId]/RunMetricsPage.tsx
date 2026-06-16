import { MetricTile } from "../../../components/MetricTile";
import { formatInteger, formatRunTime, formatUsd } from "../../../format";
import { RunDetailLayout } from "../../../layouts/run/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Metrics tab (`/runs/:runId/metrics`): the run's primary figures — tokens
// and cost — with the provider-dependent run time as a secondary tile.
export function RunMetricsPage() {
  return (
    <RunDetailLayout tab="metrics">
      {({ run }) => {
        const { metrics } = run;
        return (
          <section className={styles.section}>
            <div className={styles.metricsGrid}>
              <MetricTile
                label="Uncached input tokens"
                value={formatInteger(metrics.tokens.uncachedInput)}
              />
              <MetricTile
                label="Cached input tokens"
                value={formatInteger(metrics.tokens.cachedInput)}
              />
              <MetricTile
                label="Output tokens"
                value={formatInteger(metrics.tokens.output)}
              />
              <MetricTile
                label="Reasoning tokens"
                value={formatInteger(metrics.tokens.reasoning)}
              />
              <MetricTile
                label="Comparable cost"
                value={formatUsd(metrics.cost.comparable)}
              />
              <MetricTile
                label="Actual cost"
                value={formatUsd(metrics.cost.actual)}
              />
              <MetricTile
                label="Run time (provider dependent)"
                value={formatRunTime(metrics.runTimeSeconds)}
                secondary
              />
            </div>
          </section>
        );
      }}
    </RunDetailLayout>
  );
}
