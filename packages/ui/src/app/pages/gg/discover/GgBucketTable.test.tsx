// The bucket view.
//
// Two of the three assertions here are honesty guarantees rather than presentation:
//
// - **`contributing` is the denominator.** TCQ has no `rate()` function because averaging
//   a boolean *is* a rate, and what makes that safe is that a view always says how many of
//   a bucket's documents actually carried the field. Hiding it turns a number that is not
//   a measurement into one that looks like one.
// - **An absent figure is an em dash.** A whole column can come back absent in a bucket
//   whose documents exist; printing `0` there puts a fabricated point in the middle of
//   every comparison.
//
// Driven through the real evaluator for the same reason the document view's suite is: the
// claim is about what an operator sees at the end of the pipeline.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GgRunDoc } from "@test-cabinet/run-record/gg-query";
import { compileQuery, evaluate, parseQuery } from "../query";
import { GgBucketTable } from "./GgBucketTable";

/** Two configurations, and one field only half of the corpus carries. */
const CORPUS: GgRunDoc[] = [
  {
    fields: {
      id: "a",
      started: Date.UTC(2026, 6, 1, 1, 0),
      preset: "planning",
      "cap.compaction": true,
      score: 0.8,
      "summary.ranOutOfContext": false,
    },
  },
  {
    fields: {
      id: "b",
      started: Date.UTC(2026, 6, 1, 2, 0),
      preset: "planning",
      "cap.compaction": true,
      score: 0.4,
      // No `summary.*` at all: this run never ran a session, so its rate has no
      // denominator to contribute to.
    },
  },
  {
    fields: {
      id: "c",
      started: Date.UTC(2026, 6, 3, 5, 0),
      preset: "baseline",
      "cap.compaction": false,
      score: 0.6,
      "summary.ranOutOfContext": true,
    },
  },
];

/** Evaluate query text and render the buckets it produced. */
function run(text: string) {
  const query = compileQuery(parseQuery(text).query);
  const result = evaluate(CORPUS, query);
  render(
    <GgBucketTable
      buckets={result.buckets ?? []}
      columns={result.columns ?? []}
      groupBy={query.stats?.groupBy}
    />,
  );
  return result;
}

/** One row's cells, found by the value in its first column. */
function row(key: string): string[] {
  const cell = screen.getByRole("cell", { name: key });
  const tr = cell.closest("tr");
  return [...(tr?.querySelectorAll("td") ?? [])].map((td) => td.textContent ?? "");
}

describe("the denominator", () => {
  it("shows contributing whenever it is below the bucket's n", () => {
    // `planning` holds two runs but only one carries the field, so the average is over one
    // — and the cell has to say so or it reads as an average over both.
    run("| stats avg(summary.ranOutOfContext) as overflow by preset");
    expect(row("planning").join(" ")).toContain("(1/2)");
  });

  it("stays quiet when every document contributed", () => {
    // Noise on every complete bucket would train an operator to ignore the marker exactly
    // where it matters.
    run("| stats avg(score) by preset");
    expect(row("planning").join(" ")).not.toContain("/");
    expect(row("baseline").join(" ")).not.toContain("/");
  });
});

describe("absent is not zero", () => {
  it("renders a column with nothing behind it as an em dash", () => {
    // The field exists nowhere in the corpus, so every bucket's figure is absent — and an
    // absent average is not a zero average.
    run("| stats avg(code.functions.total) by preset");
    // The em dash *and* the denominator: "none of these two runs carried it" is a more
    // useful thing to read than a bare dash, and neither of them is a zero.
    expect(row("planning").join(" ")).toContain("— (0/2)");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("bucket keys", () => {
  it("renders a date-histogram key as a timestamp, not as epoch milliseconds", () => {
    run("| stats count() by bucket(started, 1d)");
    expect(screen.getByRole("cell", { name: "2026-07-01 00:00" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2026-07-03 00:00" })).toBeInTheDocument();
  });

  it("draws a date histogram chronologically", () => {
    // Bucket order defaults to count descending — **except** for a date histogram, where
    // it is key ascending. "Largest bucket first" is meaningless for a time bucket, and a
    // line chart connects points in input order, so the exception is what stops a time
    // series from drawing as a zigzag.
    const result = run("| stats count() by bucket(started, 1d)");
    const keys = (result.buckets ?? []).map((bucket) => bucket.key[0]?.value);
    expect(keys).toEqual([...keys].sort((a, b) => Number(a) - Number(b)));
    // And the larger bucket is not first, which is what count-descending would have given.
    expect(result.buckets?.[0]?.n).toBe(2);
  });

  it("labels the grand-total bucket rather than leaving it blank", () => {
    run("| stats count()");
    expect(screen.getByRole("cell", { name: "all runs" })).toBeInTheDocument();
  });

  it("renders a bucket whose documents all lack the key as absent", () => {
    run("| stats count() by preset, cap.subagents");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("distributions", () => {
  it("shows the five-number summary, and no confidence interval", () => {
    // `dist()` deliberately carries no CI: reproducing a seeded bootstrap bit-for-bit
    // across two implementations is the most drift-prone construct that could enter a
    // mirrored evaluator, for a decoration on an exploratory chart.
    run("| stats dist(score) by preset");
    expect(row("planning").join(" ")).toContain("0.4 · 0.5 · 0.6 · 0.7 · 0.8");
  });
});

describe("empty results", () => {
  it("says nothing matched rather than rendering an empty grid", () => {
    run("preset:absent | stats count() by preset");
    expect(screen.getByText("No run matches this query.")).toBeInTheDocument();
  });
});
