import { toast } from "react-toastify";
import styles from "./toasts.module.scss";

/** How a toast reads: the outcome it reports, which colours its headline. */
export type ToastTone = "success" | "error" | "info";

export interface ToastMessage {
  /** Short headline (e.g. "Kill active"). */
  title: string;
  /** The detail line beneath it — the count, or the failure's reason. */
  body: string;
  /** Defaults to `info`: a report that is neither a success nor a failure. */
  tone?: ToastTone;
}

interface MessageToastProps extends ToastMessage {
  /** Dismiss the toast (supplied by react-toastify). */
  closeToast?: () => void;
}

// The body of a plain report toast: a headline, a detail line, and a dismiss
// control. Distinct from `NotificationToast`, which reports a run the console was
// pushed and therefore links to it and files it in the bell; this reports what an
// action the user just took did, so it is transient and belongs to nothing.
export function MessageToast({
  title,
  body,
  tone = "info",
  closeToast,
}: MessageToastProps) {
  return (
    <div className={styles.toast}>
      <div className={styles.main}>
        <div className={styles.lines}>
          <span className={styles.title} data-tone={tone}>
            {title}
          </span>
          <span className={styles.body}>{body}</span>
        </div>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        aria-label="Dismiss message"
        onClick={() => closeToast?.()}
      >
        &times;
      </button>
    </div>
  );
}

/**
 * Raise a transient report of what an action just did.
 *
 * The container that renders it is mounted by `NotificationsLayer`, so this
 * reports from anywhere a console can execute, which is everywhere an action worth
 * reporting can be taken. A caller outside that (the static site) raises nothing.
 */
export function showToast(message: ToastMessage) {
  toast(
    ({ closeToast }) => <MessageToast {...message} closeToast={closeToast} />,
    // The tone reaches toastify too, so the chrome it owns (the icon and the
    // progress bar) agrees with the headline this body colours.
    { type: message.tone === "info" ? "default" : (message.tone ?? "default") },
  );
}
