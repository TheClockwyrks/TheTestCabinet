import { useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import ReactMarkdown from "react-markdown";
import styles from "./PlayableSection.module.scss";

interface PlayableSectionProps {
  run: RunRecord;
  writeup: string | undefined;
}

// Renders a run's playable build, gated behind its writeup when one exists. A
// published implementation may be incomplete or visibly broken; the writeup is
// where that is called out, so the visitor reads it before choosing to launch
// the embed rather than being dropped into a broken page (see docs/site.md).
export function PlayableSection({ run, writeup }: PlayableSectionProps) {
  const [launched, setLaunched] = useState(false);
  const playableBuild = run.links.playableBuild;

  if (!playableBuild) {
    return (
      <div className={styles.placeholder}>
        No playable build was published for this run.
      </div>
    );
  }

  if (writeup && !launched) {
    return (
      <div className={styles.writeup}>
        <div className={styles.writeupBody}>
          <ReactMarkdown>{writeup}</ReactMarkdown>
        </div>
        <button
          type="button"
          className={styles.launch}
          onClick={() => setLaunched(true)}
        >
          Launch implementation
        </button>
      </div>
    );
  }

  return (
    <iframe
      className={styles.embed}
      src={playableBuild}
      title={`Playable build for ${run.id}`}
    />
  );
}
