import { describe, expect, it } from "vitest";
import type { ArtifactStorageStatus } from "@clockwyrks/run-record/jobs-api";
import {
  formatGib,
  storageHoldReason,
  storingRunNotice,
  storageNotice,
  worstStorageNotice,
} from "./artifactStorage";

const GIB = 1024 ** 3;

function status(
  overrides: Partial<ArtifactStorageStatus> = {},
): ArtifactStorageStatus {
  return {
    state: "ok",
    runsOnHold: false,
    runsWaitingToStore: 0,
    freeBytes: 10 * GIB,
    totalBytes: 20 * GIB,
    warnBytes: 3 * GIB,
    stopBytes: 2 * GIB,
    ...overrides,
  };
}

describe("formatGib", () => {
  it("drops a trailing zero and keeps one decimal otherwise", () => {
    expect(formatGib(3 * GIB)).toBe("3 GiB");
    expect(formatGib(2.5 * GIB)).toBe("2.5 GiB");
    expect(formatGib(0)).toBe("0 GiB");
  });
});

describe("storageNotice", () => {
  it("says nothing while the store has room or is not watched", () => {
    expect(storageNotice(status())).toBeNull();
    expect(storageNotice(status({ state: "unmonitored" }))).toBeNull();
    expect(storageNotice(null)).toBeNull();
    expect(storageNotice(undefined)).toBeNull();
  });

  it("warns while storage is low, quoting both thresholds", () => {
    const notice = storageNotice(status({ state: "low" }));
    expect(notice).toEqual({
      tone: "warn",
      title: "Artifact storage is running low",
      detail: "Less than 3 GiB is free. New runs go on hold under 2 GiB.",
    });
  });

  it("states the hold while storage is full", () => {
    const notice = storageNotice(
      status({ state: "blocked", runsOnHold: true }),
    );
    expect(notice?.tone).toBe("hold");
    expect(notice?.title).toBe(
      "New runs are on hold: artifact storage is full",
    );
    expect(notice?.detail).toContain("Less than 2 GiB is free");
    expect(notice?.detail).toContain("Queued runs start once space is freed");
  });

  it("quotes the thresholds the backend is configured with", () => {
    const configured = { warnBytes: 8 * GIB, stopBytes: 4.5 * GIB };
    expect(storageNotice(status({ state: "low", ...configured }))?.detail).toBe(
      "Less than 8 GiB is free. New runs go on hold under 4.5 GiB.",
    );
  });

  it("names an unwritable store and the error its write check reported", () => {
    const notice = storageNotice(
      status({
        state: "unwritable",
        runsOnHold: true,
        holdReason: "unwritable",
        detail: "Read-only file system (os error 30)",
      }),
    );
    expect(notice?.tone).toBe("hold");
    expect(notice?.title).toBe(
      "New runs are on hold: the artifact store cannot be written to",
    );
    expect(notice?.detail).toContain(
      "Reported: Read-only file system (os error 30)",
    );
    expect(notice?.detail).toContain("Publishing is unaffected");
  });

  it("counts the finished runs waiting to store their artifacts", () => {
    const one = storageNotice(
      status({
        runsOnHold: true,
        holdReason: "uploads-waiting",
        runsWaitingToStore: 1,
        detail: "artifact service returned HTTP 503",
      }),
    );
    expect(one?.title).toBe(
      "New runs are on hold: finished runs are waiting to store their artifacts",
    );
    expect(one?.detail).toContain("1 finished run is retrying an upload");
    expect(one?.detail).toContain(
      "Reported: artifact service returned HTTP 503",
    );

    const three = storageNotice(
      status({
        runsOnHold: true,
        holdReason: "uploads-waiting",
        runsWaitingToStore: 3,
      }),
    );
    expect(three?.detail).toContain("3 finished runs are retrying an upload");
    expect(three?.detail).not.toContain("Reported:");
  });

  it("adds the waiting runs to a hold another condition leads", () => {
    const notice = storageNotice(
      status({
        state: "blocked",
        runsOnHold: true,
        holdReason: "low-space",
        runsWaitingToStore: 2,
      }),
    );
    expect(notice?.title).toBe(
      "New runs are on hold: artifact storage is full",
    );
    expect(notice?.detail).toContain(
      "2 finished runs are waiting to store their artifacts.",
    );
  });

  it("says the store is being checked once the last waiting run is gone", () => {
    const notice = storageNotice(
      status({ runsOnHold: true, holdReason: "write-check-pending" }),
    );
    expect(notice?.tone).toBe("hold");
    expect(notice?.title).toBe(
      "New runs are on hold: the artifact store is being checked after failed uploads",
    );
  });

  it("says runs start one at a time while the store is being proved", () => {
    const notice = storageNotice(
      status({
        runsOnHold: true,
        holdReason: "proving-store",
        detail: "HTTP 502: verifying the job token with the backend",
      }),
    );
    expect(notice?.tone).toBe("hold");
    expect(notice?.title).toBe(
      "New runs start one at a time: an upload failed and the artifact store has not stored a run since",
    );
    expect(notice?.detail).toContain("once a run's artifacts have been stored");
    expect(notice?.detail).toContain(
      "Reported: HTTP 502: verifying the job token with the backend",
    );
    // The held run's tooltip states the same reason.
    expect(
      storageHoldReason(
        status({ runsOnHold: true, holdReason: "proving-store" }),
      ),
    ).toBe(notice?.title);
  });

  it("says that publishing is failing, with the count and the latest error", () => {
    const held = status({
      runsOnHold: true,
      holdReason: "publish-failing",
      publishFailingRuns: 5,
      detail: "gh: HTTP 502",
    });
    const notice = storageNotice(held);
    expect(notice).toEqual({
      tone: "hold",
      title: "New runs are on hold: publishing is failing",
      detail:
        "5 runs in a row could not be published, and an unpublished run keeps its artifacts on the store. Publishing is retried automatically, and queued runs start once a publish succeeds. Reported: gh: HTTP 502",
    });
    // The other holds say publishing is unaffected. This one must not.
    expect(notice?.detail).not.toContain("Publishing is unaffected");
    // The held run's tooltip states the same reason.
    expect(storageHoldReason(held)).toBe(notice?.title);
  });

  it("reports failing publishes with no artifact service configured", () => {
    const notice = storageNotice(
      status({
        state: "unmonitored",
        runsOnHold: true,
        holdReason: "publish-failing",
        freeBytes: undefined,
        totalBytes: undefined,
      }),
    );
    expect(notice?.tone).toBe("hold");
    expect(notice?.title).toBe("New runs are on hold: publishing is failing");
    // A backend that sends no count still reads as a sentence.
    expect(notice?.detail).toMatch(/^Several runs in a row could not/);
  });

  it("names the backend's own storage when the state volume holds the queue", () => {
    // The artifact store reads fine: the hold is not about it.
    const held = status({
      runsOnHold: true,
      holdReason: "state-low-space",
      stateVolume: {
        level: "blocked",
        freeBytes: GIB,
        totalBytes: 16 * GIB,
        warnBytes: 3 * GIB,
        stopBytes: 1.5 * GIB,
      },
    });
    const notice = storageNotice(held);
    expect(notice).toEqual({
      tone: "hold",
      title: "New runs are on hold: the backend's own storage is nearly full",
      detail:
        "Less than 1.5 GiB is free on the backend's state volume, which is separate from artifact storage and takes every run's files before they are published. Queued runs start once space is freed there, which the backend does itself as published runs are confirmed in the bucket. Publishing is unaffected.",
    });
    // It must not read as the artifact store's hold.
    expect(notice?.title).not.toContain("artifact");
    expect(storageHoldReason(held)).toBe(notice?.title);

    // A status with the reason and no figures still reads as a sentence.
    expect(
      storageNotice(status({ runsOnHold: true, holdReason: "state-low-space" }))
        ?.detail,
    ).toMatch(/^Too little is free on the backend's state volume/);
  });

  it("warns that the backend's storage is running low when nothing else applies", () => {
    const stateVolume = {
      level: "low" as const,
      freeBytes: 2 * GIB,
      totalBytes: 16 * GIB,
      warnBytes: 3 * GIB,
      stopBytes: 1.5 * GIB,
    };
    expect(storageNotice(status({ stateVolume }))).toEqual({
      tone: "warn",
      title: "Backend storage is running low",
      detail:
        "Less than 3 GiB is free on the backend's state volume, which is separate from artifact storage. New runs go on hold under 1.5 GiB.",
    });
    // With the hold turned off there is no threshold to quote.
    expect(
      storageNotice(status({ stateVolume: { ...stateVolume, stopBytes: 0 } }))
        ?.detail,
    ).toBe(
      "Less than 3 GiB is free on the backend's state volume, which is separate from artifact storage.",
    );
    // It is advisory: no run is held by it.
    expect(storageHoldReason(status({ stateVolume }))).toBeNull();
    // The artifact store's own warning and any hold are shown in its place.
    expect(storageNotice(status({ state: "low", stateVolume }))?.title).toBe(
      "Artifact storage is running low",
    );
    expect(
      storageNotice(
        status({
          runsOnHold: true,
          holdReason: "publish-failing",
          stateVolume,
        }),
      )?.title,
    ).toBe("New runs are on hold: publishing is failing");
    // A volume that reads fine, or could not be read, calls for no notice.
    for (const level of ["ok", "unreadable"] as const) {
      expect(
        storageNotice(status({ stateVolume: { ...stateVolume, level } })),
      ).toBeNull();
    }
  });

  it("reads a hold from the state when the backend names no reason", () => {
    // What a backend older than `holdReason` sends.
    expect(
      storageNotice(status({ state: "blocked", runsOnHold: true }))?.title,
    ).toBe("New runs are on hold: artifact storage is full");
  });

  it("says nothing about an unreachable service that holds no run", () => {
    expect(storageNotice(status({ state: "unavailable" }))).toBeNull();

    const held = storageNotice(
      status({
        state: "unavailable",
        runsOnHold: true,
        freeBytes: undefined,
        totalBytes: undefined,
      }),
    );
    expect(held?.tone).toBe("hold");
    expect(held?.title).toBe(
      "New runs are on hold: the artifact service cannot be reached",
    );
  });
});

describe("storageHoldReason", () => {
  it("names the reason only while runs are held", () => {
    expect(storageHoldReason(status())).toBeNull();
    expect(storageHoldReason(status({ state: "low" }))).toBeNull();
    expect(storageHoldReason(null)).toBeNull();
    expect(
      storageHoldReason(status({ state: "blocked", runsOnHold: true })),
    ).toBe("New runs are on hold: artifact storage is full");
  });
});

describe("worstStorageNotice", () => {
  it("puts a hold ahead of a warning, whatever the order", () => {
    const low = status({ state: "low" });
    const blocked = status({ state: "blocked", runsOnHold: true });
    expect(worstStorageNotice([low, blocked])?.tone).toBe("hold");
    expect(worstStorageNotice([blocked, low])?.tone).toBe("hold");
    expect(worstStorageNotice([status(), low])?.tone).toBe("warn");
    expect(worstStorageNotice([status()])).toBeNull();
    expect(worstStorageNotice([])).toBeNull();
  });
});

describe("storingRunNotice", () => {
  it("says nothing for a run in any other phase", () => {
    expect(storingRunNotice(undefined)).toBeNull();
    expect(storingRunNotice({ state: "running" })).toBeNull();
    expect(
      storingRunNotice({ state: "running", detail: "a stale reason" }),
    ).toBeNull();
  });

  it("says the run has finished and why it is waiting", () => {
    const notice = storingRunNotice({
      state: "storing",
      detail: "the artifact service rejected the upload: HTTP 500",
    });
    expect(notice).toContain("The run has finished");
    expect(notice).toContain("new runs are on hold");
    expect(notice).toContain(
      "Reported: the artifact service rejected the upload: HTTP 500",
    );
  });

  it("stands without a reason", () => {
    const notice = storingRunNotice({ state: "storing", detail: null });
    expect(notice).toContain("waiting to store its artifacts");
    expect(notice).not.toContain("Reported:");
  });
});
