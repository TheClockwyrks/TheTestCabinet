import type { Ref } from "react";
import { createAssetCache } from "../data/assetCache";
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
    return <MediaImage url={url} alt={alt} />;
  }
  return (
    <p className={styles.unsupported}>
      This console cannot show {String(kind)} media. Open the run in a newer
      build to see it.
    </p>
  );
}

// The picture URLs this session has already painted.
//
// A produced image is immutable and the browser's own cache already holds its
// bytes, so what is worth remembering here is not the picture — it is that this URL
// has been through the browser once. `loading="lazy"` defers a picture until the
// layout says it is near the viewport, which is right the first time a long page of
// references scrolls past and wrong on the way back: every tab of a run's detail
// page is its own route, so returning to one remounts the image, and deferring a
// picture whose bytes are already in hand shows the reviewer an empty box while an
// intersection observer catches up. A URL already painted is therefore loaded
// eagerly and decoded synchronously, which is what makes it appear in the frame it
// mounts in.
//
// Bounded at 512 URLs, which is far more pictures than a session puts on screen and
// costs a string each — this holds no pixels, so the bound is about not remembering
// a gallery's worth of URLs forever rather than about memory the pictures occupy.
const shownImages = createAssetCache<true>({
  name: "shown image",
  maxEntries: 512,
});

/** One picture, deferred the first time it is shown and immediate after that. */
function MediaImage({ url, alt }: { url: string; alt: string }) {
  // Read during render deliberately: `peek` is pure, and the answer has to be in
  // hand before the element is created — switching an `<img>` from lazy to eager
  // after it has mounted does not un-defer it.
  const shown = shownImages.peek(url) === true;
  return (
    <img
      className={styles.media}
      src={url}
      alt={alt}
      loading={shown ? "eager" : "lazy"}
      decoding={shown ? "sync" : "async"}
      onLoad={() => shownImages.put(url, true)}
    />
  );
}
