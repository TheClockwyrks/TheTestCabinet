import { describe, expect, it } from "vitest";
import type {
  ReviewVerdict,
  VerdictStatus,
} from "@test-cabinet/run-record/review";
import {
  OVERALL_VERDICT_ID,
  aggregateOverallGrade,
  applyScoreExclusions,
  excludedVerdictIds,
  formatPoints,
  gradePoints,
  mergeReviewItems,
  scoreChecklist,
  subItemVerdictId,
  verdictIdsForItem,
  worstGrade,
  type WeightedItem,
} from "./ratings";

const pass = (id: string): ReviewVerdict => ({ id, status: "pass" });
const fail = (id: string): ReviewVerdict => ({ id, status: "fail" });
const grade = (id: string, status: VerdictStatus): ReviewVerdict => ({
  id,
  status,
});

// These mirror the Rust core's review scoring tests (crates/core/src/review.test.rs);
// keeping the two in lockstep is what lets the site score runs the same way the
// backend does.
describe("scoreChecklist with sub-items", () => {
  it("scores a whole-item pass as its full weight", () => {
    const items: WeightedItem[] = [
      { id: "a", weight: 2 },
      { id: "b", weight: 3 },
    ];
    const score = scoreChecklist(items, [pass("a"), fail("b")]);
    expect(score).toEqual({ earned: 2, total: 5 });
  });

  it("credits each passed sub-item by its own weight; the category totals their weights", () => {
    const items: WeightedItem[] = [
      { id: "plain", weight: 2 },
      {
        id: "spin",
        weight: 3, // the sum of its sub-items' weights (2 + 1)
        subItems: [
          { id: "stationary", weight: 2 },
          { id: "moving", weight: 1 },
        ],
      },
    ];
    // plain earns 2; the spin category totals 3 and earns stationary's 2 (moving
    // failed). Total 5, earned 4.
    const score = scoreChecklist(items, [
      pass("plain"),
      pass("spin.stationary"),
      fail("spin.moving"),
    ]);
    expect(score.total).toBe(5);
    expect(score.earned).toBeCloseTo(4);
  });

  it("sums the weight of each passed sub-item (default weight 1)", () => {
    const items: WeightedItem[] = [
      { id: "q", weight: 3, subItems: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    ];
    // Sub-items with no explicit weight are worth 1 each, so the category totals 3.
    expect(scoreChecklist(items, []).total).toBe(3);
    expect(
      scoreChecklist(items, [pass("q.a"), pass("q.b"), pass("q.c")]).earned,
    ).toBeCloseTo(3);
    expect(
      scoreChecklist(items, [fail("q.a"), fail("q.b"), fail("q.c")]).earned,
    ).toBe(0);
    expect(
      scoreChecklist(items, [pass("q.a"), fail("q.b"), fail("q.c")]).earned,
    ).toBeCloseTo(1);
  });
});

// Mirror the Rust core's graded (game-jam) scoring and aggregation tests; the
// point values and worst-wins overall grade must match the backend.
describe("graded (game-jam) scoring", () => {
  it("maps each graded tier to its point value", () => {
    expect(gradePoints("broken")).toBe(0);
    expect(gradePoints("poor")).toBe(2);
    expect(gradePoints("neutral")).toBe(5);
    expect(gradePoints("great")).toBe(8);
    expect(gradePoints("incredible")).toBe(10);
    // Binary statuses are not graded.
    expect(gradePoints("pass")).toBeUndefined();
    expect(gradePoints("fail")).toBeUndefined();
  });

  it("scores a graded item as weight × 10 available, earning tier points × weight", () => {
    const items: WeightedItem[] = [
      { id: "gfx", weight: 2, graded: true },
      { id: "fun", weight: 1, graded: true },
    ];
    // gfx: great (8) × 2 = 16 earned of 20 available; fun: incredible (10) × 1 = 10
    // of 10. Total 30 available, 26 earned.
    const score = scoreChecklist(items, [
      grade("gfx", "great"),
      grade("fun", "incredible"),
    ]);
    expect(score).toEqual({ earned: 26, total: 30 });
  });

  it("earns nothing for an unjudged graded item but still counts its total", () => {
    const items: WeightedItem[] = [{ id: "gfx", weight: 1, graded: true }];
    expect(scoreChecklist(items, [])).toEqual({ earned: 0, total: 10 });
  });

  it("excludes the reserved overall verdict from the score", () => {
    const items: WeightedItem[] = [{ id: "gfx", weight: 1, graded: true }];
    // The overall grade is not a declared item, so it does not add to the total.
    const score = scoreChecklist(items, [
      grade("gfx", "neutral"),
      grade(OVERALL_VERDICT_ID, "incredible"),
    ]);
    expect(score).toEqual({ earned: 5, total: 10 });
  });
});

describe("overall grade aggregation", () => {
  it("takes the worst (lowest-point) grade, ignoring binary statuses", () => {
    expect(worstGrade(["great", "poor", "incredible"])).toBe("poor");
    expect(worstGrade(["pass", "fail"])).toBeNull();
    expect(worstGrade([])).toBeNull();
  });

  it("aggregates the worst overall grade across reviews", () => {
    const reviews = [
      [grade("gfx", "great"), grade(OVERALL_VERDICT_ID, "incredible")],
      [grade("gfx", "poor"), grade(OVERALL_VERDICT_ID, "neutral")],
    ];
    expect(aggregateOverallGrade(reviews)).toBe("neutral");
  });

  it("is null when no review carries an overall grade", () => {
    expect(aggregateOverallGrade([[pass("a")], []])).toBeNull();
  });
});

describe("verdict id helpers", () => {
  it("composes a sub-item verdict id as `<item>.<sub>`", () => {
    expect(subItemVerdictId("spin", "moving")).toBe("spin.moving");
  });

  it("expands an item to its own id, or one composite per sub-item", () => {
    expect(verdictIdsForItem({ id: "plain" })).toEqual(["plain"]);
    expect(
      verdictIdsForItem({ id: "spin", subItems: [{ id: "a" }, { id: "b" }] }),
    ).toEqual(["spin.a", "spin.b"]);
  });
});

// Mirrors the Rust core's `merge_review_items` (crates/core/src/test_case.rs); the
// two must agree so the effective checklist is the same everywhere it's assembled.
describe("mergeReviewItems", () => {
  it("appends a variant item with a fresh id, common first", () => {
    const common = [
      { id: "gameplay", weight: 1, subItems: [{ id: "scoring" }] },
    ];
    const variant = [{ id: "gyre", weight: 1, subItems: [{ id: "oriented" }] }];
    expect(mergeReviewItems(common, variant).map((i) => i.id)).toEqual([
      "gameplay",
      "gyre",
    ]);
  });

  it("folds a variant item that reuses a common category id into that category", () => {
    const common = [
      { id: "gameplay", weight: 1, subItems: [{ id: "scoring" }] },
    ];
    const variant = [
      { id: "gameplay", weight: 1, subItems: [{ id: "serve-direction" }] },
    ];
    const merged = mergeReviewItems(common, variant);
    expect(merged).toHaveLength(1);
    const gameplay = merged[0]!;
    expect(gameplay.id).toBe("gameplay");
    expect(gameplay.weight).toBe(2);
    expect(gameplay.subItems?.map((s) => s.id)).toEqual([
      "scoring",
      "serve-direction",
    ]);
  });

  it("does not mutate the inputs", () => {
    const common = [
      { id: "gameplay", weight: 1, subItems: [{ id: "scoring" }] },
    ];
    const variant = [
      { id: "gameplay", weight: 1, subItems: [{ id: "serve-direction" }] },
    ];
    mergeReviewItems(common, variant);
    expect(common[0]!.subItems).toHaveLength(1);
    expect(common[0]!.weight).toBe(1);
  });
});

// Mirrors the Rust core's `TestCaseVersion::excluded_verdict_ids` and
// `apply_score_exclusions` (crates/core/src/test_case.rs) plus the exclusion skip in
// `score_checklist`: a version's errata can drop a review point from scoring without a
// version bump, and every layer that scores must agree.
describe("score exclusions (errata excludeFromScore)", () => {
  it("collects excluded verdict ids in scope for the variant", () => {
    const errata = [
      { excludeFromScore: true, review: "buggy", variant: null },
      { excludeFromScore: true, review: "base-only", variant: "base" },
      { excludeFromScore: true, review: "other-variant", variant: "gyre" },
      { excludeFromScore: false, review: "not-excluded", variant: null },
      { excludeFromScore: true, review: null, variant: null },
    ];
    expect(excludedVerdictIds(errata, "base")).toEqual(
      new Set(["buggy", "base-only"]),
    );
  });

  it("marks a whole item — and, for a category, all its sub-items — non-scoring", () => {
    const items: WeightedItem[] = [
      { id: "a", weight: 1 },
      { id: "cat", weight: 2, subItems: [{ id: "x" }, { id: "y" }] },
    ];
    const marked = applyScoreExclusions(items, new Set(["cat"]));
    expect(marked.find((i) => i.id === "a")!.scored).toBeUndefined();
    const cat = marked.find((i) => i.id === "cat")!;
    expect(cat.scored).toBe(false);
    expect(cat.subItems!.every((s) => s.scored === false)).toBe(true);
    // Non-mutating: the input item is untouched.
    expect(items[1]!.scored).toBeUndefined();
  });

  it("marks only the named sub-item non-scoring for a composite id", () => {
    const items: WeightedItem[] = [
      { id: "cat", weight: 3, subItems: [{ id: "x" }, { id: "y" }] },
    ];
    const marked = applyScoreExclusions(items, new Set(["cat.y"]));
    const cat = marked[0]!;
    expect(cat.scored).toBeUndefined();
    expect(cat.subItems!.find((s) => s.id === "x")!.scored).toBeUndefined();
    expect(cat.subItems!.find((s) => s.id === "y")!.scored).toBe(false);
  });

  it("drops an excluded whole item from both earned and total", () => {
    const items: WeightedItem[] = applyScoreExclusions(
      [
        { id: "a", weight: 2 },
        { id: "b", weight: 3 },
      ],
      new Set(["b"]),
    );
    // `b` passes but is excluded, so only `a` (weight 2) counts.
    const score = scoreChecklist(items, [pass("a"), pass("b")]);
    expect(score).toEqual({ earned: 2, total: 2 });
  });

  it("drops an excluded sub-item while the rest of the category still scores", () => {
    const items: WeightedItem[] = applyScoreExclusions(
      [{ id: "cat", weight: 3, subItems: [{ id: "x" }, { id: "y" }, { id: "z" }] }],
      new Set(["cat.y"]),
    );
    // x passes, z fails; y (excluded) passes but must not count. Total is x + z = 2.
    const score = scoreChecklist(items, [
      pass("cat.x"),
      pass("cat.y"),
      fail("cat.z"),
    ]);
    expect(score.total).toBe(2);
    expect(score.earned).toBeCloseTo(1);
  });
});

describe("formatPoints", () => {
  it("shows whole numbers as-is and trims fractional trailing zeros", () => {
    expect(formatPoints(2)).toBe("2");
    expect(formatPoints(0.5)).toBe("0.5");
    expect(formatPoints(1 / 3)).toBe("0.33");
  });
});
