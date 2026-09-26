import type { ReactNode } from "react";
import type { HarnessEvent } from "../../client/types";
import { eventDetail } from "../eventFeed";
import type { EventFeedStyle } from "../store/appSettings";
import { FeedView, type FeedLine } from "./FeedView";

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

// One normalized harness event as a feed line: the type doubles as the label and
// the palette key, and reasoning ("thinking") is collapsed because it is routinely
// far too long to sit inline.
function eventLine(event: HarnessEvent): FeedLine {
  return {
    eventType: event.type,
    label: event.type.toUpperCase(),
    timestamp: event.timestamp,
    detail: eventDetail(event),
    collapsible: event.type === "reasoning",
  };
}

// The harness event feed: the normalized (TTC) event stream rendered through the
// shared [FeedView], so it honors the layout the user picked in the Appearance
// settings. gg's first-party telemetry renders through that same view, which is
// what keeps a gg run's activity visually identical to every other run's.
export function EventFeed({ events, ...rest }: EventFeedProps) {
  return <FeedView lines={events.map(eventLine)} {...rest} />;
}
