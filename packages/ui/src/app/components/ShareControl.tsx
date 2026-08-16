import {
  shortCodeFor,
  shortLinkPath,
  type ShareTarget,
} from "@test-cabinet/share-links";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useGalleryData } from "../data/galleryContext";
import { useCopyToClipboard } from "../data/useCopyToClipboard";
import { ShareIcon } from "./ShareIcon";
import styles from "./ShareControl.module.scss";

interface ShareControlProps {
  /** The run being shared. */
  runId: string;
  /**
   * Whether the run has cleared the publish gate. A short link addresses the
   * *published* corpus, so an unpublished run has no link to hand out — see the
   * gate in {@link ShareControl}.
   */
  published: boolean;
  /**
   * Whether the run released a playable build. False for a failure tier that
   * released none, where the play link has nothing to open.
   */
  hasPlayableBuild: boolean;
}

// Keep the popover on-screen: nudged in from each viewport edge by this margin.
// Mirrors the run context menu.
const VIEWPORT_MARGIN = 8;

interface ShareOption {
  target: ShareTarget;
  label: string;
  /** Why the option is unavailable, or null when it is offered. */
  unavailable: string | null;
}

/**
 * The run-detail share control: copy a short link to this run's verdict or play
 * page.
 *
 * Two gates decide whether it appears at all, and both are about handing out a
 * link that works:
 *
 *  - **A share base.** Null when no short-link resolver fronts this deployment
 *    (see `shareBaseUrl`), in which case there is no domain to build a link
 *    against and the control is absent rather than broken.
 *  - **A published run.** A short code addresses the corpus of *published* runs
 *    the resolver reads; an unpublished run is private and simply is not in it, so
 *    a link to one would resolve to nothing for whoever received it. A reviewer
 *    working through an unpublished run therefore sees no share control — the run
 *    is not shareable yet, and saying so by absence beats handing over a dead link.
 */
export function ShareControl({
  runId,
  published,
  hasPlayableBuild,
}: ShareControlProps) {
  const { shareBaseUrl } = useGalleryData();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { copied, copy, reset } = useCopyToClipboard();
  const [failed, setFailed] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Dismiss on outside pointerdown or Escape while open, returning focus to the
  // button so keyboard use does not lose its place.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Clamp the popover inside the viewport once measured. It is anchored to the
  // control, which sits at the right edge of the header, so on a narrow screen it
  // would otherwise hang off it.
  useLayoutEffect(() => {
    if (!open) return;
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - VIEWPORT_MARGIN);
    if (overflowRight > 0)
      el.style.transform = `translateX(-${overflowRight}px)`;
  }, [open]);

  if (!shareBaseUrl || !published) return null;

  // The canonical code for this run: derived from its id, so the console needs
  // neither the published index nor a round trip to build a link.
  //
  // In the vanishingly rare case where two published runs share a canonical code,
  // the build lengthens both — and this link, being the shorter prefix, is then
  // ambiguous and resolves to the run index instead. Every other run is
  // unaffected, and the resolver accepts any unambiguous prefix, so nothing else
  // needs to know about it.
  const code = shortCodeFor(runId);
  const base = shareBaseUrl.replace(/\/+$/, "");
  const options: ShareOption[] = [
    { target: "verdict", label: "Verdict page", unavailable: null },
    {
      target: "play",
      label: "Play page",
      unavailable: hasPlayableBuild
        ? null
        : "This run released no playable build",
    },
  ];

  const onCopy = async (target: ShareTarget) => {
    const ok = await copy(`${base}${shortLinkPath(code, target)}`);
    if (!ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    window.setTimeout(close, 600);
  };

  return (
    <div className={styles.wrapper}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share this run"
        title="Copy a short link to this run"
        onClick={() => {
          reset();
          setFailed(false);
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <ShareIcon className={styles.icon} />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className={styles.popover}
          role="menu"
          aria-label="Share this run"
        >
          {options.map((option) => (
            <button
              key={option.target}
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={option.unavailable !== null}
              title={option.unavailable ?? undefined}
              onClick={() => void onCopy(option.target)}
            >
              <span className={styles.itemLabel}>{option.label}</span>
              {/* The link itself, so it is clear what lands on the clipboard. */}
              <span className={styles.itemUrl}>
                {base.replace(/^https?:\/\//, "")}
                {shortLinkPath(code, option.target)}
              </span>
            </button>
          ))}
          <p className={styles.status} role="status">
            {failed
              ? "Couldn’t reach the clipboard"
              : copied
                ? "Copied!"
                : "Opens on The Test Cabinet"}
          </p>
        </div>
      )}
    </div>
  );
}
