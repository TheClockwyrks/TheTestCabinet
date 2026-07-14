import type { RunRecord } from "@test-cabinet/run-record";
import { PlayableEmbed } from "../../components/PlayableEmbed";
import styles from "../../components/PlayableEmbed.module.scss";

interface PlayableSectionProps {
  run: RunRecord;
}

// A run's playable build is the model's code exactly as it was written, so it may
// be incomplete or visibly broken. This is the "gated" presentation of the shared
// {@link PlayableEmbed}: the visitor is always shown a short caveat first and has
// to click to launch the embed, which opens in a near-fullscreen overlay rather
// than inline (see docs/site.md). The reviewer's verdict lives on its own tab, so
// the embed's gate only carries the generic caveat. A run with no published build
// shows a short placeholder instead.
export function PlayableSection({ run }: PlayableSectionProps) {
  const playableBuild = run.links.playableBuild;

  if (!playableBuild) {
    return (
      <div className={styles.placeholder}>
        No playable build was published for this run.
      </div>
    );
  }

  return (
    <PlayableEmbed
      src={playableBuild}
      title={`Playable build for ${run.id}`}
      mode="gated"
    />
  );
}
