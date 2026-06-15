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
import styles from "./NeonLogGallery.module.scss";

interface GalleryProps {
  runs: RunRecord[];
  localIds: ReadonlySet<string>;
}

// Neon Log: the CRT Terminal's dense, column-aligned run log — which scales to
// many harness/model rows — rendered in the Neon Grid's synthwave palette over
// the neon grid + scanline backdrop. A scannable table that keeps the neon mood.
export function NeonLogGallery({ runs, localIds }: GalleryProps) {
  return (
    <section className={styles.terminal}>
      <header className={styles.hero}>
        <p className={styles.prompt}>
          <span className={styles.caret}>&gt;</span> the-test-cabinet --list
          <span className={styles.blink}>_</span>
        </p>
        <p className={styles.comment}>
          // insert coin &middot; agent runs, played &middot; not a leaderboard
        </p>
      </header>

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
          <Link
            key={run.id}
            to={routes.runDetail(run.id)}
            className={styles.row}
          >
            <span className={styles.rowCaret}>&rsaquo;</span>
            <span className={styles.test}>
              {formatSlug(run.subject.testCaseSlug)}
              {localIds.has(run.id) && <UnpublishedTag className={styles.tag} />}
            </span>
            <span>{run.subject.harnessSlug}</span>
            <span className={styles.model}>{run.subject.modelId}</span>
            <span className={styles.num}>{formatCompact(totalTokens(run.metrics))}</span>
            <span className={styles.num}>{formatUsd(run.metrics.cost.comparable)}</span>
            <span className={styles.num}>{formatRunTime(run.metrics.runTimeSeconds)}</span>
            <span
              className={`${styles.num} ${
                run.validation.loaded ? styles.ok : styles.bad
              }`}
            >
              {run.validation.loaded ? "[Y]" : "[N]"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
