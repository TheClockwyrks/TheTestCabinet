// The visualization panel, rendered.
//
// `viz.test.ts` covers which form a result gets; this suite covers the two things
// only a rendered figure can prove:
//
// - **A date histogram draws chronologically**, which is asserted off the drawn
//   polyline's geometry rather than off the data behind it. A mark whose data is in
//   the right order can still be drawn in the wrong one, so reading the `d`
//   attribute is the only assertion that cannot be satisfied by accident.
// - **What the chart declined to draw is on screen**, in words, above a table that
//   still has every row.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  GgBucket,
  GgGroupKey,
  GgRunDoc,
} from "@test-cabinet/run-record/gg-query";
import { compileQuery, evaluate, parseQuery } from "../query";
import { GgVizPanel } from "./GgVizPanel";

const day = (n: number, hour = 0) => Date.UTC(2026, 6, n, hour);

const CORPUS: GgRunDoc[] = [
  { fields: { id: "a", started: day(1, 1), preset: "planning", score: 0.8 } },
  { fields: { id: "b", started: day(1, 5), preset: "planning", score: 0.4 } },
  { fields: { id: "c", started: day(2, 3), preset: "baseline", score: 0.6 } },
  { fields: { id: "d", started: day(5, 9), preset: "baseline", score: 0.2 } },
  { fields: { id: "e", started: day(5, 2), preset: "planning", score: 1 } },
  { fields: { id: "f", started: day(9, 8), preset: "baseline", score: 0.5 } },
];

/** Evaluate query text and render the panel it produces. */
function draw(text: string) {
  const query = compileQuery(parseQuery(text).query);
  const result = evaluate(CORPUS, query);
  return render(
    <GgVizPanel
      buckets={result.buckets ?? []}
      columns={result.columns ?? []}
      groupBy={query.stats?.groupBy}
    />,
  );
}

/** The x coordinates of each drawn polyline, in the order the path visits them. */
function lineXs(container: HTMLElement): number[][] {
  return [...container.querySelectorAll('[aria-label="line"] path')].map((path) => {
    const d = path.getAttribute("d") ?? "";
    return [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1]));
  });
}

describe("a date histogram", () => {
  it("draws left to right in time, with no zigzag", () => {
    const { container } = draw("| stats count() by bucket(started, 1d)");
    const [xs] = lineXs(container);
    expect(xs?.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < xs!.length; i += 1) {
      expect(xs![i]).toBeGreaterThan(xs![i - 1]!);
    }
  });

  it("still draws left to right when the buckets arrive count descending", () => {
    // The evaluator returns a date histogram key-ascending precisely so a line chart
    // reads as a time series. This proves the chart does not *depend* on that: hand
    // it the count-descending order every other group key gets and the polyline is
    // still chronological, because the key stayed an instant rather than becoming a
    // formatted label on a categorical axis.
    const histogram: GgGroupKey[] = [
      { kind: "bucket", field: "started", interval: { count: 1, unit: "day" } },
    ];
    const shuffled: GgBucket[] = [
      { key: [{ field: "started", value: day(9) }], n: 9, values: [count(9)] },
      { key: [{ field: "started", value: day(1) }], n: 5, values: [count(5)] },
      { key: [{ field: "started", value: day(5) }], n: 3, values: [count(3)] },
      { key: [{ field: "started", value: day(2) }], n: 1, values: [count(1)] },
    ];
    const { container } = render(
      <GgVizPanel
        buckets={shuffled}
        columns={[{ name: "count()", func: "count" }]}
        groupBy={histogram}
      />,
    );
    const [xs] = lineXs(container);
    expect(xs).toHaveLength(4);
    for (let i = 1; i < xs!.length; i += 1) {
      expect(xs![i]).toBeGreaterThan(xs![i - 1]!);
    }
  });

  function count(n: number) {
    return { name: "count()", contributing: n, value: n };
  }
});

describe("the panel's framing", () => {
  it("titles the chart with the aggregation and its group key", () => {
    draw("| stats avg(score) by preset");
    expect(screen.getByText("avg(score) by preset")).toBeInTheDocument();
  });

  it("renders a single figure as a labelled tile rather than a chart", () => {
    const { container } = draw("| stats count()");
    expect(screen.getByText("count()")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("says what it left out, and points at the table", () => {
    // One preset has runs but no value for this field, so its bucket is dropped from
    // the chart — and the panel has to say so rather than show a shorter chart.
    const query = compileQuery(
      parseQuery("| stats avg(score) by preset").query,
    );
    const result = evaluate(CORPUS, query);
    const buckets = (result.buckets ?? []).map((bucket, i) =>
      i === 0
        ? { ...bucket, values: [{ name: "avg(score)", contributing: 0 }] }
        : bucket,
    );
    render(
      <GgVizPanel
        buckets={buckets}
        columns={result.columns ?? []}
        groupBy={query.stats?.groupBy}
      />,
    );
    const note = screen.getByText(/never charted as zero/);
    expect(note.textContent).toContain("1 bucket had no value");
    expect(note.textContent).toContain("the table below has every row");
  });

  it("carries no apologetic subtitle when it drew everything", () => {
    draw("| stats avg(score) by preset");
    expect(screen.queryByText(/never charted as zero/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not drawn/)).not.toBeInTheDocument();
  });

  it("renders nothing at all for an un-aggregated result", () => {
    const { container } = draw("preset:planning");
    expect(container).toBeEmptyDOMElement();
  });
});
