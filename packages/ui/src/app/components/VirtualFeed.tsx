import {
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import styles from "./VirtualFeed.module.scss";

interface VirtualFeedProps extends ComponentPropsWithoutRef<"div"> {
  /** How many items the feed holds. */
  count: number;
  /** Render the item at `index`. */
  itemContent: (index: number) => ReactNode;
  /** A stable key for the item at `index` (defaults to the index). */
  computeKey?: (index: number) => string | number;
  /** Shown in place of the list when there are no items. */
  emptyLabel?: ReactNode;
  /**
   * Grow to fill the available column height (scrolling internally) instead of
   * sitting at a fixed height. Drives the container's `data-fill`.
   */
  fill?: boolean;
  /**
   * Live-follow control. When true the feed pins to the newest item as items are
   * appended, and re-enabling it (false → true) snaps to the bottom. The user
   * scrolling away from the bottom reports `onFollowChange(false)`. Leave unset
   * on feeds that never follow (recorded events), and the feed scrolls freely.
   */
  follow?: boolean;
  /** Called with `false` when the user scrolls away from the bottom. */
  onFollowChange?: (following: boolean) => void;
}

// A virtualized, optionally follow-to-bottom scroller shared by the event feed
// and the raw output log. Only the visible window of rows is in the DOM, so a run
// with thousands of recorded events (or output lines) stays responsive. The
// container element carries the caller's `className` and any extra props (e.g.
// `data-feed-style`), so the feeds' descendant styling resolves through it; the
// rows render inside react-virtuoso's scroller within.
export function VirtualFeed({
  count,
  itemContent,
  computeKey,
  emptyLabel,
  fill = false,
  follow,
  onFollowChange,
  className,
  ...rest
}: VirtualFeedProps) {
  const handle = useRef<VirtuosoHandle>(null);

  // Snap to the newest item whenever following is (re-)enabled. Ongoing pinning
  // as items stream in is handled by `followOutput`; this covers the button
  // re-enabling follow after the user scrolled away. Intentionally keyed on
  // `follow` alone — re-running on every count change would yank the view to the
  // bottom even while the user is reading further up.
  useEffect(() => {
    if (follow && count > 0) {
      handle.current?.scrollToIndex({ index: "LAST", behavior: "auto" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);

  if (count === 0) {
    return (
      <div className={className} data-fill={fill ? "" : undefined} {...rest}>
        {emptyLabel && <p className={styles.empty}>{emptyLabel}</p>}
      </div>
    );
  }

  return (
    <div className={className} data-fill={fill ? "" : undefined} {...rest}>
      <Virtuoso
        ref={handle}
        className={styles.scroller}
        style={{ height: "100%" }}
        totalCount={count}
        itemContent={itemContent}
        // Only forward a key function when the caller supplies one. Passing
        // `computeItemKey={undefined}` is NOT the same as omitting it:
        // react-virtuoso treats the prop as present and overwrites its own
        // `index => index` default with `undefined`, then calls it per row and
        // throws "computeItemKey is not a function" the moment the first item
        // renders. Omitting the prop lets that built-in default stand — which is
        // the index-keyed behavior this component documents anyway.
        {...(computeKey ? { computeItemKey: computeKey } : {})}
        // Start pinned to the newest item when following — `followOutput` only
        // reacts to growth after mount, so a subscription that replays its
        // backlog in one batch (mounting straight to N items) would otherwise
        // open scrolled to the top.
        initialTopMostItemIndex={follow ? Math.max(0, count - 1) : 0}
        followOutput={follow ? "auto" : false}
        atBottomStateChange={(atBottom) => {
          // Only ever report leaving the bottom — re-following is an explicit
          // action (the Follow button), never a side effect of scrolling back.
          if (!atBottom) onFollowChange?.(false);
        }}
        increaseViewportBy={400}
      />
    </div>
  );
}
