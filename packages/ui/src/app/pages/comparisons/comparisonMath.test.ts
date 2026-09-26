import { describe, expect, it } from "vitest";
import type {
  ComparisonArm,
  ComparisonArmResult,
  ComparisonConfig,
  MetricSummary,
} from "@clockwyrks/run-record/comparison";
import {
  armDistributionGroups,
  appendRunIds,
  armTopUps,
  countedRunIds,
  harnessArmLaunchItems,
  isGgArm,
  medianRatio,
  presentedRatio,
  pruneDeadRunIds,
  remainingForArm,
  reportedLiveRunIds,
  toolCallChartData,
  totalMissingRuns,
  withArmRunIds,
} from "./comparisonMath";

function arm(overrides: Partial<ComparisonArm> = {}): ComparisonArm {
  return { id: "arm-1", label: "pi", runIds: [], ...overrides };
}

/** An aggregated arm result: what the arm records, plus which of those runs the
 *  backend found still exist. */
function result(
  armOverrides: Partial<ComparisonArm> = {},
  resultOverrides: Partial<ComparisonArmResult> = {},
): ComparisonArmResult {
  return {
    arm: arm(armOverrides),
    nDesired: 3,
    nObserved: 0,
    diagnostics: {},
    ...resultOverrides,
  } as ComparisonArmResult;
}

// The field has three states and the third is not the second — an absent field
// means the backend never reported liveness (it predates the field), NOT that
// nothing is live. Conflating them relaunches whole experiments and prunes every
// stored run id out of the config.
describe("reportedLiveRunIds / countedRunIds", () => {
  it("reports the arm's still-existing runs when the backend sent them", () => {
    const r = result({ runIds: ["a", "b", "c"] }, { liveRunIds: ["a", "b"] });
    expect(reportedLiveRunIds(r)).toEqual(["a", "b"]);
    expect(countedRunIds(r)).toEqual(["a", "b"]);
  });

  it("trusts a reported empty array as 'none of them are live'", () => {
    // A current backend always serializes the field, so `[]` is a positive
    // statement: the arm's three recorded runs are all gone.
    const r = result({ runIds: ["a", "b", "c"] }, { liveRunIds: [] });
    expect(reportedLiveRunIds(r)).toEqual([]);
    expect(countedRunIds(r)).toEqual([]);
  });

  it("reads an absent field as 'not reported', falling back to the arm's own ids", () => {
    // A backend older than the field sends no key at all. Reading that as "none
    // live" would wipe the arm out; instead it counts what it recorded, exactly
    // as the page did before liveness existed.
    const r = result({ runIds: ["a", "b", "c"] });
    expect(reportedLiveRunIds(r)).toBeUndefined();
    expect(countedRunIds(r)).toEqual(["a", "b", "c"]);
  });

  it("falls back to none for an unreported arm that has launched nothing", () => {
    expect(countedRunIds(result())).toEqual([]);
  });
});

describe("remainingForArm", () => {
  it("is N minus the arm's runs that still exist", () => {
    expect(
      remainingForArm(
        5,
        result({ runIds: ["a", "b"] }, { liveRunIds: ["a", "b"] }),
      ),
    ).toBe(3);
  });

  it("never goes negative once an arm has met or exceeded N", () => {
    expect(
      remainingForArm(
        2,
        result({ runIds: ["a", "b", "c"] }, { liveRunIds: ["a", "b", "c"] }),
      ),
    ).toBe(0);
  });

  it("offers an arm's runs again once they are deleted — the whole reason live ids exist", () => {
    // The arm still records three launches; the backend reports none of them are
    // there any more. Counting `runIds` would leave this arm believing itself
    // full forever.
    expect(
      remainingForArm(
        3,
        result({ runIds: ["a", "b", "c"] }, { liveRunIds: [] }),
      ),
    ).toBe(3);
  });

  it("counts an unreported arm's own recorded ids rather than offering to relaunch it", () => {
    // No `liveRunIds` key at all (a backend older than the field). Treating that
    // as "none live" would offer to relaunch the entire arm; the arm records
    // three launches and wants three, so there is nothing to trigger.
    expect(remainingForArm(3, result({ runIds: ["a", "b", "c"] }))).toBe(0);
    expect(remainingForArm(5, result({ runIds: ["a", "b", "c"] }))).toBe(2);
  });

  it("counts a run that is still in flight, so nothing is launched twice", () => {
    // Two runs exist (queued or running) but neither record has landed, so
    // `nObserved` is 0. Topping up against that would double the arm.
    expect(
      remainingForArm(
        3,
        result(
          { runIds: ["a", "b"] },
          { liveRunIds: ["a", "b"], nObserved: 0 },
        ),
      ),
    ).toBe(1);
  });
});

