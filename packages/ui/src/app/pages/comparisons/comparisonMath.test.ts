import { describe, expect, it } from "vitest";
import type {
  ComparisonArm,
  ComparisonArmResult,
  ComparisonConfig,
  MetricSummary,
} from "@clockwyrks/run-record/comparison";
import {
  armDistributionGroups,
  armTopUps,
  harnessArmLaunchItems,
  isGgArm,
  medianRatio,
  presentedRatio,
  remainingForArm,
  runsInFlight,
  toolCallChartData,
  totalMissingRuns,
} from "./comparisonMath";

function arm(overrides: Partial<ComparisonArm> = {}): ComparisonArm {
  return { id: "arm-1", label: "pi", ...overrides };
}

/** An aggregated arm result: the runs the arm holds and its jobs in flight. */
function result(
  armOverrides: Partial<ComparisonArm> = {},
  resultOverrides: Partial<ComparisonArmResult> = {},
): ComparisonArmResult {
  return {
    arm: arm(armOverrides),
    nDesired: 3,
    runIds: [],
    inFlight: 0,
    nObserved: 0,
    diagnostics: {},
    ...resultOverrides,
  } as ComparisonArmResult;
}

describe("remainingForArm", () => {
  it("is N less the runs the arm holds and its jobs in flight", () => {
    expect(remainingForArm(3, result({}, { runIds: ["r1"] }))).toBe(2);
    expect(
      remainingForArm(3, result({}, { runIds: ["r1"], inFlight: 1 })),
    ).toBe(1);
  });

  it("never goes negative once an arm has met N", () => {
    expect(
      remainingForArm(2, result({}, { runIds: ["r1", "r2"], inFlight: 0 })),
    ).toBe(0);
  });

  it("offers nothing for an arm the backend reports unlaunchable", () => {
    const drifted = result({}, { unlaunchable: "edited since it was saved" });
    expect(remainingForArm(3, drifted)).toBe(0);
  });

  it("offers nothing for a result that reports no held runs at all", () => {
    const unreported = result({}, { runIds: undefined });
    expect(remainingForArm(3, unreported)).toBe(0);
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
    arms: [arm({ id: "a" }), arm({ id: "b" })],
    n: 2,
  };

  it("counts each arm against the runs it holds and has in flight", () => {
    const results = [
      result({ id: "a" }, { runIds: [], inFlight: 1 }),
      result({ id: "b" }, { runIds: ["r3"] }),
    ];
    expect(armTopUps(config, results).map((t) => t.remaining)).toEqual([1, 1]);
    expect(totalMissingRuns(config, results)).toBe(2);
  });

  it("offers nothing for an arm no result carries", () => {
    expect(armTopUps(config, []).map((t) => t.remaining)).toEqual([0, 0]);
  });
});

describe("runsInFlight", () => {
  it("sums every arm's jobs in flight", () => {
    const results = [
      result({ id: "a" }, { inFlight: 2 }),
      result({ id: "b" }, { inFlight: 1 }),
    ];
    expect(runsInFlight(results)).toBe(3);
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

  it("draws each run that reported the metric as a point linking to its run", () => {
    const arm = {
      ...result({ id: "a", label: "pi" }, { cost: summary(1) }),
      runPoints: [
        { runId: "r1", cost: 0.5, sessionSeconds: 90 },
        // A run whose cost was never reported has no cost point.
        { runId: "r2", sessionSeconds: 120 },
        { runId: "r3", cost: 1.5 },
      ],
    };
    const [group] = armDistributionGroups([arm], "cost", new Map());
    expect(group!.points).toEqual([
      { runId: "r1", value: 0.5, href: "/runs/r1" },
      { runId: "r3", value: 1.5, href: "/runs/r3" },
    ]);
  });

  it("draws boxes without points for a result that carries no run points", () => {
    const [group] = armDistributionGroups(
      [result({ id: "a", label: "pi" }, { cost: summary(1) })],
      "cost",
      new Map(),
    );
    expect(group!.points).toEqual([]);
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
