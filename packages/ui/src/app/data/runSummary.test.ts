import type { RunRecord } from "@clockwyrks/run-record";
import { describe, expect, it } from "vitest";
import type { StoredReview, StoredRun } from "../../client/types";
import type { DomainRating } from "../../ratings";
import { toRunSummary } from "./runSummary";

// A produced (unpublished, legacy) stored run around `record` and `reviews`, as
// the worker's produced worklist serves one.
function stored(
  record: RunRecord,
  reviews: StoredReview[],
  overrides: Partial<StoredRun> = {},
): StoredRun {
  return {
    id: record.id,
    record,
    reviews,
    published: false,
    rating: null,
    aesthetic: null,
    validatorRated: false,
    score: null,
    ...overrides,
  };
}

// A run record carrying the fields toRunSummary reads.
function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r-1",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:01:00Z",
    subject: {
      testCaseSlug: "carom",
      testCaseVersion: "1.0.0",
      testType: "asset-generation",
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1",
      orchestratorSlug: "one-shot",
      engineSlug: "simple-2d",
      engineVersion: "1.0.0",
      modelId: "anthropic/claude",
    },
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: 100,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: 1, actual: 1 },
    },
    validation: { loaded: true },
    links: { sourceRepo: null, playableBuild: null },
    status: { state: "completed" },
    ...overrides,
  } as unknown as RunRecord;
}

// A stored review carrying only the per-domain ratings the aggregate reads.
function review(ratings: DomainRating[]): StoredReview {
  return { ratings } as unknown as StoredReview;
}

describe("toRunSummary", () => {
  it("carries the run's engine onto the card, beside its variant", () => {
    // A card that named the variant but not the engine would sort and group runs
    // that are not comparable with each other: the engine is chosen per run, and a
    // result only stands against another result on the same one.
    const summary = toRunSummary(stored(record(), []));
    expect(summary.subject.engineSlug).toBe("simple-2d");
    expect(summary.subject.engineVersion).toBe("1.0.0");
  });

  it("reports no engine version for an engine that vendors no runtime", () => {
    const bare = record({
      subject: {
        ...record().subject,
        engineSlug: "none",
        engineVersion: undefined,
      },
    } as unknown as Partial<RunRecord>);
    expect(toRunSummary(stored(bare, [])).subject.engineVersion).toBeNull();
  });

  it("has a null rating and zero reviewCount when there are no reviews", () => {
    const summary = toRunSummary(stored(record(), []));
    expect(summary.rating).toBeNull();
    expect(summary.reviewCount).toBe(0);
  });

  it("takes the worst rating across every reviewer and domain", () => {
    const reviews = [
      review([
        { domain: "gameplay", rating: "flawless" },
        { domain: "visuals", rating: "great" },
      ]),
      review([
        { domain: "gameplay", rating: "scuffed" },
        { domain: "visuals", rating: "broken" },
      ]),
    ];
    const summary = toRunSummary(stored(record(), reviews));
    // Worst across all reviewers/domains: broken.
    expect(summary.rating).toBe("broken");
    expect(summary.reviewCount).toBe(2);
  });

  it("carries the subject test type and the mapped card fields", () => {
    const summary = toRunSummary(stored(record(), []));
    expect(summary.subject.testType).toBe("asset-generation");
    expect(summary.id).toBe("r-1");
    expect(summary.caseName).toBe("carom");
    expect(summary.validationLoaded).toBe(true);
    expect(summary.state).toBe("completed");
    expect(summary.publishedAt).toBe("");
    expect(summary.links).toEqual({ sourceRepo: null, playableBuild: null });
  });

  it("carries a null gg configuration for a third-party-harness run", () => {
    // A non-gg record has no capability set at all, so there is nothing to lift.
    expect(toRunSummary(stored(record(), [])).subject.ggPreset).toBeNull();
  });

  it("lifts a gg run's configuration name off its capability set", () => {
    const summary = toRunSummary(
      stored(
        record({
          subject: {
            testCaseSlug: "carom",
            testCaseVersion: "1.0.0",
            testType: "end-to-end",
            variant: "base",
            harnessSlug: "gg",
            harnessVersion: "1",
            orchestratorSlug: "one-shot",
            modelId: "anthropic/claude",
            ggCapabilitySet: { preset: "planning-A", agents: [] },
          },
        } as unknown as Partial<RunRecord>),
        [],
      ),
    );
    expect(summary.subject.ggPreset).toBe("planning-A");
  });

  it("carries a null gg configuration for a hand-assembled gg set", () => {
    // No `preset` means the set was assembled by hand; the run log falls back to
    // the model rather than showing an empty cell.
    const summary = toRunSummary(
      stored(
        record({
          subject: {
            testCaseSlug: "carom",
            testCaseVersion: "1.0.0",
            testType: "end-to-end",
            variant: "base",
            harnessSlug: "gg",
            harnessVersion: "1",
            orchestratorSlug: "one-shot",
            modelId: "anthropic/claude",
            ggCapabilitySet: { agents: [] },
          },
        } as unknown as Partial<RunRecord>),
        [],
      ),
    );
    expect(summary.subject.ggPreset).toBeNull();
  });

  it("carries null performance for a non-performance run", () => {
    expect(toRunSummary(stored(record(), [])).performance).toBeNull();
  });

  it("lifts a performance run's correctness and fuel onto the card", () => {
    const summary = toRunSummary(
      stored(
        record({
          validation: {
            loaded: true,
            performance: { correct: true, totalFuel: 1234, cases: [] },
          },
        } as unknown as Partial<RunRecord>),
        [],
      ),
    );
    // So a local, not-yet-published performance run still ranks on the fuel board.
    expect(summary.performance).toEqual({ correct: true, totalFuel: 1234 });
  });
});

