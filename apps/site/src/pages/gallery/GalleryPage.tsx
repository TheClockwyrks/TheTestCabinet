import type { RunRecord } from "@test-cabinet/run-record";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { useRuns } from "../../data/useRuns";
import { routes } from "../../routes";
import {
  formatCompact,
  formatRunTime,
  formatSlug,
  formatUsd,
  totalTokens,
} from "../../format";
import styles from "./GalleryPage.module.scss";

// The gallery: published (and, in dev, local) runs as a dense, column-aligned
// run log over the neon grid backdrop. The log layout scales to many
// harness/model rows; it is not a leaderboard and shows no ranking.
export function GalleryPage() {
  const { runs, localIds } = useRuns();

  return (
    <PageLayout>
      <section className={styles.terminal}>
        <header className={styles.hero}>
          <p className={styles.prompt}>
            <span className={styles.caret}>&gt;</span> the-test-cabinet --list
            <span className={styles.blink}>_</span>
          </p>
          <p className={styles.comment}>
            // insert coin &middot; select a run &middot; play the result
          </p>
        </header>

        {runs.length === 0 ? (
          <p className={styles.empty}>No runs have been published yet.</p>
        ) : (
          <div className={styles.log}>
            <div className={`${styles.row} ${styles.head}`}>
              <span />
              <span>TEST</span>
              <span>HARNESS</span>
              <span>MODEL</span>
              <span className={styles.num}>TOKENS</span>
              <span className={styles.num}>COST</span>
              <span className={styles.num}>TIME</span>
              <span className={styles.num}>OK</span>
            </div>
            {runs.map((run) => (
              <RunRow key={run.id} run={run} local={localIds.has(run.id)} />
            ))}
          </div>
        )}
      </section>
    </PageLayout>
  );
}

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
      <span className={styles.model}>{subject.modelId}</span>
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
