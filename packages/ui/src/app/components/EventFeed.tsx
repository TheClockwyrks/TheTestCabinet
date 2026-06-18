import type { ReactNode, RefObject } from "react";
import type { HarnessEvent } from "../../client/types";
import { eventDetail, formatEventTime } from "../eventFeed";
import type { EventFeedStyle } from "../store/appSettings";
import styles from "./EventFeed.module.scss";

interface EventFeedProps {
  /** The events to render, in arrival order. */
  events: HarnessEvent[];
  /** Which visual treatment to render in (see `EventFeedStyle`). */
  feedStyle: EventFeedStyle;
  /** Shown in place of the list when there are no events. */
  emptyLabel?: ReactNode;
  /** Scroll container ref, so a live host can auto-scroll as events arrive. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /**
   * Render at preview scale (shorter, non-scrolling) for the settings picker.
   */
  preview?: boolean;
  /**
   * Grow to fill the available column height (scrolling internally) instead of
   * capping at the fixed max-height. For full-height hosts like the live monitor.
   */
  fill?: boolean;
}

// The live harness event feed: a dense, monospace activity stream rendered in one
// of three interchangeable layouts (see `EventFeedStyle`). Every layout shows the
// same data — a per-type colored cue, the type label, the wall-clock time, and the
// event detail — and differs only in arrangement, driven entirely by CSS off the
// `data-feed-style` attribute. The per-type colors come from the shared
// `--ttc-event-*` tokens, so the feed matches the CLI's terminal palette. Used by
// the run monitor and by the Appearance settings preview.
export function EventFeed({
  events,
  feedStyle,
  emptyLabel,
  scrollRef,
  preview = false,
  fill = false,
}: EventFeedProps) {
  return (
    <div
      className={styles.feed}
      data-feed-style={feedStyle}
      data-preview={preview ? "" : undefined}
      data-fill={fill ? "" : undefined}
      ref={scrollRef}
    >
      {events.length === 0 && emptyLabel && (
        <p className={styles.empty}>{emptyLabel}</p>
      )}
      {events.map((event, i) => (
        <div key={i} className={styles.line} data-event-type={event.type}>
          <div className={styles.gutter}>
            <span className={styles.type}>{event.type.toUpperCase()}</span>
            <span className={styles.time}>
              {formatEventTime(event.timestamp)}
            </span>
          </div>
          <span className={styles.body}>{eventDetail(event)}</span>
        </div>
      ))}
    </div>
  );
}
