import { describe, expect, it } from "vitest";
import type {
  ComparisonArm,
  ComparisonConfig,
} from "@clockwyrks/run-record/comparison";
import {
  appendRunIds,
  harnessArmLaunchItems,
  isGgArm,
  medianRatio,
  remainingForArm,
  toolCallChartData,
  withArmRunIds,
} from "./comparisonMath";

function arm(overrides: Partial<ComparisonArm> = {}): ComparisonArm {
  return { id: "arm-1", label: "pi", runIds: [], ...overrides };
}

describe("remainingForArm", () => {
  it("is N minus the arm's already-recorded run ids", () => {
    expect(remainingForArm(5, arm({ runIds: ["a", "b"] }))).toBe(3);
  });

  it("never goes negative once an arm has met or exceeded N", () => {
    expect(remainingForArm(2, arm({ runIds: ["a", "b", "c"] }))).toBe(0);
  });

  it("treats a missing runIds array as zero already launched", () => {
    expect(remainingForArm(3, arm({ runIds: undefined }))).toBe(3);
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
