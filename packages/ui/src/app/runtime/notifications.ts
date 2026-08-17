import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { canonicalModelId } from "../../modelId";
import type { RunNotification } from "../../client/types";

// The console's notification center: the bell's unread state, the slide-out
// sidebar's open state, and the list of received notifications.
//
// It lives in a zustand store (like `appSettings`) rather than a React context so
// the bell (in the topbar), the sidebar, and the subscription layer can all read
// and write it without threading a provider through the tree. The list of
// notifications is persisted to localStorage so the bell's unread dot and the
// history survive a reload; the push channel is live-only, so a reload does not
// replay past completions — the persisted list is what carries them across.

// One received notification, as the bell/sidebar render it.
export interface AppNotification {
  /** Stable id: the run record id for a completed run, else the job id. One run
   *  completion yields one notification, so this also dedupes re-delivery. */
  id: string;
  /** The run to open, when there is one (a completed run's record id). A failed
   *  run that never produced a record has none, so the alert carries no link. */
  runId: string | null;
  /** Whether the run finished or failed — drives the alert's tone. */
  outcome: "completed" | "failed";
  /** Short headline (e.g. "Run complete"). */
  title: string;
  /** The run's identity line (test case · harness · variant · model), or the
   *  failure reason. */
  body: string;
  /** False until the user dismisses the alert or opens the run; an
   *  auto-dismissed toast stays unread. */
  read: boolean;
  /** Epoch milliseconds the notification arrived, for newest-first ordering. */
  createdAt: number;
}

// The most notifications kept in the list. A run benchmark can produce many over
// a session; cap the history so the persisted store and the sidebar stay bounded.
const MAX_NOTIFICATIONS = 50;

interface NotificationsState {
  items: AppNotification[];
  /** Whether the right slide-out notifications sidebar is open. */
  sidebarOpen: boolean;
  /** Record a freshly received notification (newest first, deduped by id). */
  add: (notification: AppNotification) => void;
  /** Mark one notification read (the user dismissed it). */
  markRead: (id: string) => void;
  /** Mark every notification for a run read (the user opened that run). */
  markReadByRunId: (runId: string) => void;
  /** Drop one notification from the list entirely. */
  remove: (id: string) => void;
  /** Clear the whole list. */
  clear: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
}

const STORAGE_KEY = "ttc:notifications";

// An in-memory stand-in used when `localStorage` is unavailable (private mode,
// the prerender step) — persistence is best-effort, matching `appSettings`.
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function backingStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access itself can throw under strict privacy settings.
  }
  return memoryStorage();
}

export const useNotifications = create<NotificationsState>()(
  persist(
    (set) => ({
      items: [],
      sidebarOpen: false,
      add: (notification) =>
        set((state) => ({
          items: [
            notification,
            ...state.items.filter((n) => n.id !== notification.id),
          ].slice(0, MAX_NOTIFICATIONS),
        })),
      markRead: (id) =>
        set((state) => ({
          items: state.items.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),
      markReadByRunId: (runId) =>
        set((state) => {
          // Nothing to do if no unread notification points at this run — avoid a
          // needless state update (and re-render) on every navigation.
          if (!state.items.some((n) => n.runId === runId && !n.read)) {
            return state;
          }
          return {
            items: state.items.map((n) =>
              n.runId === runId ? { ...n, read: true } : n,
            ),
          };
        }),
      remove: (id) =>
        set((state) => ({ items: state.items.filter((n) => n.id !== id) })),
      clear: () => set({ items: [] }),
      openSidebar: () => set({ sidebarOpen: true }),
      closeSidebar: () => set({ sidebarOpen: false }),
      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(backingStorage),
      // Only the notification list is persisted; the sidebar's open state and the
      // actions are recreated each load.
      partialize: (state) => ({ items: state.items }),
    },
  ),
);

// Selector: the count of unread notifications, for the bell's dot. Defined here
// so the bell and any badge read the same derivation.
export const selectUnreadCount = (state: NotificationsState): number =>
  state.items.reduce((count, n) => (n.read ? count : count + 1), 0);

// Build the in-app notification from a pushed backend notification. The body is
// the run's identity for a completed run, or the failure reason. Kept here so
// every transport produces identical notifications.
export function notificationFromPush(push: RunNotification): AppNotification {
  const identity = `${push.testCaseSlug} · ${push.harnessSlug} · ${push.variant} · ${canonicalModelId(push.modelId)}`;

  // A failed publish: the run itself finished fine (and has almost certainly
  // already raised its own "Run complete" alert), so this is keyed by the publish
  // job rather than the run — otherwise it would dedupe against that completion,
  // and a second failed attempt would overwrite the first instead of alerting
  // again. It still links to the run, which is where the publish is retried.
  if (push.kind === "publish-failed") {
    return {
      id: `publish:${push.jobId}`,
      runId: push.recordId ?? null,
      outcome: "failed",
      title: "Publish failed",
      // Both halves matter: the reason alone doesn't say which run stayed
      // unpublished, and the identity alone doesn't say why it did.
      body: push.message ? `${identity} — ${push.message}` : identity,
      read: false,
      createdAt: Date.now(),
    };
  }

  const completed = push.outcome === "completed";
  return {
    id: push.recordId ?? push.jobId,
    runId: push.recordId ?? null,
    outcome: push.outcome,
    title: completed ? "Run complete" : "Run failed",
    body: completed ? identity : (push.message ?? identity),
    read: false,
    createdAt: Date.now(),
  };
}
