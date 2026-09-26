import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { describe, expect, it } from "vitest";
import { meanBars, runBars } from "./MetricChartWidget";

// A run summary carrying only the fields the bar builders read: its id, its
// subject's harness + model, and whatever the `value` accessor pulls out. The id
// is generated so every run in a fixture is distinguishable — a mean bar now
// keeps its observations, and two runs sharing an id would hide a fold bug.
let nextRunId = 0;
function run(harnessSlug: string, modelId: string, tokens: number): RunSummary {
  nextRunId += 1;
  return {
    id: `run-${nextRunId}`,
    subject: { harnessSlug, modelId },
    metrics: { tokens },
  } as unknown as RunSummary;
}

const value = (r: RunSummary): number | null =>
  (r.metrics as unknown as { tokens: number }).tokens;
const fmt = (v: number): string => String(v);

describe("meanBars — the harness split", () => {
  it("keeps the same model under two harnesses as two separate bars", () => {
    // The whole point of the feature: a model run under two harnesses is two
    // different things and must never merge into one average.
    const bars = meanBars(
      [
        run("pi", "anthropic/claude-opus-4.8", 300),
        run("kilo", "anthropic/claude-opus-4.8", 3000),
      ],
      value,
      fmt,
    );
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.label).sort()).toEqual([
      "anthropic/claude-opus-4.8 · kilo",
      "anthropic/claude-opus-4.8 · pi",
    ]);
    // Each bar is that arm's own mean, never a blended 1650.
    const byLabel = new Map(bars.map((b) => [b.label, b.value]));
    expect(byLabel.get("anthropic/claude-opus-4.8 · pi")).toBe(300);
    expect(byLabel.get("anthropic/claude-opus-4.8 · kilo")).toBe(3000);
  });

  it("averages the runs of one (harness, model) pair into a single bar", () => {
    const bars = meanBars(
      [
        run("pi", "anthropic/claude-opus-4.8", 200),
        run("pi", "anthropic/claude-opus-4.8", 400),
      ],
      value,
      fmt,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]?.value).toBe(300);
  });

  it("canonicalizes the model id (harness-aware) before grouping", () => {
    // An `openrouter/`-prefixed id and a `:tag` on an OpenRouter harness are the
    // same model; they fold into one bar for that harness.
    const bars = meanBars(
      [
        run("kilo", "openrouter/anthropic/claude-opus-4.8:free", 1000),
        run("kilo", "anthropic/claude-opus-4.8", 2000),
      ],
      value,
      fmt,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]?.label).toBe("anthropic/claude-opus-4.8 · kilo");
    expect(bars[0]?.value).toBe(1500);
  });

  it("colors and labels via the model-keyed callbacks", () => {
    const bars = meanBars(
      [run("pi", "anthropic/claude-opus-4.8", 300)],
      value,
      fmt,
      {
        colorForModel: (id) =>
          id === "anthropic/claude-opus-4.8" ? "#abc" : null,
        labelForModel: (id) =>
          id === "anthropic/claude-opus-4.8" ? "Opus 4.8" : null,
      },
    );
    expect(bars[0]?.color).toBe("#abc");
    expect(bars[0]?.label).toBe("Opus 4.8 · pi");
  });
});

describe("meanBars — the subgroup split", () => {
  // The optional extra grouping axis: the metrics tab passes the run's engine
  // when a case's charts are widened across engines.
  const engineOf = (r: RunSummary) => {
    const slug =
      (r.subject as unknown as { engineSlug?: string }).engineSlug ?? "none";
    return { key: slug, label: slug === "none" ? "None" : slug };
  };
  const withEngine = (
    harness: string,
    model: string,
    engineSlug: string,
    tokens: number,
  ): RunSummary =>
    ({
      subject: { harnessSlug: harness, modelId: model, engineSlug },
      metrics: { tokens },
    }) as unknown as RunSummary;

  it("keeps one pair's runs under two subgroups as two labelled bars", () => {
    // Runs under different engines measure different work, so a widened chart
    // splits them per engine rather than blending a 300/3000 mean.
    const bars = meanBars(
      [
        withEngine("pi", "anthropic/claude-opus-4.8", "none", 300),
        withEngine("pi", "anthropic/claude-opus-4.8", "simple-2d", 3000),
      ],
      value,
      fmt,
      { subgroup: engineOf },
    );
    expect(bars).toHaveLength(2);
    const byLabel = new Map(bars.map((b) => [b.label, b.value]));
    expect(byLabel.get("anthropic/claude-opus-4.8 · pi · None")).toBe(300);
    expect(byLabel.get("anthropic/claude-opus-4.8 · pi · simple-2d")).toBe(
      3000,
    );
  });

  it("still averages runs sharing the pair AND the subgroup", () => {
    const bars = meanBars(
      [
        withEngine("pi", "anthropic/claude-opus-4.8", "simple-2d", 200),
        withEngine("pi", "anthropic/claude-opus-4.8", "simple-2d", 400),
      ],
      value,
      fmt,
      { subgroup: engineOf },
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]?.label).toBe("anthropic/claude-opus-4.8 · pi · simple-2d");
    expect(bars[0]?.value).toBe(300);
  });
});

