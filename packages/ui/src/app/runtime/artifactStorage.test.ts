import { beforeEach, describe, expect, it } from "vitest";
import type { ArtifactStorageStatus } from "@clockwyrks/run-record/jobs-api";
import { selectStorageHoldReason, useArtifactStorage } from "./artifactStorage";

const GIB = 1024 ** 3;

function status(
  overrides: Partial<ArtifactStorageStatus> = {},
): ArtifactStorageStatus {
  return {
    state: "ok",
    runsOnHold: false,
    runsWaitingToStore: 0,
    warnBytes: 3 * GIB,
    stopBytes: 2 * GIB,
    ...overrides,
  };
}

beforeEach(() => {
  useArtifactStorage.setState({ byWorker: {} });
});

describe("artifact storage store", () => {
  it("keeps the latest status of each worker", () => {
    const { setStatus } = useArtifactStorage.getState();
    setStatus("w1", status({ state: "low" }));
    setStatus("w2", status());
    setStatus("w1", status({ state: "blocked", runsOnHold: true }));

    const { byWorker } = useArtifactStorage.getState();
    expect(byWorker.w1?.state).toBe("blocked");
    expect(byWorker.w2?.state).toBe("ok");
  });

  it("forgets a worker that was removed, and only then changes identity", () => {
    const { setStatus, retain } = useArtifactStorage.getState();
    setStatus("w1", status({ state: "low" }));
    setStatus("w2", status());

    const before = useArtifactStorage.getState().byWorker;
    retain(["w1", "w2", "w3"]);
    expect(useArtifactStorage.getState().byWorker).toBe(before);

    retain(["w2"]);
    expect(Object.keys(useArtifactStorage.getState().byWorker)).toEqual(["w2"]);
  });

  it("names a hold reason only while some worker's queue is held", () => {
    const { setStatus } = useArtifactStorage.getState();
    expect(selectStorageHoldReason(useArtifactStorage.getState())).toBeNull();

    setStatus("w1", status({ state: "low" }));
    expect(selectStorageHoldReason(useArtifactStorage.getState())).toBeNull();

    setStatus("w2", status({ state: "blocked", runsOnHold: true }));
    expect(selectStorageHoldReason(useArtifactStorage.getState())).toBe(
      "New runs are on hold: artifact storage is full",
    );
  });
});
