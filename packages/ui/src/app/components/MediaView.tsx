import type { Ref } from "react";
import type { MediaKind } from "../../client/types";
import type { StoredImageResolver } from "../pages/runs/replay/drawFrame";
import { ReplayPlayer } from "../pages/runs/replay/ReplayPlayer";
import styles from "./MediaView.module.scss";

// Render a piece of reference or proof media — an image, a video, or an engine
// replay — by its kind. A video is shown with native controls; an image fills the
// available width and keeps its aspect ratio; a replay is re-drawn onto a canvas
// by the replay player, with its own transport. Used for the expected/submitted
// panes in the review flow and the standalone Proof and References views.
//
// A video optionally takes `loop`/`muted` and a `videoRef`, so a caller pairing
// two clips (the automated-validation actual-vs-baseline comparison) can loop them
// and drive both from one control by holding a ref to each element. These are
// inert for an image and for a replay — a replay pair is driven by sharing a
// clock, not by holding refs to two elements, and is built from the player's parts
// directly (see `ValidationReplayPair`) rather than through this view.
//
// The kinds are handled one by one, with an explicit last word for a kind this
// build does not know: a media kind added to the run-record contract reaches a
// console that predates it, and handing an unknown kind to an <img> renders a
// broken image icon over a file that was never a picture. Saying so is the honest
// outcome, and it is the same reason the replay format is version-checked.
export function MediaView({
  kind,
  url,
  alt,
  loop,
  muted,
  videoRef,
  storeUrl,
}: {
  kind: MediaKind;
  url: string;
  alt: string;
  loop?: boolean;
  muted?: boolean;
  videoRef?: Ref<HTMLVideoElement>;
  /**
   * Where to find an image a replay keeps beside itself, by file name — inert for
   * every other kind.
   *
   * A recording may carry its pixels in files next to it rather than inline, and
   * those are resolved the way the recording's own URL was, by the caller that knew
   * how. A caller with nothing to resolve them with passes nothing and the entries
   * naming them are reported and skipped, which is what every showcase call site
   * does: those recordings are authored by hand and carry their pixels inline.
   */
  storeUrl?: StoredImageResolver | null;
}) {
  if (kind === "video") {
    return (
      <video
        ref={videoRef}
        className={styles.media}
        src={url}
        controls
        playsInline
        loop={loop}
        muted={muted}
      />
    );
  }
  if (kind === "replay") {
    return <ReplayPlayer url={url} label={alt} storeUrl={storeUrl} />;
  }
  if (kind === "image") {
    return <img className={styles.media} src={url} alt={alt} loading="lazy" />;
  }
  return (
    <p className={styles.unsupported}>
      This console cannot show {String(kind)} media. Open the run in a newer
      build to see it.
    </p>
  );
}
