import type { RunRecord } from "@test-cabinet/run-record";
import { Link } from "react-router";
import { routes } from "../../../routes";
import {
  formatCompact,
  formatRunTime,
  formatSlug,
  formatUsd,
  totalTokens,
} from "../../../format";
import { UnpublishedTag } from "../../../components/UnpublishedTag";
import styles from "./MinimalGallery.module.scss";

interface GalleryProps {
  runs: RunRecord[];
  localIds: ReadonlySet<string>;
}

// Minimal: a quiet, editorial gallery. Generous whitespace, hairline rules, and
// restrained orange accents. The metrics do the talking; the chrome gets out of
// the way.
export function MinimalGallery({ runs, localIds }: GalleryProps) {
  return (
    <section>
      <header className={styles.hero}>
        <h1 className={styles.title}>Runs</h1>
        <p className={styles.tagline}>
          Agent builds, with their metrics. Browse, compare, and play them.
        </p>
      </header>
      <ul className={styles.list}>
        {runs.map((run) => (
          <li key={run.id}>
            <Row run={run} local={localIds.has(run.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ run, local }: { run: RunRecord; local: boolean }) {
  const { subject, metrics, validation } = run;
  return (
    <Link className={styles.row} to={routes.runDetail(run.id)}>
      <span className={styles.lead}>
        <span className={styles.test}>
          {formatSlug(subject.testCaseSlug)}
          {local && <UnpublishedTag className={styles.tag} />}
        </span>
        <span className={styles.subject}>
          {subject.harnessSlug} &middot; {subject.modelId}
        </span>
      </span>
      <span className={styles.metrics}>
        <Metric label="tokens" value={formatCompact(totalTokens(metrics))} />
        <Metric label="cost" value={formatUsd(metrics.cost.comparable)} />
        <Metric label="time" value={formatRunTime(metrics.runTimeSeconds)} />
      </span>
      <span
        className={`${styles.status} ${validation.loaded ? styles.loaded : styles.notLoaded}`}
        title={validation.loaded ? "Loaded" : "Did not load"}
      >
        <span className={styles.dot} />
        {validation.loaded ? "Loaded" : "No boot"}
      </span>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className={styles.metric}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </span>
  );
}
