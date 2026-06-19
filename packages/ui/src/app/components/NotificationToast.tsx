import { Link } from "react-router";
import { routes } from "../routes";
import { useNotifications, type AppNotification } from "../runtime/notifications";
import styles from "./NotificationToast.module.scss";

interface NotificationToastProps {
  notification: AppNotification;
  /** Dismiss the toast (supplied by react-toastify). */
  closeToast?: () => void;
}

// The body of a run-completion toast: a headline, the run's identity, and — for a
// completed run — a link to open its result. Closing rules follow the spec:
//   - the ✕ is an explicit dismiss, so it marks the notification read;
//   - clicking the link opens the run (the layer's navigation watch marks it read)
//     and dismisses the toast;
//   - an auto-dismiss (the toast timing out) does neither, so the notification
//     stays unread and waits in the bell.
export function NotificationToast({
  notification,
  closeToast,
}: NotificationToastProps) {
  const markRead = useNotifications((s) => s.markRead);
  const failed = notification.outcome === "failed";

  const heading = (
    <span className={styles.title} data-failed={failed ? "" : undefined}>
      {notification.title}
    </span>
  );

  return (
    <div className={styles.toast}>
      <div className={styles.main}>
        {notification.runId ? (
          <Link
            to={routes.runDetail(notification.runId)}
            className={styles.link}
            onClick={() => closeToast?.()}
          >
            {heading}
            <span className={styles.body}>{notification.body}</span>
          </Link>
        ) : (
          <div className={styles.link}>
            {heading}
            <span className={styles.body}>{notification.body}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        className={styles.dismiss}
        aria-label="Dismiss notification"
        onClick={() => {
          markRead(notification.id);
          closeToast?.();
        }}
      >
        &times;
      </button>
    </div>
  );
}
