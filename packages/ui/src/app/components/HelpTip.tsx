import styles from "./HelpTip.module.scss";

/**
 * The "?" affordance beside a label, carrying text a reader does not need in order to
 * set the control it sits on.
 *
 * The bubble is drawn by the app rather than by the browser's `title`, so it appears
 * immediately, follows the app's surface colours, and opens on keyboard focus as well
 * as on hover. The badge carries the help text as its accessible name; the bubble is
 * hidden from assistive technology so the text is announced once.
 */
export function HelpTip({ text }: { text: string }) {
  return (
    <span className={styles.tip}>
      <span className={styles.badge} role="img" aria-label={text} tabIndex={0}>
        ?
      </span>
      <span className={styles.bubble} aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
