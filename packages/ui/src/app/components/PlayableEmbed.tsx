import { useEffect, useRef, useState, type RefObject } from "react";
import { Spinner } from "@test-cabinet/ui";
import styles from "./PlayableEmbed.module.scss";

interface EmbeddedFrameProps {
  src: string;
  title: string;
  iframeRef?: RefObject<HTMLIFrameElement | null>;
}

/**
 * The cross-origin build iframe plus the branded loading state shown until it
 * has loaded in. A static build can take a moment to boot over the network, so
 * until the iframe fires `load` we cover it with the large squadron animation
 * and a "Loading…" caption; the iframe underneath is transparent to it. The
 * loaded flag resets whenever `src` changes so a re-pointed embed shows the
 * animation again.
 */
function EmbeddedFrame({ src, title, iframeRef }: EmbeddedFrameProps) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [src]);
  return (
    <div className={styles.frame}>
      <iframe
        ref={iframeRef}
        className={styles.embed}
        src={src}
        title={title}
        tabIndex={0}
        onLoad={() => setLoaded(true)}
      />
      {loaded ? null : (
        <div className={styles.loading}>
          <Spinner variant="squadron" label="Loading…" />
        </div>
      )}
    </div>
  );
}

/**
 * How a build presents itself, which is the one axis on which a run's playable
 * build and a case's reference implementation differ:
 *
 * - `"gated"` — the run behaviour. The embed is a model's code exactly as it was
 *   written, so it may be incomplete or visibly broken and it must NEVER
 *   auto-load. The visitor is shown a short caveat first and has to click to
 *   launch it, at which point it opens in a near-fullscreen overlay (never
 *   inline). This is what {@link PlayableSection} uses.
 * - `"inline"` — the reference-implementation behaviour. The embed is the
 *   authored, *correct* build for a case variant (already redacted at publish),
 *   so there is nothing to caveat and no reason to gate it: it loads inline by
 *   default with a fullscreen *toggle* rather than a launch gate. This is what
 *   {@link ReferencePlayable} uses.
 */
export type PlayableEmbedMode = "gated" | "inline";

interface PlayableEmbedProps {
  /**
   * The absolute URL of the static build to iframe. Builds are hosted off-origin
   * (Cloudflare Pages), so this is always a fully-qualified `https` URL rather
   * than a page-relative path.
   */
  src: string;
  /** Accessible title for the iframe (also labels the fullscreen overlay). */
  title: string;
  /** Whether the build is gated behind a caveat (a run) or shown inline (a
   * reference implementation). See {@link PlayableEmbedMode}. */
  mode: PlayableEmbedMode;
}

/**
 * The reusable core of every embedded static build — a run's playable build and a
 * case variant's reference implementation alike. It owns the one thing both
 * surfaces share: the cross-origin iframe and the near-fullscreen overlay it can
 * be blown up into, along with the keyboard handling that makes an embedded game
 * usable.
 *
 * Builds are cross-origin iframes, so once the game takes keyboard focus the
 * parent page can neither intercept its keystrokes nor reliably keep focus pinned
 * inside it. An inline embed on a page taller than the viewport therefore lets
 * arrow/space keys scroll the page out from under the game whenever focus slips
 * back to the document. The overlay locks document scroll for its lifetime, so
 * there is nothing to scroll underneath and the game keeps sole use of the
 * keyboard; the iframe is made focusable (`tabIndex`) and focused on entry so the
 * first keystroke already reaches the game.
 *
 * The two modes differ only in how the overlay is entered (see
 * {@link PlayableEmbedMode}): a gated build starts on a caveat + Launch gate and
 * only ever exists inside the overlay; an inline build renders in place with a
 * Fullscreen toggle that lifts it into the same overlay.
 */
export function PlayableEmbed({ src, title, mode }: PlayableEmbedProps) {
  // Whether the near-fullscreen overlay is currently open. In gated mode this is
  // the launch state (the gate flips it true); in inline mode it is the
  // fullscreen state (the toggle flips it true). Either way, while it is true the
  // overlay owns the viewport and the keyboard.
  const [overlayOpen, setOverlayOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Hand keyboard input to the game whenever the overlay opens and lock the
  // document scroll for the lifetime of the overlay, restoring it on exit.
  useEffect(() => {
    if (!overlayOpen) {
      return;
    }
    iframeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [overlayOpen]);

  // Esc exits the overlay, matching the visible Back control. This is
  // best-effort: once focus is inside the cross-origin iframe the parent no
  // longer sees keystrokes, so the Back button is the reliable exit.
  useEffect(() => {
    if (!overlayOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOverlayOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen]);

  // The overlay: a slim bar with the Back control over a stage that fills the rest
  // of the viewport. The iframe is made focusable (tabIndex) and focused on entry
  // so arrow/space keystrokes reach the game rather than scrolling the page.
  if (overlayOpen) {
    return (
      <div className={styles.overlay} role="dialog" aria-label={title}>
        <div className={styles.overlayBar}>
          <button
            type="button"
            className={styles.overlayExit}
            onClick={() => setOverlayOpen(false)}
          >
            Back
          </button>
        </div>
        <div className={styles.overlayStage}>
          <EmbeddedFrame src={src} title={title} iframeRef={iframeRef} />
        </div>
      </div>
    );
  }

  // Gated: the build is unedited model code, so gate the launch behind a generic
  // caveat. Nothing loads until the visitor clicks; the launch opens the overlay.
  if (mode === "gated") {
    return (
      <div className={styles.gate}>
        <p className={styles.notice}>
          This is the model&rsquo;s code exactly as it was written. It has not
          been edited or fixed and may be incomplete or broken.
        </p>
        <button
          type="button"
          className={styles.launch}
          onClick={() => setOverlayOpen(true)}
        >
          Launch implementation
        </button>
      </div>
    );
  }

  // Inline: the reference implementation is the correct, authored build, so it
  // loads in place with no caveat. A Fullscreen toggle beneath it lifts it into
  // the same overlay for a full-viewport play; the inline iframe reloads on the
  // way in and out, which is harmless for a static build.
  return (
    <div className={styles.inline}>
      <EmbeddedFrame src={src} title={title} />
      <div className={styles.inlineBar}>
        <button
          type="button"
          className={styles.fullscreenToggle}
          onClick={() => setOverlayOpen(true)}
        >
          Fullscreen
        </button>
      </div>
    </div>
  );
}

interface ReferencePlayableProps {
  /**
   * The absolute URL of the variant's reference-implementation build, or `null`
   * when the variant declares no `reference_implementation` (the common case).
   */
  referenceBuild: string | null;
  /** The variant's display name, used to label the embed and the empty state. */
  variantName: string;
}

/**
 * A case variant's reference implementation, embedded on the case-detail Reference
 * tab. It is the case-variant analogue of {@link PlayableSection}: where that
 * gates a run's unedited (possibly broken) build behind a caveat, this shows the
 * authored, *correct* build inline with a fullscreen toggle and no caveat. A
 * variant that declares no reference implementation renders a short placeholder
 * rather than an empty embed.
 */
export function ReferencePlayable({
  referenceBuild,
  variantName,
}: ReferencePlayableProps) {
  if (!referenceBuild) {
    return (
      <div className={styles.placeholder}>
        No reference implementation for this variant.
      </div>
    );
  }
  return (
    <PlayableEmbed
      src={referenceBuild}
      title={`Reference implementation for ${variantName}`}
      mode="inline"
    />
  );
}
