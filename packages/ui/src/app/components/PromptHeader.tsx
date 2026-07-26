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
}: PromptHeaderProps) {
  return (
    <header className={styles.hero}>
      <p
        className={`${styles.prompt}${arg !== undefined ? ` ${styles.withArg}` : ""}`}
      >
        <span className={styles.caret}>&gt;</span> the-test-cabinet {command}
        {arg !== undefined && (
          <span className={styles.arg}>&quot;{arg}&quot;</span>
        )}
        {blink && <span className={styles.blink}>_</span>}
      </p>
      <p className={styles.comment}>{comment}</p>
    </header>
  );
}