describe("pruneDeadRunIds", () => {
  const config = (arms: ComparisonArm[]): ComparisonConfig => ({
    controls: {
      caseSlug: "carom",
      version: "v1.0.0",
      variant: "base",
      orchestratorSlug: "one-shot",
      engineSlug: "none",
    },
    arms,
    n: 3,
  });

  it("drops the ids whose runs no longer exist, keeping launch order", () => {
    const next = pruneDeadRunIds(
      config([arm({ id: "a", runIds: ["r1", "r2", "r3"] })]),
      [result({ id: "a" }, { liveRunIds: ["r3", "r1"] })],
    );
    expect(next.arms[0]!.runIds).toEqual(["r1", "r3"]);
  });

  it("empties an arm the backend reports no live runs for", () => {
    const next = pruneDeadRunIds(
      config([arm({ id: "a", runIds: ["r1", "r2"] })]),
      [result({ id: "a" }, { liveRunIds: [] })],
    );
    expect(next.arms[0]!.runIds).toEqual([]);
  });

  it("never prunes an arm whose result reports no liveness at all", () => {
    // The load-bearing case: against a backend that does not send the field, the
    // pruned config is what gets PUT back — clearing `runIds` here would destroy
    // the record of which runs belong to which arm, permanently.
    const before = config([arm({ id: "a", runIds: ["r1", "r2"] })]);
    const next = pruneDeadRunIds(before, [result({ id: "a" })]);
    expect(next.arms[0]!.runIds).toEqual(["r1", "r2"]);
    // Untouched, not rebuilt — nothing about this arm changed.
    expect(next.arms[0]).toBe(before.arms[0]);
  });

  it("leaves an arm alone when every recorded run still exists", () => {
    const before = config([arm({ id: "a", runIds: ["r1"] })]);
    const next = pruneDeadRunIds(before, [
      result({ id: "a" }, { liveRunIds: ["r1"] }),
    ]);
    expect(next.arms[0]).toBe(before.arms[0]);
  });

  it("leaves an arm the aggregation reported nothing for untouched", () => {
    const before = config([arm({ id: "a", runIds: ["r1"] })]);
    expect(pruneDeadRunIds(before, []).arms[0]!.runIds).toEqual(["r1"]);
  });
});

