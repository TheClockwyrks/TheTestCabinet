import { useEffect, useRef, useState } from "react";
import type { ValidationMedia } from "../../../data/galleryContext";
import { MediaView } from "../../../components/MediaView";
import styles from "../RunExec.module.scss";

// One automated-validation output shown as a side-by-side pair: the case's
// reference implementation (the baseline) beside this run's build (the actual), so
// a reviewer compares expected-vs-observed behavior for the mechanic the auto
// verdict judged. When only the actual side was produced it stands alone. For video
// outputs the pair shares one Play/Pause control, sat in the output's title row:
// Play restarts both clips from the top and plays them together (so the reference and
// the run advance frame-for-frame), Pause stops both, and the clips loop so the
// comparison keeps repeating. The two clips are muted so playing them together is not
// a cacophony.
//
// This is the pairing for an image or a clip. An output captured as an engine
// replay is paired by {@link ValidationReplayPair} instead: a recording has no
// decoder and no clock of its own, so its two panes share one clock and land on the
// same frame by construction rather than by two players staying roughly in step.
export function ValidationMediaPair({ media }: { media: ValidationMedia }) {
  const isVideo = media.kind === "video";
  const actualRef = useRef<HTMLVideoElement>(null);
  const baselineRef = useRef<HTMLVideoElement>(null);
  const hasBaseline = media.baselineUrl !== null;
  const hasActual = media.actualUrl !== null;
  const [playing, setPlaying] = useState(false);

  // Restart both clips from the top and play them together; clicking Play again
  // restarts. Pause stops both where they are.
  const play = () => {
    for (const ref of [baselineRef, actualRef]) {
      const el = ref.current;
      if (el) {
        el.currentTime = 0;
        void el.play();
      }
    }
  };
  const pause = () => {
    for (const ref of [baselineRef, actualRef]) ref.current?.pause();
  };

  // Keep the toggle label in step with the clips even when the reviewer scrubs with
  // the native controls: mirror the primary clip's play/pause events. Both clips are
  // driven together, so tracking one is enough. (Looping never fires `pause`, so the
  // label stays "Pause" across loops.)
  useEffect(() => {
    const el = (hasActual ? actualRef : baselineRef).current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [hasActual]);

  // When the reviewer moves to another review item this pair is reused for that
  // item's media (its output ids can collide with the previous item's, so React
  // reconciles the same element rather than remounting): the video elements get new
  // sources and stop, but swapping a `src` fires no `pause` event for the label-sync
  // effect above to catch, leaving the toggle stuck on "Pause" over a stopped clip.
  // Reset the label whenever the media changes so it always matches what is shown.
  useEffect(() => {
    setPlaying(false);
  }, [media.actualUrl, media.baselineUrl]);

  return (
    <figure className={styles.validationOutput}>
      <figcaption className={styles.validationOutputHeader}>
        <span className={styles.validationOutputName}>{media.name}</span>
        {isVideo && (hasActual || hasBaseline) && (
          <button
            type="button"
            className={styles.validationPlay}
            onClick={playing ? pause : play}
            aria-pressed={playing}
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
        )}
      </figcaption>
      <div
        className={`${styles.mediaPanes}${
          hasActual && hasBaseline ? "" : ` ${styles.mediaPanesSingle}`
        }`}
      >
        {hasBaseline && (
          <figure className={styles.mediaPane}>
            <figcaption className={styles.mediaPaneLabel}>Reference</figcaption>
            <MediaView
              kind={media.kind}
              url={media.baselineUrl!}
              alt={`Reference ${media.name}`}
              loop
              muted
              videoRef={baselineRef}
            />
          </figure>
        )}
        <figure className={styles.mediaPane}>
          <figcaption className={styles.mediaPaneLabel}>This run</figcaption>
          {hasActual ? (
            <MediaView
              kind={media.kind}
              url={media.actualUrl!}
              alt={`This run ${media.name}`}
              loop
              muted
              videoRef={actualRef}
            />
          ) : (
            <p className={styles.mediaMissing}>
              This run did not produce this output.
            </p>
          )}
        </figure>
      </div>
    </figure>
  );
}
