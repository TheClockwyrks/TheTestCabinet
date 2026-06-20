import {
  useLayoutEffect,
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
  // True while we're programmatically pinning to the bottom (a new item arrived,
  // or follow was just re-enabled). It tells `atBottomStateChange` to ignore the
  // brief "left the bottom" report that growing the list emits before the pin
  // lands — only a report while we're *not* pinning means the user scrolled away.
  const pinningToBottom = useRef(false);

  // Pin to the newest item while following — on every new item as the feed
  // streams, and when the Follow button re-enables it after the user scrolled
  // away. Keyed on `count` as well as `follow`: re-running per item is exactly
  // what keeps a live feed pinned, and it can't yank a reader upward because
  // scrolling up has already set `follow` false (so this effect no-ops).
  //
  // We own the pinning rather than leaning on react-virtuoso's `followOutput`
  // because only `scrollToIndex` lets us pass `align: "end"`, which lands the
  // *bottom* of the last item at the viewport bottom. `followOutput` aligns the
  // item's top, so a final event taller than the remaining space stops short of
  // the bottom — tripping `atBottomStateChange(false)` and turning follow off on
  // its own. A `useLayoutEffect` pins before paint, so there's no flash of the
  // unpinned position.
  useLayoutEffect(() => {
    if (follow && count > 0) {
      pinningToBottom.current = true;
      handle.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    }
  }, [follow, count]);

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
        // Start pinned to the newest item when following — the pinning effect
        // only runs after mount, so a subscription that replays its backlog in
        // one batch (mounting straight to N items) would otherwise open scrolled
        // to the top.
        initialTopMostItemIndex={follow ? Math.max(0, count - 1) : 0}
        atBottomStateChange={(atBottom) => {
          if (atBottom) {
            // Settled at the bottom: the pin (if any) has landed, so a later
            // "left the bottom" is the user scrolling for real.
            pinningToBottom.current = false;
            return;
          }
          // Ignore the bottom leaving while we're pinning — that's the list
          // growing under a freshly appended item, not the user scrolling.
          // Otherwise report it so follow detaches; re-following is then an
          // explicit action (the Follow button), never a side effect of
          // scrolling back down.
          if (!pinningToBottom.current) onFollowChange?.(false);
        }}
        increaseViewportBy={400}
      />
    </div>
  );
}
