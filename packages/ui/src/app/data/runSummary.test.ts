import type { RunRecord } from "@test-cabinet/run-record";
import { describe, expect, it } from "vitest";
import type { StoredReview } from "../../client/types";
import type { DomainRating } from "../../ratings";
import { toRunSummary } from "./runSummary";

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
  it("has a null rating and zero reviewCount when there are no reviews", () => {
    const summary = toRunSummary(record(), []);
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
    const summary = toRunSummary(record(), reviews);
    // Worst across all reviewers/domains: broken.
    expect(summary.rating).toBe("broken");
    expect(summary.reviewCount).toBe(2);
  });

  it("carries the subject test type and the mapped card fields", () => {
    const summary = toRunSummary(record(), []);
    expect(summary.subject.testType).toBe("asset-generation");
    expect(summary.id).toBe("r-1");
    expect(summary.caseName).toBe("carom");
    expect(summary.validationLoaded).toBe(true);
    expect(summary.state).toBe("completed");
    expect(summary.publishedAt).toBe("");
    expect(summary.links).toEqual({ sourceRepo: null, playableBuild: null });
  });
});