describe("armTopUps / totalMissingRuns", () => {
  const config: ComparisonConfig = {
    controls: {
      caseSlug: "carom",
      version: "v1.0.0",
      variant: "base",
      orchestratorSlug: "one-shot",
      engineSlug: "none",
    },
    arms: [
      arm({ id: "a", runIds: ["r1", "r2"] }),
      arm({ id: "b", runIds: ["r3"] }),
    ],
    n: 2,
  };

  it("counts each arm against the runs it still has", () => {
    // Arm a's two runs were deleted (reported as none live); arm b's one run
    // survives.
    const results = [
      result({ id: "a", runIds: ["r1", "r2"] }, { liveRunIds: [] }),
      result({ id: "b", runIds: ["r3"] }, { liveRunIds: ["r3"] }),
    ];
    const tops = armTopUps(config, results);
    expect(tops.map((t) => [t.arm.id, t.remaining])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
    expect(totalMissingRuns(config, results)).toBe(3);
  });

  it("reads an unreported arm's launches off the stored config, not the echoed arm", () => {
    // The aggregation echoes a trimmed arm (no `runIds` on it at all). The config
    // is the authority on what the arm has launched — it is what gets written
    // back — so an unreported arm must be counted off the config, or the page
    // offers to relaunch runs the config plainly records.
    const echoed = [
      { ...result({ id: "a" }), arm: { id: "a", label: "pi" } },
      { ...result({ id: "b" }), arm: { id: "b", label: "gg" } },
    ] as unknown as ComparisonArmResult[];
    expect(armTopUps(config, echoed).map((t) => t.remaining)).toEqual([0, 1]);
  });

  it("offers nothing for a full comparison no arm of which reports liveness", () => {
    // Every arm is at `N` by its own record and the backend sent no liveness for
    // any of them: "Trigger missing runs" must offer 0, not the whole experiment.
    const results = [
      result({ id: "a", runIds: ["r1", "r2"] }),
      result({ id: "b", runIds: ["r3"] }),
    ];
    expect(armTopUps(config, results).map((t) => t.remaining)).toEqual([0, 1]);
    expect(totalMissingRuns(config, results)).toBe(1);
  });

  it("falls back to an arm's own recorded ids when no result carries it", () => {
    // Never expected (the backend computes one result per arm) — but the safe
    // direction is under-launching, not double-launching.
    expect(armTopUps(config, []).map((t) => t.remaining)).toEqual([0, 1]);
  });
});

describe("isGgArm", () => {
  it("is true only for an arm that names a gg configuration", () => {
    expect(isGgArm(arm({ ggConfigId: "builtin:default" }))).toBe(true);
    expect(isGgArm(arm({ harnessSlug: "pi", modelId: "gpt-5" }))).toBe(false);
  });
});

describe("harnessArmLaunchItems", () => {
  const controls = { caseSlug: "carom", version: "v1.0.0", variant: "base" };

  it("builds exactly `count` items for the arm's own harness and model", () => {
    const items = harnessArmLaunchItems(
      controls,
      arm({ harnessSlug: "pi", modelId: "claude-opus-4-8" }),
      3,
    );
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.config.harness).toBe("pi");
      expect(item.config.testCase).toBe("carom");
      expect(item.config.version).toBe("v1.0.0");
      expect(item.config.variant).toBe("base");
      expect(item.track.harnessSlug).toBe("pi");
      expect(item.track.modelId).toBe("claude-opus-4-8");
    }
  });

  it("carries the comparison's engine onto every launch and its tracked row", () => {
    const items = harnessArmLaunchItems(
      { ...controls, engineSlug: "simple-2d" },
      arm({ harnessSlug: "pi", modelId: "claude-opus-4-8" }),
      2,
    );
    for (const item of items) {
      expect(item.config.engine).toBe("simple-2d");
      expect(item.track.engine).toBe("simple-2d");
    }
  });

  it("resolves an absent engine to the engineless run rather than omitting it", () => {
    const items = harnessArmLaunchItems(
      controls,
      arm({ harnessSlug: "pi", modelId: "claude-opus-4-8" }),
      1,
    );
    expect(items[0]!.config.engine).toBe("none");
  });

  it("gives each arm its own model, since the model is per configuration", () => {
    const a = harnessArmLaunchItems(
      controls,
      arm({ harnessSlug: "pi", modelId: "claude-opus-4-8" }),
      1,
    );
    const b = harnessArmLaunchItems(
      controls,
      arm({ id: "arm-2", harnessSlug: "pi", modelId: "gpt-5" }),
      1,
    );
    expect(a[0]!.track.modelId).toBe("claude-opus-4-8");
    expect(b[0]!.track.modelId).toBe("gpt-5");
  });

  it("prefixes the model id for an OpenRouter-routed harness (kilo)", () => {
    const items = harnessArmLaunchItems(
      controls,
      arm({ harnessSlug: "kilo", modelId: "claude-opus-4-8" }),
      1,
    );
    expect(items[0]!.config.modelId).toBe("openrouter/claude-opus-4-8");
    // The tracked identity keeps the raw (unprefixed) model id, matching the
    // new-run form's convention.
    expect(items[0]!.track.modelId).toBe("claude-opus-4-8");
  });

  it("produces nothing for a non-positive count, a harness-less arm, or a model-less arm", () => {
    expect(
      harnessArmLaunchItems(
        controls,
        arm({ harnessSlug: "pi", modelId: "gpt-5" }),
        0,
      ),
    ).toEqual([]);
    expect(
      harnessArmLaunchItems(controls, arm({ modelId: "gpt-5" }), 2),
    ).toEqual([]);
    expect(
      harnessArmLaunchItems(controls, arm({ harnessSlug: "pi" }), 2),
    ).toEqual([]);
  });

  it("produces nothing for a gg arm — those launch through gg's own endpoint", () => {
    expect(
      harnessArmLaunchItems(
        controls,
        arm({
          ggConfigId: "builtin:default",
          ggSlotModels: { primary: "anthropic/claude-opus-4.8" },
        }),
        2,
      ),
    ).toEqual([]);
  });
});

