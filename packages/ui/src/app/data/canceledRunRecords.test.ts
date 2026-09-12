import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitCanceledRunRecords } from "./canceledRunRecords";

// A backend that hands each named run its partial record only after the given
// number of reads — the driver noticing the cancel, stopping the harness,
// draining telemetry and posting the record back.
function reader(landAfter: Record<string, number>) {
  const reads: Record<string, number> = {};
  const getRun = vi.fn(async (runId: string) => {
    reads[runId] = (reads[runId] ?? 0) + 1;
    const needed = landAfter[runId] ?? 1;
    return { record: reads[runId] >= needed ? { id: runId } : null };
  });
  return { getRun, reads };
}

// Run the watcher to completion on fake timers: every `setTimeout` it waits on is
// advanced as soon as it is scheduled, so a five-minute budget costs no real time.
async function drain(promise: Promise<void>): Promise<void> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  for (let tick = 0; tick < 10_000 && !settled; tick += 1) {
    await vi.advanceTimersByTimeAsync(15_000);
  }
  await promise;
}

describe("awaitCanceledRunRecords", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Why the wait exists at all: every refresh fired at cancel time is premature,
  // because the backend marks the job canceled immediately and the record lands
  // seconds later.
  it("refreshes once the record lands, not when the cancel returns", async () => {
    const { getRun } = reader({ "run-a": 3 });
    const onLanded = vi.fn();

    await drain(awaitCanceledRunRecords({ getRun }, ["run-a"], onLanded));

    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(getRun).toHaveBeenCalledTimes(3);
  });

  // A sweep cancels dozens of runs at once; forty refreshes for forty records
  // would re-query every listing forty times.
  it("coalesces a batch into one refresh per pass", async () => {
    const { getRun } = reader({ "run-a": 1, "run-b": 1, "run-c": 1 });
    const onLanded = vi.fn();

    await drain(
      awaitCanceledRunRecords(
        { getRun },
        ["run-a", "run-b", "run-c"],
        onLanded,
      ),
    );

    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  // A read that fails is "not yet", never an error: the cancel itself already
  // succeeded, and this is a courtesy refresh.
  it("keeps waiting through a failed read", async () => {
    const getRun = vi
      .fn<(id: string) => Promise<{ record: unknown }>>()
      .mockRejectedValueOnce(new Error("gateway"))
      .mockResolvedValue({ record: { id: "run-a" } });
    const onLanded = vi.fn();

    await drain(awaitCanceledRunRecords({ getRun }, ["run-a"], onLanded));

    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  // The old wait returned false and did nothing at all when its budget ran out,
  // so a refresh that merely raced the insert left a stale worklist for the rest
  // of the session — which is why a page reload was the only cure.
  it("refreshes once more rather than giving up silently", async () => {
    const getRun = vi.fn(async () => ({ record: null }));
    const onLanded = vi.fn();

    await drain(awaitCanceledRunRecords({ getRun }, ["run-a"], onLanded));

    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  // Backing off keeps a long wait cheap: a five-minute budget polled once a
  // second would be three hundred requests per canceled run.
  it("backs off rather than polling once a second for the whole budget", async () => {
    const getRun = vi.fn(async () => ({ record: null }));

    await drain(awaitCanceledRunRecords({ getRun }, ["run-a"], () => {}));

    expect(getRun.mock.calls.length).toBeLessThan(40);
  });
});
