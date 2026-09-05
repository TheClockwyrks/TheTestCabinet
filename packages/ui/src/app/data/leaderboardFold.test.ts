import { describe, expect, it } from "vitest";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import type { ParsedWriteup } from "./ratings";
import type { VariantSummary } from "./testCases";
import {
  bestAestheticRating,
  bestGrade,
  bestRating,
  foldLeaderboardEntries,
  mean,
} from "./leaderboardFold";

// A completed, summary-scored run carrying the fields the fold reads. Every
// non-supplied field gets a benign default so a test can vary one axis at a
// time.
function run(
  id: string,
  fields: {
    state?: string;
    harness?: string;
    model?: string;
    engine?: string | null;
    startedAt?: string;
    score?: { earned: number; total: number } | null;
    rating?: string | null;
    aesthetic?: string | null;
    overallGrade?: string;
    cost?: number | null;
    tokens?: number | null;
  } = {},
): RunSummary {
  const score =
    fields.score === undefined ? { earned: 4, total: 5 } : fields.score;
  return {
    id,
    startedAt: fields.startedAt ?? "2026-01-01T00:00:00Z",
    state: fields.state ?? "completed",
    subject: {
      testCaseSlug: "pong",
      testCaseVersion: "v1.0.0",
      variant: "base",
      harnessSlug: fields.harness ?? "claude",
      modelId: fields.model ?? "anthropic/claude",
      engineSlug: fields.engine === undefined ? "none" : fields.engine,
    },
    metrics: {
      tokens: {
        uncachedInput: fields.tokens === undefined ? 100 : fields.tokens,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: fields.cost === undefined ? 1 : fields.cost },
    },
    score: score
      ? { ...score, overallGrade: fields.overallGrade, reviews: 1 }
      : null,
    rating: fields.rating === undefined ? "great" : fields.rating,
    aesthetic: fields.aesthetic ?? null,
  } as unknown as RunSummary;
}