describe("appendRunIds", () => {
  it("appends every successful result's run id in order", () => {
    expect(
      appendRunIds(
        ["r0"],
        [{ runId: "r1" }, { error: "boom" }, { runId: "r2" }],
      ),
    ).toEqual(["r0", "r1", "r2"]);
  });

  it("skips a duplicate id rather than recording it twice", () => {
    expect(appendRunIds(["r0"], [{ runId: "r0" }, { runId: "r1" }])).toEqual([
      "r0",
      "r1",
    ]);
  });

  it("treats a missing existing list as empty", () => {
    expect(appendRunIds(undefined, [{ runId: "r1" }])).toEqual(["r1"]);
  });

  it("drops every failed launch", () => {
    expect(appendRunIds([], [{ error: "a" }, { error: "b" }])).toEqual([]);
  });
});

describe("withArmRunIds", () => {
  const config: ComparisonConfig = {
    controls: {
      caseSlug: "carom",
      version: "v1.0.0",
      variant: "base",
      orchestratorSlug: "one-shot",
      engineSlug: "none",
    },
    arms: [
      {
        id: "a",
        label: "pi",
        harnessSlug: "pi",
        modelId: "claude-opus-4-8",
        runIds: ["r1"],
      },
      {
        id: "b",
        label: "gg — config A",
        ggConfigId: "builtin:default",
        ggSlotModels: { primary: "anthropic/claude-opus-4.8" },
        runIds: [],
      },
    ],
    n: 3,
  };

  it("replaces only the named arm's runIds", () => {
    const next = withArmRunIds(config, "b", ["r2", "r3"]);
    expect(next.arms.find((a) => a.id === "b")?.runIds).toEqual(["r2", "r3"]);
    // The untouched arm (and every other field) is unchanged.
    expect(next.arms.find((a) => a.id === "a")?.runIds).toEqual(["r1"]);
    expect(next.n).toBe(3);
  });

  it("is a no-op for an unknown arm id", () => {
    const next = withArmRunIds(config, "does-not-exist", ["r9"]);
    expect(next.arms).toEqual(config.arms);
  });
});

describe("medianRatio", () => {
  it("divides the two medians", () => {
    expect(medianRatio(3.7, 0.53)).toBeCloseTo(6.98, 1);
  });

  it("is NaN rather than Infinity when the denominator is zero", () => {
    expect(Number.isNaN(medianRatio(5, 0))).toBe(true);
  });
});

/** A metric summary with the given median; the rest of its spread is fixed. */
function summary(median: number): MetricSummary {
  return {
    n: 3,
    median,
    mean: median + 1,
    min: median - 1,
    max: median + 2,
    q1: median - 0.5,
    q3: median + 0.5,
    iqr: 1,
    ciLow: median - 0.25,
    ciHigh: median + 0.25,
  } as MetricSummary;
}

