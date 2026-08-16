import { useCallback, useEffect, useRef, useState } from "react";

/** How long a copy affordance shows its confirmation before reverting. */
export const COPIED_FEEDBACK_MS = 850;

export interface ClipboardCopy {
  /** True while the confirmation is showing, for a "Copied!" label. */
  copied: boolean;
  /**
   * Write `text` to the clipboard, resolving whether it landed. A denied or
   * absent clipboard resolves `false` rather than throwing, so a caller can fall
   * back (or just close) instead of handling a rejection.
   */
  copy: (text: string) => Promise<boolean>;
  /** Clear the confirmation immediately — for a menu reopening on a fresh target. */
  reset: () => void;
}

/**
 * Copy to the clipboard with a brief in-place confirmation.
 *
 * Shared by the affordances that hand a visitor a URL, so they confirm
 * identically and none of them has to remember that `navigator.clipboard` is
 * absent over plain HTTP and rejects without a user gesture.
 */
export function useCopyToClipboard(
  feedbackMs: number = COPIED_FEEDBACK_MS,
): ClipboardCopy {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // A copy that confirms just before the component unmounts (a menu closing on
  // the same click) would otherwise set state on an unmounted component.
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  const reset = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    setCopied(false);
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      // Checked rather than optional-chained: `navigator.clipboard?.writeText()`
      // yields `undefined` where the API is absent (any non-secure context), and
      // awaiting that resolves — reporting a copy that never happened.
      const clipboard = navigator.clipboard;
      if (!clipboard) return false;
      try {
        await clipboard.writeText(text);
      } catch {
        return false;
      }
      setCopied(true);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), feedbackMs);
      return true;
    },
    [feedbackMs],
  );

  return { copied, copy, reset };
}
