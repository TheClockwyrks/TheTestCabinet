import { describe, expect, it, vi } from "vitest";
import type { BatchLaunchResult, WorkerClient } from "../../../client/clients";
import type {
  InProgressRun,
  LaunchConfig,
  LaunchOrigin,
} from "../../../client/types";
import { launchBatch, type LaunchItem } from "./launchBatch";

// One item's worth of the shape `launchBatch` takes: only the fields it actually
// forwards or tracks under matter here.
function item(model: string): LaunchItem {
  return {
    config: {
      testCase: "carom",
      version: "v1.0.0",
      variant: "base",
      harness: "claude",
      model,
    } as unknown as LaunchConfig,
    track: {
      slug: "carom",
      version: "v1.0.0",
      variant: "base",
      harness: "claude",
      model,
    } as unknown as Omit<InProgressRun, "runId" | "state">,
  };
}

// Captures what the transport was handed, since the origin's whole job is to reach
// the backend — a dropped one is invisible until a halt fails to stop a plan.
function worker(spy: (...args: unknown[]) => void) {
  return {
    client: {
      launchRunBatch: async (
        configs: LaunchConfig[],
        _token?: string | null,
        origin?: LaunchOrigin | null,
      ): Promise<BatchLaunchResult[]> => {
        spy(origin);
        return configs.map((_c, i) => ({ runId: `r${i}` }));
      },
    } as unknown as WorkerClient,
  };
}

describe("launchBatch", () => {
  // A plan's per-cell trigger must land inside that plan's halt scope. Without the
  // origin the jobs carry `job.origin = null` and no amount of pressing Halt reaches
  // them — a plan that visibly refuses to stop.
  it("attributes the whole batch to the plan that asked for it", async () => {
    const spy = vi.fn();
    const results = await launchBatch(worker(spy), "t", vi.fn(), [item("a")], {
      kind: "plan",
      id: "p1",
    });
    expect(spy).toHaveBeenCalledWith({ kind: "plan", id: "p1" });
    expect(results).toEqual([{ runId: "r0" }]);
  });

  // The inverse property, and the reason the parameter is optional: a run launched
  // by hand from the new-run form belongs to nobody's plan and must stay outside
  // every scoped halt.
  it("leaves a hand-launched batch unattributed", async () => {
    const spy = vi.fn();
    await launchBatch(worker(spy), "t", vi.fn(), [item("a"), item("b")]);
    expect(spy).toHaveBeenCalledWith(undefined);
  });
});
