import { describe, expect, it } from "vitest";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { isPublishable } from "./useRunPublish";

// A summary card carrying only the fields the publish gate reads; everything else
// gets a benign default so a test varies one axis at a time.
function summary(fields: {
  publishedAt?: string;
  state?: RunSummary["state"];
  reviewCount?: number;
  validatorRated?: boolean;
}): RunSummary {
  return {
    id: "r1",
    publishedAt: fields.publishedAt ?? "",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:01:00Z",
    subject: {
      testCaseSlug: "carom",
      testCaseVersion: "v1.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1",
      modelId: "anthropic/claude",
    },
    caseName: "carom",
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: 100,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: 1, actual: null },
    },
    validationLoaded: true,
    state: fields.state ?? "completed",
    rating: null,
    aesthetic: null,
    validatorRated: fields.validatorRated ?? false,
    reviewCount: fields.reviewCount ?? 0,
    links: { sourceRepo: null, playableBuild: null },
  } as unknown as RunSummary;
}

// These mirror the backend's `gate_publishable` (and the `state=publishable`
// slice the Unpublished worklist draws from). The backend is the real gate; the
// point of these is that the console never *offers* a publish it will refuse.
describe("isPublishable", () => {
  it("accepts a reviewed, unpublished completed run", () => {
    expect(isPublishable(summary({ reviewCount: 1 }))).toBe(true);
  });

  it("refuses a completed run nobody has reviewed", () => {
    expect(isPublishable(summary({ reviewCount: 0 }))).toBe(false);
  });

  it("refuses a run that is already public", () => {
    expect(
      isPublishable(
        summary({ publishedAt: "2026-01-02T00:00:00Z", reviewCount: 1 }),
      ),
    ).toBe(false);
  });

  it("accepts each publishable failure tier with no review at all", () => {
    for (const state of [
      "catastrophic",
      "timed_out",
      "harness_error",
      "limit_exceeded",
      "hung",
    ] as const) {
      expect(isPublishable(summary({ state, reviewCount: 0 })), state).toBe(
        true,
      );
    }
  });

  it("refuses an infrastructure failure however many reviews it carries", () => {
    // Our own fault, not a model result — never publishable, which is exactly
    // the case a plain "has a review" check would wrongly admit.
    expect(
      isPublishable(summary({ state: "infrastructure", reviewCount: 3 })),
    ).toBe(false);
  });

  // A validator-rated run's functional rating and score are the validators' and
  // stand on their own: it publishes with zero reviews (an aesthetic review can be
  // added later). A failed one still follows the failure tiers above.
  it("publishes a completed validator-rated run with no review", () => {
    expect(
      isPublishable(summary({ reviewCount: 0, validatorRated: true })),
    ).toBe(true);
  });

  it("keeps the failure tiers for a validator-rated run", () => {
    expect(
      isPublishable(
        summary({
          reviewCount: 0,
          validatorRated: true,
          state: "infrastructure",
        }),
      ),
    ).toBe(false);
  });
});
