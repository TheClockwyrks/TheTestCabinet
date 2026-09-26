// Compiling a board's panels: the board's range wins, and a date histogram is retuned
// to it.
//
// Both properties exist because the board owns the range and the panel does not. A panel
// that kept its own window would make a board a collection of unrelated figures, and a
// panel whose histogram width was frozen in its text would draw a single point under a
// "last 24 hours" board — TCQ has no `auto` interval to fall back on, deliberately, so the
// board applies the picker's.
import { describe, expect, it } from "vitest";
import { compilePanels } from "./dashboardQueries";
import { TIME_RANGES, rangeById } from "../discover/TimeRangePicker";

const NOW = Date.UTC(2026, 7, 1, 12);

const panel = (query: string) => ({ title: "p", query, width: 6 });

describe("compilePanels", () => {
  it("ANDs the board's range onto every panel's own filter", () => {
    const range = rangeById("30d");
    const [scoped, unfiltered] = compilePanels(
      [panel("state:completed"), panel("")],
      range,
      NOW,
    );

    // The panel keeps its clause; the range is an additional bound, not a replacement.
    expect(scoped?.query.filter).toEqual({
      kind: "and",
      clauses: [
        { kind: "range", field: "started", from: NOW - 2_592_000_000 },
        { kind: "compare", field: "state", op: "eq", value: "completed" },
      ],
    });
    // A panel with no filter of its own gets the range alone rather than an `and` of one.
    expect(unfiltered?.query.filter).toEqual({
      kind: "range",
      field: "started",
      from: NOW - 2_592_000_000,
    });
  });

  it("leaves an unbounded board's panels unscoped", () => {
    const [only] = compilePanels([panel("state:hung")], rangeById("all"), NOW);
    expect(only?.query.filter).toEqual({
      kind: "compare",
      field: "state",
      op: "eq",
      value: "hung",
    });
  });

  it("retunes the leading date histogram to the range's interval", () => {
    // The text says `1d`; a 24-hour board would draw that as one point.
    const [only] = compilePanels(
      [panel("| stats count() by bucket(started, 1d)")],
      rangeById("24h"),
      NOW,
    );
    expect(only?.query.stats?.groupBy?.[0]).toEqual({
      kind: "bucket",
      field: "started",
      interval: { count: 1, unit: "hour" },
    });
    // `groupBy` is surfaced on the compiled panel too — it is what tells the
    // visualization a time series from a bar chart.
    expect(only?.groupBy?.[0]).toEqual(only?.query.stats?.groupBy?.[0]);
  });

  it("does not retune a non-date bucket, or a date bucket that is not the first key", () => {
    const [duration, secondary] = compilePanels(
      [
        panel("| stats count() by bucket(metric.runTimeSeconds, 15m)"),
        panel("| stats count() by model, bucket(started, 1w)"),
      ],
      rangeById("24h"),
      NOW,
    );
    // A non-date histogram's width has nothing to do with how far back the board looks —
    // an interval is always spelled in time units, so only the *field* can tell the two
    // apart, which is exactly what the guard reads.
    expect(duration?.query.stats?.groupBy?.[0]).toEqual({
      kind: "bucket",
      field: "metric.runTimeSeconds",
      interval: { count: 15, unit: "minute" },
    });
    // Only the first key binds a chart's x-axis; a trailing bucket is a deliberate
    // cross-tabulation whose width the author chose.
    expect(secondary?.query.stats?.groupBy?.[1]).toEqual({
      kind: "bucket",
      field: "started",
      interval: { count: 1, unit: "week" },
    });
  });

  it("keeps a panel that failed to parse, in place, with its diagnostics", () => {
    // Render order is the only binding between a panel and its answer in a batched
    // response, so a broken panel is never dropped — it is reported.
    const compiled = compilePanels(
      [panel("| stats"), panel("state:completed")],
      rangeById("all"),
      NOW,
    );
    expect(compiled).toHaveLength(2);
    expect(compiled[0]?.errors.length).toBeGreaterThan(0);
    expect(compiled[1]?.errors).toEqual([]);
  });

  it("resolves every panel's range against one injected instant", () => {
    // Eight panels each calling `Date.now()` would each get a marginally different
    // window — invisible, and wrong.
    const compiled = compilePanels(
      [panel(""), panel(""), panel("")],
      rangeById("7d"),
      NOW,
    );
    const froms = compiled.map((entry) =>
      entry.query.filter?.kind === "range" ? entry.query.filter.from : null,
    );
    expect(new Set(froms).size).toBe(1);
  });

  it("offers a histogram interval for every range the picker has", () => {
    // The retune is only sound because every preset carries an explicit interval; a
    // range without one would silently leave the text's width in place.
    for (const range of TIME_RANGES) {
      expect(range.interval.count).toBeGreaterThan(0);
    }
  });
});