describe("armDistributionGroups", () => {
  it("draws each arm's session durations and leaves out an arm with none", () => {
    const arms = [
      result({ id: "a", label: "pi" }, { sessionDuration: summary(120) }),
      // Every run of this arm predates the stage durations.
      result({ id: "b", label: "kilo" }, { cost: summary(1) }),
      result({ id: "c", label: "gg" }, { sessionDuration: summary(60) }),
    ];
    const groups = armDistributionGroups(
      arms,
      "sessionDuration",
      new Map([
        ["a", "red"],
        ["c", "blue"],
      ]),
    );
    expect(groups.map((g) => [g.label, g.color, g.median, g.mean])).toEqual([
      ["pi", "red", 120, 121],
      ["gg", "blue", 60, 61],
    ]);
    expect(groups[0]).toMatchObject({ ciLow: 119.75, ciHigh: 120.25, n: 3 });
  });
});

describe("presentedRatio", () => {
  it("orders session duration on its own, independent of cost", () => {
    // pi is the cheaper arm but the slower one.
    const arms = [
      result(
        { id: "a", label: "pi" },
        { cost: summary(1), sessionDuration: summary(300) },
      ),
      result(
        { id: "b", label: "kilo" },
        { cost: summary(4), sessionDuration: summary(100) },
      ),
    ];
    const cost = presentedRatio(arms, "cost")!;
    expect([cost.higher.arm.label, cost.lower.arm.label]).toEqual([
      "kilo",
      "pi",
    ]);
    expect(cost.ratio).toBeCloseTo(4);
    const session = presentedRatio(arms, "sessionDuration")!;
    expect([session.higher.arm.label, session.lower.arm.label]).toEqual([
      "pi",
      "kilo",
    ]);
    expect(session.ratio).toBeCloseTo(3);
  });

  it("is null unless both of exactly two arms have the metric", () => {
    const measured = result({ id: "a" }, { sessionDuration: summary(90) });
    const unmeasured = result({ id: "b" }, { cost: summary(1) });
    expect(
      presentedRatio([measured, unmeasured], "sessionDuration"),
    ).toBeNull();
    expect(presentedRatio([measured], "sessionDuration")).toBeNull();
    expect(
      presentedRatio([measured, measured, measured], "sessionDuration"),
    ).toBeNull();
  });

  it("is null when the lower median is zero", () => {
    const arms = [
      result({ id: "a" }, { sessionDuration: summary(90) }),
      result({ id: "b" }, { sessionDuration: summary(0) }),
    ];
    expect(presentedRatio(arms, "sessionDuration")).toBeNull();
  });
});

describe("toolCallChartData", () => {
  it("keeps every distinct tool as its own series when under the cap", () => {
    const { segments, series } = toolCallChartData([
      { armLabel: "pi", toolCalls: { read: 10, write: 4 } },
      { armLabel: "kilo", toolCalls: { read: 2, todowrite: 53 } },
    ]);
    expect(series.map((s) => s.name).sort()).toEqual(
      ["read", "todowrite", "write"].sort(),
    );
    // Every non-zero (arm, tool) pair is its own segment; a tool an arm never
    // called gets no segment for that arm.
    expect(segments).toHaveLength(4);
    expect(
      segments.find((s) => s.group === "kilo" && s.series === "todowrite")
        ?.value,
    ).toBe(53);
  });

  it("folds tools past the series cap into a trailing 'other', ranked by total across every arm", () => {
    const arms = [
      {
        armLabel: "pi",
        toolCalls: {
          a: 100,
          b: 90,
          c: 80,
          d: 70,
          e: 60,
          f: 50,
          g: 1, // the 7th tool — pushed into "other" even though every arm has one
        },
      },
    ];
    const { series, segments } = toolCallChartData(arms);
    expect(series.map((s) => s.name)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "other",
    ]);
    expect(segments.find((s) => s.series === "other")?.value).toBe(1);
  });

  it("assigns colors from the fixed categorical list, in series order", () => {
    const { series } = toolCallChartData([
      { armLabel: "pi", toolCalls: { read: 1, write: 1 } },
    ]);
    // Two distinct series get two distinct colors.
    expect(new Set(series.map((s) => s.color)).size).toBe(series.length);
  });
});
