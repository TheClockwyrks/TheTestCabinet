// A message body with a fullscreen affordance, shared by the Prompt and Requests
// views. Messages can be long — a whole rendered prompt, a turn's tool result — so
// each `<pre>` carries a small expand button that opens the same text in a page-wide
// overlay, where the full width and height of the screen is available to read it.
// The overlay dismisses on its close button, a click on the backdrop outside the
// panel, or Escape.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import panels from "./GgPanels.module.scss";

/**
 * A `<pre>` of message text with a floated "expand" button in its top-right corner;
 * clicking it opens {@link MessageOverlay} over the page with the same content. The
 * inline `<pre>` keeps whatever class the host passed (so it reads identically to the
 * un-expandable ones around it); the button is layered over its corner.
 */
export function ExpandablePre({
  content,
  className,
  label,
}: {
  content: string;
  /** The class the host renders its inline `<pre>` with (band tint, scroll, etc.). */
  className?: string;
  /** An accessible name for the overlay (e.g. the message's band + role). */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={panels.expandable}>
      <pre className={className}>{content}</pre>
      <button
        type="button"
        className={panels.expandButton}
        onClick={() => setOpen(true)}
        aria-label={`Open ${label} fullscreen`}
        title="Open fullscreen"
      >
        ⛶
      </button>
      {open && (
        <MessageOverlay
          content={content}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The fullscreen message sheet: a fixed, blurred scrim portalled over the page (so
 * it escapes any panel's overflow/stacking) holding the message text at full width
 * and height. The run monitor stays visible but de-emphasized behind it, so the
 * overlay reads as a layer rather than as a separate screen. A click on the
 * backdrop, the close button, or Escape dismisses it; a click inside the panel does
 * not (its propagation is stopped).
 */
function MessageOverlay({
  content,
  label,
  onClose,
}: {
  content: string;
  label: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className={panels.overlayBackdrop}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={panels.overlayPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`${label}, fullscreen`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={panels.overlayHead}>
          <span className={panels.overlayLabel}>{label}</span>
          <button
            type="button"
            className={panels.overlayClose}
            onClick={onClose}
            aria-label="Close fullscreen"
            title="Close"
          >
            ✕
          </button>
        </div>
        <pre className={panels.overlayContent}>{content}</pre>
      </div>
    </div>,
    document.body,
  );
}