describe("runBars — the harness split", () => {
  it("labels every per-run bar with its (model, harness) pair", () => {
    const bars = runBars(
      [
        run("pi", "anthropic/claude-opus-4.8", 300),
        run("kilo", "anthropic/claude-opus-4.8", 3000),
      ],
      value,
      fmt,
    );
    expect(bars.map((b) => b.label)).toEqual([
      "anthropic/claude-opus-4.8 · pi",
      "anthropic/claude-opus-4.8 · kilo",
    ]);
  });

  it("drops a run whose value is unknown rather than plotting a zero bar", () => {
    const bars = runBars(
      [run("pi", "anthropic/claude-opus-4.8", 300)],
      () => null,
      fmt,
    );
    expect(bars).toHaveLength(0);
  });
});

describe("meanBars — the runs behind the mean", () => {
  it("keeps every observation a bar averaged, in fold order", () => {
    // The bar height alone cannot produce a box plot or a scatter. Folding the
    // runs away is what used to make both impossible.
    const runs = [
      run("pi", "alpha", 1),
      run("pi", "alpha", 2),
      run("pi", "alpha", 9),
    ];
    const [bar] = meanBars(runs, value, fmt);
    expect(bar?.value).toBe(4);
    expect(bar?.distribution?.points.map((p) => p.value)).toEqual([1, 2, 9]);
    expect(bar?.distribution?.points.map((p) => p.runId)).toEqual(
      runs.map((r) => r.id),
    );
  });

  it("summarizes the bar on the repository's quartile convention", () => {
    const [bar] = meanBars(
      [run("pi", "alpha", 1), run("pi", "alpha", 2), run("pi", "alpha", 9)],
      value,
      fmt,
    );
    expect(bar?.distribution).toMatchObject({
      n: 3,
      mean: 4,
      median: 2,
      min: 1,
      max: 9,
      q1: 1.5,
      q3: 5.5,
    });
  });

  it("splits the observations by the same fold key the bars use", () => {
    // Two harnesses of one model are two bars, so they are also two samples —
    // a shared observation list would be the merged average by another route.
    const bars = meanBars(
      [run("pi", "alpha", 10), run("kilo", "alpha", 20)],
      value,
      fmt,
    );
    expect(bars.map((b) => b.distribution?.points.map((p) => p.value))).toEqual(
      [[10], [20]],
    );
  });

  it("states the spread in the bar's tooltip, alongside n", () => {
    const [bar] = meanBars(
      [run("pi", "alpha", 1), run("pi", "alpha", 2), run("pi", "alpha", 9)],
      value,
      fmt,
    );
    expect(bar?.title).toBe(
      [
        "alpha · pi · 3 runs",
        "Mean: 4",
        "Median: 2",
        "IQR: 1.5 – 5.5",
        "Range: 1 – 9",
      ].join("\n"),
    );
  });

  it("says a one-run bar is one run and claims no spread for it", () => {
    // At n = 1 the distribution collapses to a point. Printing "Median" and
    // "Range" over one observation would dress a single number up as a summary.
    const [bar] = meanBars([run("pi", "alpha", 7)], value, fmt);
    expect(bar?.title).toBe("alpha · pi · 1 run\n7");
    expect(bar?.distribution).toMatchObject({
      n: 1,
      mean: 7,
      median: 7,
      min: 7,
      max: 7,
      q1: 7,
      q3: 7,
    });
  });

  it("identifies each observation for its own tooltip and links it", () => {
    const runs = [run("pi", "alpha", 2), run("pi", "alpha", 4)];
    const [bar] = meanBars(runs, value, fmt, {
      runHref: (r) => `/runs/${r.id}`,
      describeRun: (r) => `started ${r.id}`,
    });
    const [first] = bar?.distribution?.points ?? [];
    expect(first?.href).toBe(`/runs/${runs[0]!.id}`);
    expect(first?.title).toBe(
      [
        "alpha · pi",
        "2",
        `started ${runs[0]!.id}`,
        "Group mean: 3 · 2 runs",
        `run ${runs[0]!.id}`,
      ].join("\n"),
    );
  });

  it("leaves a run whose value is unknown out of the sample entirely", () => {
    // Excluded from the mean AND from the points, so a dropped run cannot
    // reappear in the scatter as a zero.
    const bars = meanBars(
      [run("pi", "alpha", 4), run("pi", "alpha", 8)],
      (r) => (value(r) === 4 ? null : value(r)),
      fmt,
    );
    expect(bars[0]?.distribution?.points.map((p) => p.value)).toEqual([8]);
    expect(bars[0]?.distribution?.n).toBe(1);
  });
});

describe("runBars — no fabricated spread", () => {
  it("gives a per-run bar no distribution", () => {
    // A bar that IS one observation has nothing behind it. Asserting a spread
    // of zero would be a claim the data does not make.
    const bars = runBars([run("pi", "alpha", 300)], value, fmt);
    expect(bars[0]?.distribution).toBeUndefined();
  });
});
