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
import styles from "./NeonGridGallery.module.scss";

interface GalleryProps {
  runs: RunRecord[];
  localIds: ReadonlySet<string>;
}

// Neon Grid: synthwave. A glowing wordmark over the grid horizon, and runs as
// neon-outlined panels whose stats light up on hover.
export function NeonGridGallery({ runs, localIds }: GalleryProps) {
  return (
    <section>
      <header className={styles.hero}>
        <h1 className={styles.title}>The Test Cabinet</h1>
        <p className={styles.tagline}>Insert coin &mdash; agent runs, played.</p>
      </header>
      <div className={styles.grid}>
        {runs.map((run) => (
          <Panel key={run.id} run={run} local={localIds.has(run.id)} />
        ))}
      </div>
    </section>
  );
}

function Panel({ run, local }: { run: RunRecord; local: boolean }) {
  const { subject, metrics, validation } = run;
  return (
    <Link className={styles.panel} to={routes.runDetail(run.id)}>
      <div className={styles.panelHead}>
        <span className={styles.test}>{formatSlug(subject.testCaseSlug)}</span>
        <span className={`${styles.dot} ${validation.loaded ? styles.live : styles.dead}`} />
      </div>
      <p className={styles.subject}>
        {subject.harnessSlug} &middot; {subject.modelId}
        {local && <UnpublishedTag className={styles.tag} />}
      </p>
      <div className={styles.stats}>
        <Stat label="Tokens" value={formatCompact(totalTokens(metrics))} />
        <Stat label="Cost" value={formatUsd(metrics.cost.comparable)} />
        <Stat label="Time" value={formatRunTime(metrics.runTimeSeconds)} />
      </div>
      <span className={styles.play}>Play &rsaquo;</span>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}
