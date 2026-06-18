import { useEffect, useRef, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import styles from "./PlayableSection.module.scss";

interface PlayableSectionProps {
  run: RunRecord;
}

// A run's playable build is the model's code exactly as it was written, so it
// may be incomplete or visibly broken. It must NEVER auto-load: the visitor is
// always shown a short caveat first and has to click to launch the embed (see
// docs/site.md). The reviewer's verdict lives on its own tab, so this gate only
// carries the generic caveat.
//
// Launching opens the build in a near-fullscreen overlay rather than inline.
// Builds are cross-origin iframes, so once the game takes keyboard focus the
// parent page can neither intercept its keystrokes nor reliably keep focus
// pinned inside it. An inline embed on a page taller than the viewport therefore
// let arrow/space keys scroll the page out from under the game whenever focus
// slipped back to the document. The overlay locks document scroll for its
// lifetime, so there is nothing to scroll underneath and the game keeps sole use
// of the keyboard.
export function PlayableSection({ run }: PlayableSectionProps) {
  const [launched, setLaunched] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playableBuild = run.links.playableBuild;

  // Hand keyboard input to the game on launch and lock the document scroll for
  // the lifetime of the overlay, restoring it on exit.
  useEffect(() => {
    if (!launched) {
      return;
    }
    iframeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [launched]);

  // Esc exits the overlay, matching the visible Back control. This is
  // best-effort: once focus is inside the cross-origin iframe the parent no
  // longer sees keystrokes, so the Back button is the reliable exit.
  useEffect(() => {
    if (!launched) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLaunched(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [launched]);

  if (!playableBuild) {
    return (
      <div className={styles.placeholder}>
        No playable build was published for this run.
      </div>
    );
  }

  // Gate the launch behind a generic caveat that this is the model's unedited
  // (and possibly broken) code. The build never loads until the visitor clicks.
  if (!launched) {
    return (
      <div className={styles.gate}>
        <p className={styles.notice}>
          This is the model&rsquo;s code exactly as it was written. It has not
          been edited or fixed and may be incomplete or broken.
        </p>
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
  return (
    <div className={styles.overlay} role="dialog" aria-label="Playable build">
      <div className={styles.overlayBar}>
        <button
          type="button"
          className={styles.overlayExit}
          onClick={() => setLaunched(false)}
        >
          Back
        </button>
      </div>
      <div className={styles.overlayStage}>
        <iframe
          ref={iframeRef}
          className={styles.embed}
          src={playableBuild}
          title={`Playable build for ${run.id}`}
          tabIndex={0}
        />
      </div>
    </div>
  );
}
