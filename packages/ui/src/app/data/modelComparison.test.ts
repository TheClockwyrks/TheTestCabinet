import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { describe, expect, it } from "vitest";
import {
  meanReported,
  modelCaseOptions,
  runIsModel,
  standInField,
} from "./modelComparison";

// A summary card carrying the fields this module reads. Everything else is
// irrelevant here, so the fixture stays to the subject, the case name, the
// metrics, and the start time the case picker orders on.
function run(overrides: {
  id?: string;
  modelId?: string;
  harnessSlug?: string;
  testCaseSlug?: string;
  caseName?: string;
  variant?: string;
  startedAt?: string;
  cost?: number | null;
  tokens?: number | null;
}): RunSummary {
  const {
    id = "r-1",
    modelId = "anthropic/claude",
    harnessSlug = "claude",
    testCaseSlug = "carom",
    caseName = "Carom",
    variant = "base",
    startedAt = "2026-01-01T00:00:00Z",
    cost = 1,
    tokens = 1000,
  } = overrides;
  return {
    id,
    startedAt,
    finishedAt: startedAt,
    caseName,
    subject: {
      testCaseSlug,
      testCaseVersion: "1.0.0",
      testType: "end-to-end",
      variant,
      harnessSlug,
      modelId,
    },
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: tokens,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: cost, actual: cost },
    },
    state: "completed",
  } as unknown as RunSummary;
}

const costOf = (r: RunSummary): number | null => r.metrics.cost.comparable;

describe("modelCaseOptions", () => {
  it("groups a model's runs by case and variant, most-run first", () => {
    const options = modelCaseOptions([
      run({ id: "a", testCaseSlug: "carom", caseName: "Carom" }),
      run({ id: "b", testCaseSlug: "carom", caseName: "Carom" }),
      run({
        id: "c",
        testCaseSlug: "carom",
        caseName: "Carom",
        variant: "hard-mode",
      }),
      run({
        id: "d",
        testCaseSlug: "space-invaders",
        caseName: "Space Invaders",
      }),
    ]);

    expect(options.map((c) => c.slug)).toEqual(["carom", "space-invaders"]);
    expect(options[0]!.runs).toBe(3);
    expect(options[0]!.variants).toEqual([
      { slug: "base", name: "Base", runs: 2 },
      { slug: "hard-mode", name: "Hard Mode", runs: 1 },
    ]);
    expect(options[1]!.variants).toEqual([
      { slug: "base", name: "Base", runs: 1 },
    ]);
  });

  it("breaks an equal-run tie on recency, then on the slug", () => {
    const options = modelCaseOptions([
      run({ id: "a", testCaseSlug: "alpha", startedAt: "2026-01-01T00:00:00Z" }),
      run({ id: "b", testCaseSlug: "beta", startedAt: "2026-02-01T00:00:00Z" }),
      run({ id: "c", testCaseSlug: "gamma", startedAt: "2026-02-01T00:00:00Z" }),
    ]);

    expect(options.map((c) => c.slug)).toEqual(["beta", "gamma", "alpha"]);
  });

  it("tracks the latest start across a case's runs", () => {
    const options = modelCaseOptions([
      run({ id: "a", startedAt: "2026-01-01T00:00:00Z" }),
      run({ id: "b", startedAt: "2026-03-01T00:00:00Z" }),
      run({ id: "c", startedAt: "2026-02-01T00:00:00Z" }),
    ]);

    expect(options[0]!.latestStartedAt).toBe("2026-03-01T00:00:00Z");
  });

  it("falls back to the humanized slug when a card carries no case name", () => {
    const options = modelCaseOptions([
      run({ testCaseSlug: "space-invaders", caseName: "" }),
    ]);

    expect(options[0]!.name).toBe("Space Invaders");
  });

  it("has no options for a model with no runs", () => {
    expect(modelCaseOptions([])).toEqual([]);
  });
});

describe("runIsModel", () => {
  it("matches a covered id exactly", () => {
    expect(runIsModel(run({ modelId: "anthropic/claude" }), ["anthropic/claude"]))
      .toBe(true);
  });

  it("matches an OpenRouter-prefixed recording of a covered id", () => {
    const openrouter = run({
      modelId: "openrouter/anthropic/claude",
      harnessSlug: "opencode",
    });
    expect(runIsModel(openrouter, ["anthropic/claude"])).toBe(true);
  });

  it("does not match another model", () => {
    expect(runIsModel(run({ modelId: "openai/gpt" }), ["anthropic/claude"]))
      .toBe(false);
  });
});

