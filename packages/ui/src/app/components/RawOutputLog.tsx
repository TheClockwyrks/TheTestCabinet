import type { ReactNode } from "react";
import type { RawOutputLine } from "../../client/types";
import { VirtualFeed } from "./VirtualFeed";
import styles from "./RawOutputLog.module.scss";

interface RawOutputLogProps {
  /** The raw harness output lines, in recorded order. */
  lines: RawOutputLine[];
  /** Shown in place of the log when there are no lines. */
  emptyLabel?: ReactNode;
  /**
   * Grow to fill the available column height (scrolling internally) instead of
   * capping at the fixed height, mirroring `EventFeed`'s `fill`.
   */
  fill?: boolean;
}

// The raw harness output view for the run-detail Events tab: the unprocessed
// stdout/stderr the normalized (TTC) event stream was mapped from, rendered as a
// terminal-style log. Unlike `EventFeed`, these lines are plain text with no
// type, so there is no per-type color — only `stderr` is tinted to set it apart.
// Virtualized like the event feed so a long run's output stays responsive.
// Surfaced only on the runner hosts (web/Tauri); the public site shows the TTC
// stream alone.
export function RawOutputLog({
  lines,
  emptyLabel,
  fill = false,
}: RawOutputLogProps) {
  return (
    <VirtualFeed
      className={styles.log}
      fill={fill}
      count={lines.length}
      itemContent={(index) => {
        const line = lines[index]!;
        return (
          <div className={styles.line} data-stream={line.stream}>
            {line.line || " "}
          </div>
        );
      }}
      emptyLabel={emptyLabel}
    />
  );
}