describe("foldLeaderboardEntries", () => {
  it("excludes non-completed, gg, and score-less runs", () => {
    const entries = foldLeaderboardEntries([
      run("a"),
      // A failed run produced no result and is never reviewable.
      run("b", { state: "harness_error" }),
      // A gg run's agents may span several models: no single model to rank.
      run("c", { harness: "gg" }),
      // No enriched summary score and no variant/findReview fallback supplied.
      run("d", { score: null }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.earned).toEqual([4]);
  });

  it("splits rows by harness and canonicalizes the model id", () => {
    const entries = foldLeaderboardEntries([
      run("a", { harness: "claude", model: "anthropic/claude" }),
      // The same model under another harness is its own row, never merged…
      run("b", { harness: "opencode", model: "anthropic/claude" }),
      // …but an `openrouter/`-prefixed, `:free`-tagged run folds into its base
      // form's row (harness-aware canonicalization).
      run("c", {
        harness: "opencode",
        model: "openrouter/anthropic/claude:free",
      }),
    ]);
    expect(entries).toHaveLength(2);
    const opencode = entries.find((e) => e.harnessSlug === "opencode")!;
    expect(opencode.modelId).toBe("anthropic/claude");
    expect(opencode.earned).toEqual([4, 4]);
  });

  it("splits rows by engine only when keyed by it", () => {
    const runs = [
      run("a", { engine: "simple-2d" }),
      run("b", { engine: "none" }),
      // A summary from before engine selection existed reads as "none".
      run("c", { engine: null }),
    ];
    const merged = foldLeaderboardEntries(runs);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.engineSlug).toBeNull();

    const split = foldLeaderboardEntries(runs, { keyEngine: true });
    expect(split.map((e) => e.engineSlug).sort()).toEqual([
      "none",
      "simple-2d",
    ]);
    expect(split.find((e) => e.engineSlug === "none")!.earned).toEqual([4, 4]);
  });

  it("carries per-run earned points AND score fractions", () => {
    const entries = foldLeaderboardEntries([
      run("a", { score: { earned: 4, total: 5 } }),
      // Cross-case folds mix totals, so the fraction is the comparable figure.
      run("b", { score: { earned: 9, total: 20 } }),
      // A zero total contributes a 0 fraction rather than dividing by zero.
      run("c", { score: { earned: 0, total: 0 } }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.earned).toEqual([4, 9, 0]);
    expect(entries[0]!.fractions).toEqual([0.8, 0.45, 0]);
  });

  it("collects ratings, aesthetics, and grades only from runs carrying them", () => {
    const entries = foldLeaderboardEntries([
      run("a", { rating: "great", aesthetic: "amazing" }),
      run("b", { rating: "passable", aesthetic: null }),
      run("c", { rating: null, overallGrade: "incredible" }),
    ]);
    expect(entries[0]!.ratings).toEqual(["great", "passable"]);
    expect(entries[0]!.aesthetics).toEqual(["amazing"]);
    expect(entries[0]!.grades).toEqual(["incredible"]);
  });

  it("excludes unknown costs and unreported tokens from their lists", () => {
    const entries = foldLeaderboardEntries([
      run("a", { cost: 2.5, tokens: 1_000 }),
      run("b", { cost: null, tokens: null }),
      // A known free run's 0.0 is a real cost.
      run("c", { cost: 0, tokens: 500 }),
    ]);
    expect(entries[0]!.costs).toEqual([2.5, 0]);
    expect(entries[0]!.tokens).toEqual([1_000, 500]);
  });

  it("keeps the most recent contributing run's start time", () => {
    const entries = foldLeaderboardEntries([
      run("a", { startedAt: "2026-02-01T00:00:00Z" }),
      run("b", { startedAt: "2026-03-01T00:00:00Z" }),
      run("c", { startedAt: "2026-01-01T00:00:00Z" }),
    ]);
    expect(entries[0]!.latestStartedAt).toBe("2026-03-01T00:00:00Z");
  });

  it("resolves display names through the caller's resolver, canonical id fallback", () => {
    const entries = foldLeaderboardEntries(
      [
        run("a", { harness: "opencode", model: "openrouter/anthropic/claude" }),
        run("b", { harness: "opencode", model: "unknown/model" }),
      ],
      {
        // The resolver sees the RAW recorded id (the catalog's harness-aware
        // lookup wants it), not the canonical fold key.
        resolveModelName: (modelId) =>
          modelId === "openrouter/anthropic/claude" ? "Claude" : null,
      },
    );
    const names = entries.map((e) => e.modelName).sort();
    expect(names).toEqual(["Claude", "unknown/model"]);
  });

  it("scores a score-less local run from its writeup when the variant is supplied", () => {
    const variant = {
      reviewItems: [
        { id: "a", title: "A", weight: 3 },
        { id: "b", title: "B", weight: 2 },
      ],
    } as unknown as VariantSummary;
    const writeup = {
      ratings: [{ domain: "gameplay", rating: "great" }],
      aesthetics: [],
      checklist: [{ id: "a", status: "pass" }],
    } as unknown as ParsedWriteup;
    const entries = foldLeaderboardEntries([run("a", { score: null })], {
      variant,
      findReview: (runId) => (runId === "a" ? writeup : undefined),
      localWriteups: {},
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.earned).toEqual([3]);
    expect(entries[0]!.ratings).toEqual(["great"]);
  });
});

describe("best-of helpers", () => {
  it("pick the best tier on each scale, null when empty", () => {
    expect(bestRating(["passable", "flawless", "broken"])).toBe("flawless");
    expect(bestRating([])).toBeNull();
    expect(bestAestheticRating(["slop", "legendary"])).toBe("legendary");
    expect(bestAestheticRating([])).toBeNull();
    expect(bestGrade(["poor", "incredible", "neutral"])).toBe("incredible");
    expect(bestGrade([])).toBeNull();
  });

  it("mean is null over no values", () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 6])).toBe(3);
  });
});
