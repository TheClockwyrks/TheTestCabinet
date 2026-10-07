import { describe, expect, it } from "vitest";
import type { StoredReview } from "../../client/types";
import { frameReview, frameReviews } from "./frameReview";
import { parseWriteup } from "./ratings";

// The writeup frontmatter carries both rating channels: `rating.<domain>` lines
// (functional, legacy) and one bare `aesthetic:` line (the run-wide tier of a
// validator-rated run's review). The parser and the framers must round-trip
// both, or a validator-rated run's aesthetic would vanish between the store and
// a badge — and legacy `aesthetic.<domain>` lines must keep parsing, collapsed
// to their worst tier, so old writeups do not change their displayed value.
describe("parseWriteup", () => {
  it("reads the bare aesthetic line beside rating lines", () => {
    const parsed = parseWriteup(
      "---\nrating.core: great\naesthetic: amazing\nreview.loop: pass\n---\n\nNice.",
    );
    expect(parsed.ratings).toEqual([{ domain: "core", rating: "great" }]);
    expect(parsed.aesthetic).toBe("amazing");
    expect(parsed.checklist).toEqual([{ id: "loop", status: "pass" }]);
    expect(parsed.body).toBe("Nice.");
  });

  it("collapses legacy per-domain aesthetic lines to the worst tier", () => {
    const parsed = parseWriteup(
      "---\naesthetic.core: amazing\naesthetic.versus: okay\n---\n\nx",
    );
    expect(parsed.aesthetic).toBe("okay");
  });

  it("skips an unknown aesthetic tier and yields none without frontmatter", () => {
    expect(parseWriteup("---\naesthetic: superb\n---\n\nx").aesthetic).toBe(
      null,
    );
    expect(parseWriteup("just prose").aesthetic).toBe(null);
  });
});

describe("frameReview / frameReviews", () => {
  const review = (
    aesthetic: StoredReview["aesthetic"],
    reviewer = "A",
  ): StoredReview =>
    ({
      reviewer,
      reviewerId: reviewer,
      ratings: [],
      aesthetic,
      checklist: [],
      writeup: "",
    }) as unknown as StoredReview;

  it("frames a review's run-wide aesthetic so the parser recovers it", () => {
    const framed = frameReview(review("good"));
    expect(parseWriteup(framed).aesthetic).toBe("good");
    expect(parseWriteup(framed).ratings).toEqual([]);
  });

  it("collapses a legacy stored row's per-domain tiers to the worst", () => {
    const legacy = {
      reviewer: "A",
      reviewerId: "A",
      ratings: [],
      aesthetics: [
        { domain: "core", rating: "legendary" },
        { domain: "versus", rating: "okay" },
      ],
      checklist: [],
      writeup: "",
    } as unknown as StoredReview;
    expect(parseWriteup(frameReview(legacy)).aesthetic).toBe("okay");
  });

  it("aggregates the worst run-wide tier across reviews", () => {
    const framed = frameReviews([
      review("legendary", "A"),
      review("slop", "B"),
    ])!;
    expect(parseWriteup(framed).aesthetic).toBe("slop");
  });
});
