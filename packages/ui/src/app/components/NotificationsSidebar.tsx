import { useEffect } from "react";
import { Link } from "react-router";
import { routes } from "../routes";
import { useNotifications } from "../runtime/notifications";
import styles from "./NotificationsSidebar.module.scss";

// The right slide-out notifications panel, toggled by the topbar bell. Lists
// received notifications newest-first: each links to its run (opening it dismisses
// the alert via the layer's navigation watch), with a per-item dismiss and a
// "Clear all". Closes on the backdrop, the ✕, or Escape. Mounted once by
// `NotificationsLayer` (consoles only); it renders nothing interactive until
// opened, so it is cheap to keep mounted for the slide animation.
export function NotificationsSidebar() {
  const items = useNotifications((s) => s.items);
  const open = useNotifications((s) => s.sidebarOpen);
  const closeSidebar = useNotifications((s) => s.closeSidebar);
  const markRead = useNotifications((s) => s.markRead);
  const remove = useNotifications((s) => s.remove);
  const clear = useNotifications((s) => s.clear);

  // Escape closes the panel while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSidebar]);

  return (
    <div
      className={styles.root}
      data-open={open ? "" : undefined}
      // Hidden from the accessibility tree and tab order when closed.
      aria-hidden={open ? undefined : true}
    >
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close notifications"
        tabIndex={open ? 0 : -1}
        onClick={closeSidebar}
      />
      <aside
        className={styles.panel}
        role="dialog"
        aria-label="Notifications"
        aria-modal={open ? true : undefined}
      >
        <header className={styles.header}>
          <span className={styles.heading}>Notifications</span>
          <div className={styles.headerActions}>
            {items.length > 0 && (
              <button
                type="button"
                className={styles.clear}
                onClick={clear}
                tabIndex={open ? 0 : -1}
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              className={styles.close}
              aria-label="Close notifications"
              tabIndex={open ? 0 : -1}
              onClick={closeSidebar}
            >
              &times;
            </button>
          </div>
        </header>

        {items.length === 0 ? (
          <p className={styles.empty}>No notifications.</p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li
                key={item.id}
                className={styles.item}
                data-unread={item.read ? undefined : ""}
                data-failed={item.outcome === "failed" ? "" : undefined}
              >
                {item.runId ? (
                  <Link
                    to={routes.runDetail(item.runId)}
                    className={styles.itemMain}
                    onClick={closeSidebar}
                  >
                    <span className={styles.itemTitle}>{item.title}</span>
                    <span className={styles.itemBody}>{item.body}</span>
                  </Link>
                ) : (
                  <div className={styles.itemMain}>
                    <span className={styles.itemTitle}>{item.title}</span>
                    <span className={styles.itemBody}>{item.body}</span>
                  </div>
                )}
                <div className={styles.itemControls}>
                  {!item.read && (
                    <button
                      type="button"
                      className={styles.markRead}
                      onClick={() => markRead(item.id)}
                      tabIndex={open ? 0 : -1}
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.dismiss}
                    aria-label="Remove notification"
                    onClick={() => remove(item.id)}
                    tabIndex={open ? 0 : -1}
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
