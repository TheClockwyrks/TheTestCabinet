import { useEffect, useRef, type RefObject } from "react";
import styles from "./SubmitNotice.module.scss";

// Reveals the outcome of a press. Returns a ref to attach to the element carrying
// the message; whenever the message changes to something, the element scrolls
// itself onto the screen.
//
// Placement alone is not enough to make an outcome visible. A notice parked at a
// fixed point in the document can only be seen when the whole form happens to fit
// the viewport; on a form long enough to scroll, the operator presses the button,
// nothing they can see changes, and a page working exactly as designed reads as a
// dead one.
//
// Use this directly only where a page draws the notice in its own chrome;
// everywhere else `SubmitNotice` renders it.
export function useRevealNotice<T extends HTMLElement>(
  message: string | null,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Revealed once per appearance, and armed again only by the notice clearing.
  // Some actions report themselves progressively — a publish rewrites its message
  // on every line of its progress stream — and revealing each rewrite would drag a
  // reader who had scrolled away back to the notice over and over.
  const revealed = useRef(false);

  useEffect(() => {
    if (!message) {
      revealed.current = false;
      return;
    }
    if (revealed.current) return;
    revealed.current = true;
    // Feature-detected rather than merely null-checked: jsdom implements no layout
    // and so defines no `scrollIntoView` at all, and an unguarded call would throw
    // out of the effect under test. `nearest` scrolls the minimum distance, so a
    // notice already on screen does not yank the page around.
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [message]);

  return ref;
}

// What a submit action reports back — the failure that stopped it, or the progress
// and success of one that ran. It belongs immediately above the action row that
// raised it, and reveals itself when it appears.
//
// Renders nothing when there is no message, so a call site drops it in
// unconditionally.
export function SubmitNotice({
  message,
  tone = "error",
}: {
  message: string | null;
  tone?: "error" | "ok";
}) {
  const ref = useRevealNotice<HTMLParagraphElement>(message);
  if (!message) return null;
  return (
    <p
      ref={ref}
      className={`${styles.notice} ${styles[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}