describe("standInField", () => {
  const SUBJECT = ["anthropic/claude"];

  it("places the subject's mean against the other models' means", () => {
    const standing = standInField(
      [
        run({ id: "a", modelId: "anthropic/claude", cost: 4 }),
        run({ id: "b", modelId: "anthropic/claude", cost: 6 }),
        run({ id: "c", modelId: "openai/gpt", cost: 1 }),
        run({ id: "d", modelId: "google/gemini", cost: 2 }),
        run({ id: "e", modelId: "meta/llama", cost: 9 }),
      ],
      SUBJECT,
      costOf,
    );

    // The subject averages 5, above two of the three others.
    expect(standing).toMatchObject({
      value: 5,
      reported: 2,
      greaterThan: 2 / 3,
      rank: 3,
      fieldSize: 4,
      min: 1,
      max: 9,
    });
  });

  it("does not count a model tied with the subject as beaten", () => {
    const standing = standInField(
      [
        run({ id: "a", modelId: "anthropic/claude", cost: 5 }),
        run({ id: "b", modelId: "openai/gpt", cost: 5 }),
      ],
      SUBJECT,
      costOf,
    );

    expect(standing?.greaterThan).toBe(0);
    // A tie shares the better rank rather than pushing the subject down.
    expect(standing?.rank).toBe(1);
  });

  it("reports no comparison when the subject is the only model", () => {
    const standing = standInField(
      [run({ modelId: "anthropic/claude", cost: 5 })],
      SUBJECT,
      costOf,
    );

    expect(standing?.greaterThan).toBeNull();
    expect(standing?.fieldSize).toBe(1);
  });

  it("skips runs that did not report the figure rather than scoring them zero", () => {
    const standing = standInField(
      [
        run({ id: "a", modelId: "anthropic/claude", cost: 4 }),
        run({ id: "b", modelId: "anthropic/claude", cost: null }),
        run({ id: "c", modelId: "openai/gpt", cost: 9 }),
      ],
      SUBJECT,
      costOf,
    );

    expect(standing?.value).toBe(4);
    expect(standing?.reported).toBe(1);
  });

  it("leaves a model that reported nothing out of the field entirely", () => {
    const standing = standInField(
      [
        run({ id: "a", modelId: "anthropic/claude", cost: 4 }),
        run({ id: "b", modelId: "openai/gpt", cost: null }),
      ],
      SUBJECT,
      costOf,
    );

    // Only the subject priced a run, so there is no field to compare against.
    expect(standing?.fieldSize).toBe(1);
    expect(standing?.greaterThan).toBeNull();
  });

  it("folds an OpenRouter-tagged recording into the base model's field entry", () => {
    const standing = standInField(
      [
        run({ id: "a", modelId: "anthropic/claude", cost: 5 }),
        run({
          id: "b",
          modelId: "openrouter/openai/gpt:free",
          harnessSlug: "opencode",
          cost: 1,
        }),
        run({ id: "c", modelId: "openai/gpt", cost: 3 }),
      ],
      ["anthropic/claude"],
      costOf,
    );

    // The two GPT recordings are one model averaging 2, not two models.
    expect(standing?.fieldSize).toBe(2);
    expect(standing?.greaterThan).toBe(1);
  });

  it("has nothing to place when the subject reported the figure on no run", () => {
    const standing = standInField(
      [
        run({ id: "a", modelId: "anthropic/claude", cost: null }),
        run({ id: "b", modelId: "openai/gpt", cost: 3 }),
      ],
      SUBJECT,
      costOf,
    );

    expect(standing).toBeNull();
  });

  it("has nothing to place over an empty cohort", () => {
    expect(standInField([], SUBJECT, costOf)).toBeNull();
  });
});

describe("meanReported", () => {
  it("averages only the runs that reported the figure", () => {
    const mean = meanReported(
      [run({ id: "a", cost: 2 }), run({ id: "b", cost: null }), run({ id: "c", cost: 4 })],
      costOf,
    );

    expect(mean).toBe(3);
  });

  it("is null — not zero — when nothing reported the figure", () => {
    expect(meanReported([run({ cost: null })], costOf)).toBeNull();
    expect(meanReported([], costOf)).toBeNull();
  });
});
