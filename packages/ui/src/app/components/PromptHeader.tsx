import type { ReactNode } from "react";
import styles from "./PromptHeader.module.scss";

interface PromptHeaderProps {
  /** The command flag shown after `the-test-cabinet`, e.g. `--models`. */
  command: string;
  /** The muted `//` comment line beneath the prompt. */
  comment: ReactNode;
  /** Trail the prompt with a blinking cursor when set. */
  blink?: boolean;
  /**
   * An optional argument rendered in quotes after the command (e.g. a coverage
   * plan or group name). The flag stays fixed while the argument truncates with
   * an ellipsis rather than wrapping the header onto a second line.
   */
  arg?: string;
  /**
   * The page's own actions, pinned to the trailing edge of the prompt line — a
   * "+ New run" button and the links beside it.
   *
   * Given to the header rather than laid out beside it, because a header that is one
   * column of somebody else's row is a header whose second line is that column wide.
   * Both rows are the header's, so both run the full width of the page and the two
   * trailing edges line up.
   */
  titleActions?: ReactNode;
  /**
   * Controls pinned to the trailing edge of the comment line — the runs section's
   * global stop cluster is the one user of it.
   *
   * The comment is a short line of prose on a full-width row, so the space beside it
   * is free: a cluster put there costs a page no height at all, where the same cluster
   * beside a tab strip pushes the strip onto a second row the moment either grows.
   * They wrap under the comment, still right-aligned, when the row is too narrow.
   */
  actions?: ReactNode;
}

// The cabinet's shared terminal-prompt page header: a neon
// `> the-test-cabinet <command>` line over a muted `// ...` comment. Every
// top-level section renders it so the pages read as commands typed into one
// console.
export function PromptHeader({
  command,
  comment,
  blink = false,
  arg,
  titleActions,
  actions,
}: PromptHeaderProps) {
  const prompt = (
    <p
      className={`${styles.prompt}${arg !== undefined ? ` ${styles.withArg}` : ""}`}
    >
      <span className={styles.caret}>&gt;</span> the-test-cabinet {command}
      {arg !== undefined && (
        <span className={styles.arg}>&quot;{arg}&quot;</span>
      )}
      {blink && <span className={styles.blink}>_</span>}
    </p>
  );
  return (
    <header className={styles.hero}>
      {titleActions ? (
        <div className={styles.titleRow}>
          {prompt}
          <div className={styles.titleActions}>{titleActions}</div>
        </div>
      ) : (
        prompt
      )}
      {actions ? (
        <div className={styles.commentRow}>
          <p className={styles.comment}>{comment}</p>
          <div className={styles.commentActions}>{actions}</div>
        </div>
      ) : (
        <p className={styles.comment}>{comment}</p>
      )}
    </header>
  );
}
