import type { ReactNode } from "react";
import { eventSummary, formatEventTime } from "../eventFeed";
import type { EventFeedStyle } from "../store/appSettings";
import { VirtualFeed } from "./VirtualFeed";
import styles from "./FeedView.module.scss";

/**
 * One line of an activity feed, independent of where it came from.
 *
 * This is the single row shape every feed in the console renders: the normalized
 * harness event stream (see `EventFeed`) and gg's own first-party telemetry stream
 * (see `GgRunPanels`). Both feeds therefore honor the user's chosen
 * [`EventFeedStyle`] and read identically — a gg run's activity is not a
 * one-off layout that ignores the setting.
 */
export interface FeedLine {
  /**
   * The palette key, written to `data-event-type` and resolving the row's
   * `--event-color` from the shared `--ttc-event-*` tokens. Harness events pass
   * their event type; gg passes its feed tone. An unrecognized key falls back to
   * the muted default.
   */
  eventType: string;
  /** The short label shown in the gutter, already cased as it should read. */
  label: string;
  /** The event's wall-clock timestamp, formatted for the gutter. */
  timestamp: string;
  /** The line's main text. */
  detail: string;
  /** A compact secondary line, muted, beneath the detail (e.g. a call's args). */
  args?: string;
  /** A small chip in the gutter (gg attributes a line to the agent that emitted it). */
  chip?: string;
  /**
   * Collapse the detail behind a one-line summary. For text that is routinely far
   * too long to sit inline (model reasoning).
   */
  collapsible?: boolean;
}

interface FeedViewProps {
  /** The lines to render, in arrival order. */
  lines: FeedLine[];
  /** Which visual treatment to render in (see `EventFeedStyle`). */
  feedStyle: EventFeedStyle;
  /** Shown in place of the list when there are no lines. */
  emptyLabel?: ReactNode;
  /** Render at preview scale (shorter, non-scrolling) for the settings picker. */
  preview?: boolean;
  /**
   * Grow to fill the available column height (scrolling internally) instead of
   * capping at the fixed max-height. For full-height hosts like the live monitor.
   */
  fill?: boolean;
  /**
   * Live-follow control, forwarded to the virtualized scroller. When true the
   * feed pins to the newest line as lines arrive; the user scrolling up reports
   * `onFollowChange(false)`, and toggling it back to true snaps to the bottom.
   * Omitted by non-live feeds (recorded events, the preview), which never follow.
   */
  follow?: boolean;
  onFollowChange?: (following: boolean) => void;
}

// One feed row: a per-type colored cue, the label, the wall-clock time, and the
// detail. The arrangement is driven entirely by CSS off the ancestor feed's
// `data-feed-style`; this markup is identical across every layout.
function Line({ line }: { line: FeedLine }) {
  return (
    <div className={styles.line} data-event-type={line.eventType}>
      <div className={styles.gutter}>
        <span className={styles.type}>{line.label}</span>
        {line.chip && <span className={styles.chip}>{line.chip}</span>}
        <span className={styles.time}>{formatEventTime(line.timestamp)}</span>
      </div>
      {line.collapsible ? (
        // Collapsed by default behind a one-line preview; a native <details> needs
        // no state and react-virtuoso re-measures the row when it is toggled open.
        // The secondary line sits OUTSIDE the disclosure, because it says what the
        // row is a preview *of* — how many lines there are, what a capture cap
        // dropped — which is what a reader needs in order to decide to expand it.
        <div className={styles.body}>
          <details>
            <summary className={styles.summary}>
              {eventSummary(line.detail)}
            </summary>
            <div className={styles.collapsed}>{line.detail}</div>
          </details>
          {line.args && <div className={styles.args}>{line.args}</div>}
        </div>
      ) : (
        <div className={styles.body}>
          <span className={styles.detail}>{line.detail}</span>
          {line.args && <div className={styles.args}>{line.args}</div>}
        </div>
      )}
    </div>
  );
}

// The console's activity feed: a dense, monospace stream rendered in one of three
// interchangeable layouts (see `EventFeedStyle`). Every layout shows the same data
// and differs only in arrangement, driven by the `data-feed-style` attribute. The
// per-type colors come from the shared `--ttc-event-*` tokens, so the feed matches
// the CLI's terminal palette. The streaming feeds (the live monitor, the run-detail
// Events tab, the gg activity panel) are virtualized so a long run stays responsive;
// the Appearance settings preview is a short, non-scrolling sample, so it renders as
// a plain list instead.
export function FeedView({
  lines,
  feedStyle,
  emptyLabel,
  preview = false,
  fill = false,
  follow,
  onFollowChange,
}: FeedViewProps) {
  if (preview) {
    return (
      <div className={styles.feed} data-feed-style={feedStyle} data-preview="">
        {lines.map((line, i) => (
          <Line key={i} line={line} />
        ))}
      </div>
    );
  }

  return (
    <VirtualFeed
      className={styles.feed}
      data-feed-style={feedStyle}
      fill={fill}
      count={lines.length}
      itemContent={(index) => <Line line={lines[index]!} />}
      emptyLabel={emptyLabel}
      follow={follow}
      onFollowChange={onFollowChange}
    />
  );
}