describe("toRunSummary's score", () => {
  it("lifts the store's score onto the card so a produced run shows points at once", () => {
    const summary = toRunSummary(
      stored(record(), [], {
        validatorRated: true,
        rating: "great",
        score: { earned: 7, total: 9, reviews: 0, overallGrade: null },
      }),
    );
    expect(summary.score).toEqual({
      earned: 7,
      total: 9,
      reviews: 0,
      overallGrade: null,
    });
  });

  it("has a null score when the store holds no catalog for the case version", () => {
    const summary = toRunSummary(stored(record(), [], { score: null }));
    expect(summary.score).toBeNull();
  });
});

describe("toRunSummary on a validator-rated run", () => {
  it("takes the functional rating from the store, not the reviews, and lifts the flag", () => {
    // The validators decided the rating at push time; a review cannot move it.
    const summary = toRunSummary(
      stored(record(), [review([{ domain: "core", rating: "broken" }])], {
        validatorRated: true,
        rating: "great",
      }),
    );
    expect(summary.validatorRated).toBe(true);
    expect(summary.rating).toBe("great");
  });

  it("aggregates the run-wide aesthetic tier across reviews (worst wins)", () => {
    const summary = toRunSummary(
      stored(
        record(),
        [
          {
            ratings: [],
            aesthetic: "amazing",
          } as unknown as StoredReview,
          {
            ratings: [],
            aesthetic: "okay",
          } as unknown as StoredReview,
        ],
        { validatorRated: true, rating: "flawless" },
      ),
    );
    expect(summary.aesthetic).toBe("okay");
    expect(summary.reviewCount).toBe(2);
  });

  it("collapses a legacy stored review's per-domain tiers to their worst", () => {
    const summary = toRunSummary(
      stored(
        record(),
        [
          {
            ratings: [],
            aesthetics: [
              { domain: "core", rating: "amazing" },
              { domain: "versus", rating: "okay" },
            ],
          } as unknown as StoredReview,
        ],
        { validatorRated: true, rating: "flawless" },
      ),
    );
    expect(summary.aesthetic).toBe("okay");
  });

  it("carries no aesthetic on a legacy run", () => {
    const summary = toRunSummary(
      stored(record(), [review([{ domain: "core", rating: "great" }])]),
    );
    expect(summary.validatorRated).toBe(false);
    expect(summary.aesthetic).toBeNull();
    expect(summary.rating).toBe("great");
  });
});
