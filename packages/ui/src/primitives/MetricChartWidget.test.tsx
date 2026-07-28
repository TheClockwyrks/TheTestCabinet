import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { describe, expect, it } from "vitest";
import { meanBars, runBars } from "./MetricChartWidget";

// A run summary carrying only the fields the bar builders read: its subject's
// harness + model, and whatever the `value` accessor pulls out.
function run(harnessSlug: string, modelId: string, tokens: number): RunSummary {
  return {
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
      (id) => (id === "anthropic/claude-opus-4.8" ? "#abc" : null),
      (id) => (id === "anthropic/claude-opus-4.8" ? "Opus 4.8" : null),
    );
    expect(bars[0]?.color).toBe("#abc");
    expect(bars[0]?.label).toBe("Opus 4.8 · pi");
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
