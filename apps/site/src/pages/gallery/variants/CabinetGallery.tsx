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
import styles from "./CabinetGallery.module.scss";

interface GalleryProps {
  runs: RunRecord[];
  localIds: ReadonlySet<string>;
}

// Cabinet Hall: each run is rendered as an upright arcade cabinet — lit marquee,
// recessed screen showing the model and a HUD readout, and a control panel
// footer. A row of cabinets in a darkened hall.
export function CabinetGallery({ runs, localIds }: GalleryProps) {
  return (
    <section>
      <header className={styles.hero}>
        <h1 className={styles.title}>The Test Cabinet</h1>
        <p className={styles.tagline}>
          Step up to the cabinets. Each one is an agent&rsquo;s build &mdash;
          read the marquee, check the metrics, then play it.
        </p>
      </header>
      <div className={styles.hall}>
        {runs.map((run) => (
          <Cabinet key={run.id} run={run} local={localIds.has(run.id)} />
        ))}
      </div>
    </section>
  );
}

function Cabinet({ run, local }: { run: RunRecord; local: boolean }) {
  const { subject, metrics, validation, status } = run;
  return (
    <Link className={styles.cabinet} to={routes.runDetail(run.id)}>
      <div className={styles.marquee}>
        <span className={styles.marqueeText}>{formatSlug(subject.testCaseSlug)}</span>
      </div>
      <div className={styles.screen}>
        <div className={styles.screenTop}>
          <span className={styles.harness}>{subject.harnessSlug}</span>
          {local && <UnpublishedTag className={styles.tag} />}
          <span className={`${styles.lamp} ${validation.loaded ? styles.on : styles.off}`}>
            {validation.loaded ? "LOADED" : "NO BOOT"}
          </span>
        </div>
        <div className={styles.model}>{subject.modelId}</div>
        <dl className={styles.hud}>
          <div className={styles.stat}>
            <dt>TOKENS</dt>
            <dd>{formatCompact(totalTokens(metrics))}</dd>
          </div>
          <div className={styles.stat}>
            <dt>COST</dt>
            <dd>{formatUsd(metrics.cost.comparable)}</dd>
          </div>
        </dl>
      </div>
      <div className={styles.panel}>
        <span className={styles.time}>{formatRunTime(metrics.runTimeSeconds)}</span>
        <span className={`${styles.state} ${styles[status.state]}`}>{status.state}</span>
        <span className={styles.play}>Play &rsaquo;</span>
      </div>
    </Link>
  );
}
