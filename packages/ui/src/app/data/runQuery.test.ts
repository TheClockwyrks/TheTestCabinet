import { describe, expect, it } from "vitest";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type { Rating } from "../../ratings";
import { runSummaryPage } from "./runQuery";

// A summary card carrying the fields the query reads. Every non-supplied field
// gets a benign default so a test can vary one axis at a time.
function summary(
  id: string,
  fields: {
    startedAt?: string;
    testCase?: string;
    version?: string;
    model?: string;
    harness?: string;
    variant?: string;
    runTimeSeconds?: number;
    tokens?: number | null;
    cost?: number | null;
    rating?: Rating | null;
  } = {},
): RunSummary {
  const tokens = fields.tokens === undefined ? 100 : fields.tokens;
  return {
    id,
    publishedAt: "",
    startedAt: fields.startedAt ?? "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:01:00Z",
    subject: {
      testCaseSlug: fields.testCase ?? "carom",
      testCaseVersion: fields.version ?? "v1.0.0",
      testType: "end-to-end",
      variant: fields.variant ?? "base",
      harnessSlug: fields.harness ?? "claude",
      harnessVersion: "1",
      modelId: fields.model ?? "anthropic/claude",
    },
    caseName: fields.testCase ?? "carom",
    metrics: {
      runTimeSeconds: fields.runTimeSeconds ?? 60,
      tokens: {
        uncachedInput: tokens,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: {
        comparable: fields.cost === undefined ? 1 : fields.cost,
        actual: null,
      },
    },
    validationLoaded: true,
    state: "completed",
    rating: fields.rating === undefined ? "great" : fields.rating,
    reviewCount: 0,
    links: { sourceRepo: null, playableBuild: null },
  } as unknown as RunSummary;
}

const ids = (result: { summaries: RunSummary[] }) =>
  result.summaries.map((s) => s.id);

describe("runSummaryPage", () => {
  it("equality-filters by test case, model, and harness (empty ignored)", () => {
    const runs = [
      summary("a", { testCase: "carom", model: "m1", harness: "claude" }),
      summary("b", { testCase: "carom", model: "m2", harness: "codex" }),
      summary("c", { testCase: "siege", model: "m1", harness: "claude" }),
    ];
    expect(ids(runSummaryPage(runs, { testCase: "carom" })).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(ids(runSummaryPage(runs, { model: "m1" })).sort()).toEqual([
      "a",
      "c",
    ]);
    expect(ids(runSummaryPage(runs, { harness: "codex" }))).toEqual(["b"]);
    // An empty filter string matches everything (mirrors the backend).
    expect(runSummaryPage(runs, { testCase: "" }).total).toBe(3);
  });

  it("equality-filters by variant, alone and paired with its case", () => {
    const runs = [
      summary("a", { testCase: "carom", variant: "base" }),
      summary("b", { testCase: "carom", variant: "gyre" }),
      summary("c", { testCase: "siege", variant: "base" }),
    ];
    expect(ids(runSummaryPage(runs, { variant: "base" })).sort()).toEqual([
      "a",
      "c",
    ]);
    // A variant slug is unique only within its case, so the pair narrows to one.
    expect(
      ids(runSummaryPage(runs, { testCase: "carom", variant: "base" })),
    ).toEqual(["a"]);
    expect(runSummaryPage(runs, { variant: "" }).total).toBe(3);
  });

  it("equality-filters by exact test-case version", () => {
    const runs = [
      summary("a", { testCase: "carom", version: "v1.0.0" }),
      summary("b", { testCase: "carom", version: "v2.0.0" }),
      summary("c", { testCase: "siege", version: "v1.0.0" }),
    ];
    // A bare version selects that version of every case…
    expect(ids(runSummaryPage(runs, { version: "v1.0.0" })).sort()).toEqual([
      "a",
      "c",
    ]);
    // …and paired with a case, exactly that case's version.
    expect(
      ids(runSummaryPage(runs, { testCase: "carom", version: "v2.0.0" })),
    ).toEqual(["b"]);
    expect(runSummaryPage(runs, { version: "" }).total).toBe(3);
  });

  it("latestVersions keeps each case's current major.minor", () => {
    const runs = [
      summary("a", { testCase: "carom", version: "v1.0.0" }),
      // Two revisions of carom's current minor: both are the same spec.
      summary("b", { testCase: "carom", version: "v1.2.0" }),
      summary("c", { testCase: "carom", version: "v1.2.1" }),
      summary("d", { testCase: "siege", version: "v2.0.0" }),
      summary("e", { testCase: "siege", version: "v3.0.0" }),
    ];
    const page = runSummaryPage(runs, { latestVersions: true });
    expect(ids(page).sort()).toEqual(["b", "c", "e"]);
    // The total counts the same filtered set, so a pager built on it stays honest.
    expect(page.total).toBe(3);
  });

  it("latestVersions orders version components numerically, not lexically", () => {
    const runs = [
      summary("a", { version: "v1.9.0" }),
      summary("b", { version: "v1.10.0" }),
    ];
    expect(ids(runSummaryPage(runs, { latestVersions: true }))).toEqual(["b"]);
  });

  it("latestVersions is measured before the other filters narrow the set", () => {
    // Scoping to one model must not promote that model's newest run to "current"
    // — the cohort is the case's, so a model that never ran v2 shows nothing.
    const runs = [
      summary("a", { testCase: "carom", version: "v1.0.0", model: "m1" }),
      summary("b", { testCase: "carom", version: "v2.0.0", model: "m2" }),
    ];
    expect(
      runSummaryPage(runs, { latestVersions: true, model: "m1" }).total,
    ).toBe(0);
    expect(
      ids(runSummaryPage(runs, { latestVersions: true, model: "m2" })),
    ).toEqual(["b"]);
  });

  it("an exact version overrides latestVersions", () => {
    const runs = [
      summary("a", { testCase: "carom", version: "v1.0.0" }),
      summary("b", { testCase: "carom", version: "v2.0.0" }),
    ];
    expect(
      ids(runSummaryPage(runs, { latestVersions: true, version: "v1.0.0" })),
    ).toEqual(["a"]);
  });

  it("free-text q matches case-insensitively across identity columns", () => {
    const runs = [
      summary("a", { testCase: "carom", model: "anthropic/claude" }),
      summary("b", {
        testCase: "siege",
        model: "openai/gpt",
        harness: "amp",
        variant: "hard",
      }),
      summary("c", { testCase: "meltdown", model: "openai/o1", harness: "codex" }),
    ];
    expect(ids(runSummaryPage(runs, { q: "CLAUDE" }))).toEqual(["a"]);
    expect(ids(runSummaryPage(runs, { q: "hard" }))).toEqual(["b"]);
    expect(ids(runSummaryPage(runs, { q: "codex" }))).toEqual(["c"]);
    expect(runSummaryPage(runs, { q: "  " }).total).toBe(3);
  });

  it("non-published state matches nothing (site holds only published)", () => {
    const runs = [summary("a"), summary("b")];
    expect(runSummaryPage(runs, { state: "review" }).total).toBe(0);
    expect(runSummaryPage(runs, { state: "unpublished" }).summaries).toEqual([]);
    expect(runSummaryPage(runs, { state: "published" }).total).toBe(2);
    // `any` is the published + unpublished union, and the static index is entirely
    // published — so it collapses to the published slice rather than matching none.
    expect(runSummaryPage(runs, { state: "any" }).total).toBe(2);
  });

  it("sorts by date, desc default and asc, with id tiebreak", () => {
    const runs = [
      summary("a", { startedAt: "2026-01-02T00:00:00Z" }),
      summary("b", { startedAt: "2026-01-01T00:00:00Z" }),
      summary("c", { startedAt: "2026-01-03T00:00:00Z" }),
    ];
    expect(ids(runSummaryPage(runs, {}))).toEqual(["c", "a", "b"]);
    expect(ids(runSummaryPage(runs, { sort: "date", dir: "asc" }))).toEqual([
      "b",
      "a",
      "c",
    ]);
    // Tie on the sort key falls to the id, in the sort direction.
    const tied = [
      summary("y", { startedAt: "2026-01-01T00:00:00Z" }),
      summary("x", { startedAt: "2026-01-01T00:00:00Z" }),
    ];
    expect(ids(runSummaryPage(tied, { sort: "date", dir: "asc" }))).toEqual([
      "x",
      "y",
    ]);
    expect(ids(runSummaryPage(tied, { sort: "date", dir: "desc" }))).toEqual([
      "y",
      "x",
    ]);
  });

  it("sorts by runtime and by tokens", () => {
    const runs = [
      summary("a", { runTimeSeconds: 30, tokens: 300 }),
      summary("b", { runTimeSeconds: 10, tokens: 100 }),
      summary("c", { runTimeSeconds: 20, tokens: 200 }),
    ];
    expect(ids(runSummaryPage(runs, { sort: "runtime", dir: "asc" }))).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(ids(runSummaryPage(runs, { sort: "tokens", dir: "desc" }))).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("sorts by identity columns (testCase/harness/model/variant)", () => {
    const runs = [
      summary("a", { testCase: "siege" }),
      summary("b", { testCase: "carom" }),
      summary("c", { testCase: "meltdown" }),
    ];
    expect(ids(runSummaryPage(runs, { sort: "testCase", dir: "asc" }))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts cost with NULLs last in either direction", () => {
    const runs = [
      summary("a", { cost: 5 }),
      summary("b", { cost: null }),
      summary("c", { cost: 1 }),
    ];
    // asc: 1, 5, then the null; desc: 5, 1, then the null — null last both ways.
    expect(ids(runSummaryPage(runs, { sort: "cost", dir: "asc" }))).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(ids(runSummaryPage(runs, { sort: "cost", dir: "desc" }))).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("sorts rating by tier with unrated NULLs last in either direction", () => {
    const runs = [
      summary("a", { rating: "broken" }),
      summary("b", { rating: null }),
      summary("c", { rating: "flawless" }),
      summary("d", { rating: "scuffed" }),
    ];
    // asc: best→worst tier (flawless, scuffed, broken), null last.
    expect(ids(runSummaryPage(runs, { sort: "rating", dir: "asc" }))).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
    // desc: worst→best tier, null still last.
    expect(ids(runSummaryPage(runs, { sort: "rating", dir: "desc" }))).toEqual([
      "a",
      "d",
      "c",
      "b",
    ]);
  });

  it("windows by offset/limit and reports the unwindowed total", () => {
    const runs = [
      summary("a", { startedAt: "2026-01-05T00:00:00Z" }),
      summary("b", { startedAt: "2026-01-04T00:00:00Z" }),
      summary("c", { startedAt: "2026-01-03T00:00:00Z" }),
      summary("d", { startedAt: "2026-01-02T00:00:00Z" }),
      summary("e", { startedAt: "2026-01-01T00:00:00Z" }),
    ];
    // Default date-desc: a,b,c,d,e. Page 2 of size 2 → c,d. total = 5.
    const page = runSummaryPage(runs, { offset: 2, limit: 2 });
    expect(ids(page)).toEqual(["c", "d"]);
    expect(page.total).toBe(5);
    // No limit → every row from the offset.
    expect(ids(runSummaryPage(runs, { offset: 3 }))).toEqual(["d", "e"]);
    // total counts filtered rows, not the window.
    expect(runSummaryPage(runs, { limit: 1, testCase: "carom" }).total).toBe(5);
  });
});
