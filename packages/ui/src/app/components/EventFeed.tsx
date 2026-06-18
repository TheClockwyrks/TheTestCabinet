import type { ReactNode } from "react";
import type { HarnessEvent } from "../../client/types";
import { eventDetail, formatEventTime } from "../eventFeed";
import type { EventFeedStyle } from "../store/appSettings";
import { VirtualFeed } from "./VirtualFeed";
import styles from "./EventFeed.module.scss";

interface EventFeedProps {
  /** The events to render, in arrival order. */
  events: HarnessEvent[];
  /** Which visual treatment to render in (see `EventFeedStyle`). */
  feedStyle: EventFeedStyle;
  /** Shown in place of the list when there are no events. */
  emptyLabel?: ReactNode;
  /**
   * Render at preview scale (shorter, non-scrolling) for the settings picker.
   */
  preview?: boolean;
  /**
   * Grow to fill the available column height (scrolling internally) instead of
   * capping at the fixed max-height. For full-height hosts like the live monitor.
   */
  fill?: boolean;
  /**
   * Live-follow control, forwarded to the virtualized scroller. When true the
   * feed pins to the newest event as events arrive; the user scrolling up reports
   * `onFollowChange(false)`, and toggling it back to true snaps to the bottom.
   * Omitted by non-live feeds (recorded events, the preview), which never follow.
   */
  follow?: boolean;
  onFollowChange?: (following: boolean) => void;
}

// One event row: a per-type colored cue, the type label, the wall-clock time, and
// the event detail. The arrangement is driven entirely by CSS off the ancestor
// feed's `data-feed-style`; this markup is identical across every layout.
function EventLine({ event }: { event: HarnessEvent }) {
  return (
    <div className={styles.line} data-event-type={event.type}>
      <div className={styles.gutter}>
        <span className={styles.type}>{event.type.toUpperCase()}</span>
        <span className={styles.time}>{formatEventTime(event.timestamp)}</span>
      </div>
      <span className={styles.body}>{eventDetail(event)}</span>
    </div>
  );
}

// The harness event feed: a dense, monospace activity stream rendered in one of
// three interchangeable layouts (see `EventFeedStyle`). Every layout shows the
// same data and differs only in arrangement, driven by the `data-feed-style`
// attribute. The per-type colors come from the shared `--ttc-event-*` tokens, so
// the feed matches the CLI's terminal palette. The streaming feeds (the live
// monitor, the run-detail Events tab) are virtualized so a long run stays
// responsive; the Appearance settings preview is a short, non-scrolling sample,
// so it renders as a plain list instead.
export function EventFeed({
  events,
  feedStyle,
  emptyLabel,
  preview = false,
  fill = false,
  follow,
  onFollowChange,
}: EventFeedProps) {
  if (preview) {
    return (
      <div className={styles.feed} data-feed-style={feedStyle} data-preview="">
        {events.map((event, i) => (
          <EventLine key={i} event={event} />
        ))}
      </div>
    );
  }

  return (
    <VirtualFeed
      className={styles.feed}
      data-feed-style={feedStyle}
      fill={fill}
      count={events.length}
      itemContent={(index) => <EventLine event={events[index]!} />}
      emptyLabel={emptyLabel}
      follow={follow}
      onFollowChange={onFollowChange}
    />
  );
}
