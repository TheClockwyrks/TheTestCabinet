// The document view.
//
// The property this file exists for is the one the whole document model was reshaped
// around: **a metric is absent, never zero, on a run that produced nothing**. A failure
// record carries default metrics — zero seconds, no tokens, no cost — and flattening those
// naively would drag every average toward zero with exactly the runs that burned the most
// budget, *and* drop the longest runs out of a long-run filter. The evaluator keeps that
// promise; a table that printed `0s` for an absent cell would give it straight back.
//
// So the table is driven through the real evaluator over a corpus with a timed-out run in
// it, rather than fed hand-written rows: the assertion is about what an operator sees at
// the end of the whole pipeline, not about a formatting helper in isolation.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { GgQuery, GgRunDoc } from "@clockwyrks/run-record/gg-query";
import { compileQuery, evaluate, parseQuery } from "../query";
import { GgDocTable, queryFields } from "./GgDocTable";

/** A run that finished and produced figures. */
function completed(id: string, runTimeSeconds: number): GgRunDoc {
  return {
    fields: {
      id,
      started: Date.UTC(2026, 6, 1, 12, 0),
      finished: Date.UTC(2026, 6, 1, 13, 0),
      state: "completed",
      case: "carom",
      model: "anthropic/claude-a",
      score: 0.75,
      "metric.runTimeSeconds": runTimeSeconds,
    },
  };
}

/**
 * A run that timed out and produced nothing.
 *
 * It carries **no** `metric.*` fields at all — which is exactly what `build_run_doc`
 * writes for a record whose metrics are the default-constructed zeros.
 */
const TIMED_OUT: GgRunDoc = {
  fields: {
    id: "run-timeout",
    started: Date.UTC(2026, 6, 1, 9, 0),
    state: "timed_out",
    case: "carom",
    model: "anthropic/claude-a",
  },
};

const CORPUS: GgRunDoc[] = [completed("run-long", 5400), completed("run-short", 42), TIMED_OUT];

/** Evaluate query text over the corpus and render what came back. */
function run(text: string) {
  const query: GgQuery = compileQuery(parseQuery(text).query);
  const result = evaluate(CORPUS, query);
  render(
    <MemoryRouter>
      <GgDocTable
        documents={result.documents ?? []}
        filter={query.filter}
        sort={query.sort}
      />
    </MemoryRouter>,
  );
  return result;
}

/** Every cell's text, so an assertion can be about the whole table rather than one row. */
function cells(): string[] {
  return screen.getAllByRole("cell").map((cell) => cell.textContent ?? "");
}

describe("absent is not zero", () => {
  it("shows no 0s row under a long-run filter", () => {
    // The headline. The run that timed out has no run time at all, so it must not appear
    // — and nothing in the table may render as a zero duration, which is what the old
    // default-constructed metric would have produced.
    const result = run("metric.runTimeSeconds >= 1800");
    expect(result.totalRuns).toBe(1);
    expect(cells()).not.toContain("0s");
    expect(screen.queryByText("run-timeout")).not.toBeInTheDocument();
    expect(screen.getByText("run-long")).toBeInTheDocument();
  });

  it("renders an absent metric as an em dash in the unfiltered view", () => {
    // The same run, with nothing filtering it out: its run-time cell is empty of a
    // measurement, and says so.
    run("");
    expect(cells()).toContain("—");
    expect(cells()).not.toContain("0s");
  });

  it("still renders a stored zero as a zero", () => {
    // The distinction the whole rule rests on: absent and zero are different facts, and a
    // run that genuinely scored nothing scored nothing.
    render(
      <MemoryRouter>
        <GgDocTable documents={[{ fields: { id: "r", score: 0 } }]} />
      </MemoryRouter>,
    );
    expect(cells()).toContain("0.00");
  });
});

describe("columns", () => {
  it("shows the identity columns whatever the query", () => {
    run("");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["id", "started", "case", "model", "state", "score"]);
  });

  it("adds a column for every field the query filters on", () => {
    // Asking for `metric.runTimeSeconds >= 1800` and getting a table with no run-time
    // column is the oldest failure of a results grid.
    run("metric.runTimeSeconds >= 1800");
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toContain("metric.runTimeSeconds");
  });

  it("reads the fields off the compiled tree, through every combinator", () => {
    const query = compileQuery(
      parseQuery("not (tool.editFile:* or preset:a) and score >= 0.5 | sort limit").query,
    );
    expect(queryFields(query.filter, query.sort)).toEqual([
      "tool.editFile",
      "preset",
      "score",
      "limit",
    ]);
  });

  it("contributes no column for a clause that did not compile", () => {
    // A half-typed clause compiles to nothing — the surrounding query still runs — so it
    // must not conjure a column either.
    const query = compileQuery(parseQuery("score >= 0.5 and preset:").query);
    expect(queryFields(query.filter, query.sort)).toEqual(["score"]);
  });
});

describe("formatting", () => {
  it("renders a duration, a timestamp and a score in their own units", () => {
    run("metric.runTimeSeconds >= 1800");
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
    expect(screen.getByText("2026-07-01 12:00")).toBeInTheDocument();
    expect(screen.getByText("0.75")).toBeInTheDocument();
  });

  it("links every row to the run behind it", () => {
    // The bridge an aggregate cannot be: a query answers "what happened across runs", and
    // a row here opens the one run.
    run("");
    expect(screen.getByRole("link", { name: "run-long" })).toHaveAttribute(
      "href",
      "/runs/run-long",
    );
  });

  it("says so when nothing matched", () => {
    run("state:catastrophic");
    expect(screen.getByText("No run matches this query.")).toBeInTheDocument();
  });
});
