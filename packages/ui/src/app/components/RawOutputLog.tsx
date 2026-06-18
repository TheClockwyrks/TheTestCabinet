import type { ReactNode, RefObject } from "react";
import type { RawOutputLine } from "../../client/types";
import styles from "./RawOutputLog.module.scss";

interface RawOutputLogProps {
  /** The raw harness output lines, in recorded order. */
  lines: RawOutputLine[];
  /** Shown in place of the log when there are no lines. */
  emptyLabel?: ReactNode;
  /** Scroll container ref, mirroring `EventFeed` for consistent hosting. */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

// The raw harness output view for the run-detail Events tab: the unprocessed
// stdout/stderr the normalized (TTC) event stream was mapped from, rendered as a
// terminal-style log. Unlike `EventFeed`, these lines are plain text with no
// type, so there is no per-type color — only `stderr` is tinted to set it apart.
// Surfaced only on the runner hosts (web/Tauri); the public site shows the TTC
// stream alone.
export function RawOutputLog({ lines, emptyLabel, scrollRef }: RawOutputLogProps) {
  return (
    <div className={styles.log} ref={scrollRef}>
      {lines.length === 0 && emptyLabel && (
        <p className={styles.empty}>{emptyLabel}</p>
      )}
      {lines.map((line, i) => (
        <div key={i} className={styles.line} data-stream={line.stream}>
          {line.line || " "}
        </div>
      ))}
    </div>
  );
}
