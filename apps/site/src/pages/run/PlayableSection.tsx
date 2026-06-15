import { useEffect, useRef, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import { Markdown } from "../../components/Markdown";
import { RatingBadge } from "../../components/RatingBadge";
import { RATING_META, type ParsedWriteup } from "../../data/ratings";
import styles from "./PlayableSection.module.scss";

interface PlayableSectionProps {
  run: RunRecord;
  review: ParsedWriteup | undefined;
}

// A run's playable build is the model's code exactly as it was written, so it
// may be incomplete or visibly broken. It must NEVER auto-load: the visitor is
// always shown context first (the hand-written review — its rating and writeup —
// when one exists, otherwise a short generic caveat) and has to click to launch
// the embed (see docs/site.md). Once launched it can expand to a near-fullscreen
// overlay so the game gets keyboard focus without the page scrolling underneath.
export function PlayableSection({ run, review }: PlayableSectionProps) {
  const [launched, setLaunched] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playableBuild = run.links.playableBuild;

  // Hand keyboard input to the game and stop the page scrolling underneath the
  // overlay. We focus the iframe whenever it mounts or enters fullscreen, and
  // lock the document scroll for the duration of the near-fullscreen viewport,
  // restoring it on exit.
  useEffect(() => {
    if (!launched) {
      return;
    }
    iframeRef.current?.focus();
  }, [launched, fullscreen]);

  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  // Esc exits the near-fullscreen viewport, matching the visible Back control.
  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  if (!playableBuild) {
    return (
      <div className={styles.placeholder}>
        No playable build was published for this run.
      </div>
    );
  }

  // Gate the launch behind context: the review (its rating headline and writeup)
  // when one exists, otherwise a generic caveat that this is the model's unedited
  // (and possibly broken) code.
  if (!launched) {
    return (
      <div className={styles.gate}>
        {review ? (
          <>
            {review.rating && (
              <p className={styles.verdict}>
                <RatingBadge rating={review.rating} />
                <span className={styles.verdictLabel}>
                  {RATING_META[review.rating].description}
                </span>
              </p>
            )}
            <Markdown className={styles.writeupBody}>{review.body}</Markdown>
          </>
        ) : (
          <p className={styles.notice}>
            This is the model&rsquo;s code exactly as it was written. It has not
            been edited or fixed and may be incomplete or broken.
          </p>
        )}
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

  // The iframe is made focusable (tabIndex) and focused on launch so arrow/space
  // keystrokes reach the game rather than scrolling the page.
  const embed = (
    <iframe
      ref={iframeRef}
      className={styles.embed}
      src={playableBuild}
      title={`Playable build for ${run.id}`}
      tabIndex={0}
    />
  );

  if (fullscreen) {
    return (
      <div className={styles.overlay} role="dialog" aria-label="Playable build">
        <div className={styles.overlayBar}>
          <button
            type="button"
            className={styles.overlayExit}
            onClick={() => setFullscreen(false)}
          >
            Back
          </button>
        </div>
        <div className={styles.overlayStage}>{embed}</div>
      </div>
    );
  }

  return (
    <div className={styles.player}>
      <div className={styles.playerBar}>
        <button
          type="button"
          className={styles.expand}
          onClick={() => setFullscreen(true)}
        >
          Expand
        </button>
      </div>
      {embed}
    </div>
  );
}
