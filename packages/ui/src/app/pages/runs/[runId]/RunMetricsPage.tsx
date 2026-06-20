import { MetricTile } from "@test-cabinet/ui";
import {
  formatRunTime,
  formatTokenCount,
  formatUsd,
  sumTokens,
} from "../../../format";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Metrics tab (`/runs/:runId/metrics`): the run's primary figures laid out
// in three rows — the input/output token totals, then their breakdowns
// (uncached vs cached input, reasoning vs non-reasoning output), then cost and
// run time. Output tokens are the sum of the non-reasoning (`output`) and
// reasoning categories, matching how token totals are accounted everywhere else.
// A category the harness doesn't report shows as an em dash, and a total that
// folds in such a category is itself shown as unknown rather than under-counted.
export function RunMetricsPage() {
  return (
    <RunDetailLayout tab="metrics">
      {({ run }) => {
        const { tokens, cost, runTimeSeconds } = run.metrics;
        const inputTokens = sumTokens(tokens.uncachedInput, tokens.cachedInput);
        const outputTokens = sumTokens(tokens.output, tokens.reasoning);
        return (
          <section className={styles.section}>
            <div className={styles.metricRows}>
              <div className={`${styles.metricRow} ${styles.cols2}`}>
                <MetricTile
                  label="Input tokens"
                  value={formatTokenCount(inputTokens)}
                />
                <MetricTile
                  label="Output tokens"
                  value={formatTokenCount(outputTokens)}
                />
              </div>
              <div className={`${styles.metricRow} ${styles.cols4}`}>
                <MetricTile
                  label="Uncached input tokens"
                  value={formatTokenCount(tokens.uncachedInput)}
                />
                <MetricTile
                  label="Cached input tokens"
                  value={formatTokenCount(tokens.cachedInput)}
                />
                <MetricTile
                  label="Reasoning tokens"
                  value={formatTokenCount(tokens.reasoning)}
                />
                <MetricTile
                  label="Non-reasoning tokens"
                  value={formatTokenCount(tokens.output)}
                />
              </div>
              <div className={`${styles.metricRow} ${styles.cols2}`}>
                <MetricTile label="Cost" value={formatUsd(cost.comparable)} />
                <MetricTile
                  label="Run time"
                  value={formatRunTime(runTimeSeconds)}
                />
              </div>
            </div>
          </section>
        );
      }}
    </RunDetailLayout>
  );
}
