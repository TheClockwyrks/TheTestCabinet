import { beforeEach, describe, expect, it } from "vitest";
import type { RunNotification } from "../../client/types";
import {
  notificationFromPush,
  selectUnreadCount,
  useNotifications,
  type AppNotification,
} from "./notifications";

// The store is a module singleton; reset it (and the backing localStorage)
// between cases so each starts from an empty, closed center.
beforeEach(() => {
  useNotifications.setState({ items: [], sidebarOpen: false });
  try {
    window.localStorage.clear();
  } catch {
    // No storage in this environment — the store still works in memory.
  }
});

function note(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "rec-1",
    runId: "rec-1",
    outcome: "completed",
    title: "Run complete",
    body: "pong · claude · base · claude-sonnet-4-5",
    read: false,
    createdAt: 1,
    ...overrides,
  };
}

describe("notifications store", () => {
  it("adds newest-first and dedupes by id", () => {
    const { add } = useNotifications.getState();
    add(note({ id: "a", runId: "a" }));
    add(note({ id: "b", runId: "b" }));
    // Re-adding an existing id replaces it in place at the front, not twice.
    add(note({ id: "a", runId: "a", title: "Run complete (again)" }));

    const { items } = useNotifications.getState();
    expect(items.map((n) => n.id)).toEqual(["a", "b"]);
    expect(items[0]!.title).toBe("Run complete (again)");
  });

  it("counts only unread for the bell", () => {
    const { add, markRead } = useNotifications.getState();
    add(note({ id: "a", runId: "a" }));
    add(note({ id: "b", runId: "b" }));
    expect(selectUnreadCount(useNotifications.getState())).toBe(2);

    markRead("a");
    expect(selectUnreadCount(useNotifications.getState())).toBe(1);
  });

  it("marks every notification for a run read when it is opened", () => {
    const { add, markReadByRunId } = useNotifications.getState();
    add(note({ id: "a", runId: "run-9" }));
    add(note({ id: "b", runId: "run-9" }));
    add(note({ id: "c", runId: "other" }));

    markReadByRunId("run-9");
    const byId = Object.fromEntries(
      useNotifications.getState().items.map((n) => [n.id, n.read]),
    );
    expect(byId).toEqual({ a: true, b: true, c: false });
  });

  it("toggles the sidebar", () => {
    const { toggleSidebar } = useNotifications.getState();
    expect(useNotifications.getState().sidebarOpen).toBe(false);
    toggleSidebar();
    expect(useNotifications.getState().sidebarOpen).toBe(true);
  });
});

describe("notificationFromPush", () => {
  const base: RunNotification = {
    kind: "run-completed",
    jobId: "job-1",
    testCaseSlug: "pong",
    variant: "base",
    harnessSlug: "claude",
    modelId: "claude-sonnet-4-5",
    outcome: "completed",
    recordId: "rec-7",
  };

  it("links a completed run to its record and reads as unread", () => {
    const n = notificationFromPush(base);
    expect(n.id).toBe("rec-7");
    expect(n.runId).toBe("rec-7");
    expect(n.title).toBe("Run complete");
    expect(n.read).toBe(false);
    expect(n.body).toContain("pong");
  });

  it("falls back to the job id and surfaces the reason for a failure", () => {
    const n = notificationFromPush({
      ...base,
      outcome: "failed",
      recordId: undefined,
      message: "the container would not start",
    });
    expect(n.id).toBe("job-1");
    expect(n.runId).toBeNull();
    expect(n.title).toBe("Run failed");
    expect(n.body).toBe("the container would not start");
  });

  const publishFailed: RunNotification = {
    ...base,
    kind: "publish-failed",
    jobId: "publish-9",
    outcome: "failed",
    recordId: "rec-7",
    message: "`gh repo create` failed: HTTP 503",
  };

  it("names a failed publish, links it to the run, and gives both the identity and the reason", () => {
    const n = notificationFromPush(publishFailed);
    expect(n.title).toBe("Publish failed");
    expect(n.outcome).toBe("failed");
    expect(n.runId).toBe("rec-7");
    expect(n.body).toContain("pong");
    expect(n.body).toContain("HTTP 503");
  });

  it("keys a failed publish on the publish job, so it neither dedupes against the run's completion nor overwrites an earlier attempt", () => {
    const first = notificationFromPush(publishFailed);
    const second = notificationFromPush({
      ...publishFailed,
      jobId: "publish-10",
    });
    expect(first.id).not.toBe(notificationFromPush(base).id);
    expect(first.id).not.toBe(second.id);
  });
});
