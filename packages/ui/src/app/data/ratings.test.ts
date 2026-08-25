import { describe, expect, it } from "vitest";
import type { StoredReview } from "../../client/types";
import { frameReview, frameReviews } from "./frameReview";
import { parseWriteup } from "./ratings";

// The writeup frontmatter carries both rating channels: `rating.<domain>` lines
// (functional, legacy) and `aesthetic.<domain>` lines (aesthetic, validator-rated).
// The parser and the framers must round-trip both, or a validator-rated run's
// aesthetic would vanish between the store and a badge.
describe("parseWriteup", () => {
  it("reads aesthetic lines beside rating lines", () => {
    const parsed = parseWriteup(
      "---\nrating.core: great\naesthetic.core: amazing\naesthetic.versus: okay\nreview.loop: pass\n---\n\nNice.",
    );
    expect(parsed.ratings).toEqual([{ domain: "core", rating: "great" }]);
    expect(parsed.aesthetics).toEqual([
      { domain: "core", rating: "amazing" },
      { domain: "versus", rating: "okay" },
    ]);
    expect(parsed.checklist).toEqual([{ id: "loop", status: "pass" }]);
    expect(parsed.body).toBe("Nice.");
  });

  it("skips an unknown aesthetic tier and yields none without frontmatter", () => {
    expect(
      parseWriteup("---\naesthetic.core: superb\n---\n\nx").aesthetics,
    ).toEqual([]);
    expect(parseWriteup("just prose").aesthetics).toEqual([]);
  });
});

describe("frameReview / frameReviews", () => {
  const review = (
    aesthetics: StoredReview["aesthetics"],
    reviewer = "A",
  ): StoredReview =>
    ({
      reviewer,
      reviewerId: reviewer,
      ratings: [],
      aesthetics,
      checklist: [],
      writeup: "",
    }) as unknown as StoredReview;

  it("frames a review's aesthetics so the parser recovers them", () => {
    const framed = frameReview(review([{ domain: "core", rating: "good" }]));
    expect(parseWriteup(framed).aesthetics).toEqual([
      { domain: "core", rating: "good" },
    ]);
    expect(parseWriteup(framed).ratings).toEqual([]);
  });

  it("aggregates the worst aesthetic per domain across reviews", () => {
    const framed = frameReviews([
      review(
        [
          { domain: "core", rating: "legendary" },
          { domain: "versus", rating: "good" },
        ],
        "A",
      ),
      review([{ domain: "core", rating: "slop" }], "B"),
    ])!;
    expect(parseWriteup(framed).aesthetics).toEqual([
      { domain: "core", rating: "slop" },
      { domain: "versus", rating: "good" },
    ]);
  });
});
