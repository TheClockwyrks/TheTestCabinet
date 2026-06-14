import type { RunRecord } from "@test-cabinet/run-record";
import { Link } from "react-router";
import { routes } from "../routes";
import { formatInteger, formatRunTime, formatUsd } from "../format";
import styles from "./RunCard.module.scss";

interface RunCardProps {
  run: RunRecord;
}

export function RunCard({ run }: RunCardProps) {
  const { subject, metrics, validation } = run;
  const totalTokens =
    metrics.tokens.uncachedInput +
    metrics.tokens.cachedInput +
    metrics.tokens.output +
    metrics.tokens.reasoning;

  return (
    <Link className={styles.card} to={routes.runDetail(run.id)}>
      <div className={styles.heading}>
        <span className={styles.testCase}>{subject.testCaseSlug}</span>
        <span className={styles.secondary}>{subject.harnessSlug}</span>
      </div>
      <div className={styles.subject}>{subject.modelId}</div>

      <div className={styles.metrics}>
        {/* Primary numbers: tokens and cost. */}
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Total tokens</span>
          <span className={styles.metricValue}>{formatInteger(totalTokens)}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Comparable cost</span>
          <span className={styles.metricValue}>
            {formatUsd(metrics.cost.comparable)}
          </span>
        </div>

        {/* Secondary: run time (provider dependent). */}
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Run time</span>
          <span className={`${styles.metricValue} ${styles.secondary}`}>
            {formatRunTime(metrics.runTimeSeconds)}
          </span>
        </div>

        {/* Validation signal. */}
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Loaded</span>
          <span
            className={`${styles.metricValue} ${
              validation.loaded ? styles.loaded : styles.notLoaded
            }`}
          >
            {validation.loaded ? "Yes" : "No"}
          </span>
        </div>
      </div>
    </Link>
  );
}
