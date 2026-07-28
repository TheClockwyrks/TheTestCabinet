import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  METRICS,
  RequestMetricsGraphs,
  tooltipFor,
  type MetricDef,
} from "./RequestMetricsGraphs";
import type { PromptTurn } from "./useGgRunState";

const metric = (key: string): MetricDef => METRICS.find((m) => m.key === key)!;

function prompt(
  turn: number,
  tokens: Partial<PromptTurn["tokens"]> = {},
  extra: Partial<PromptTurn> = {},
): PromptTurn {
  return {
    turn,
    request: [],
    totalTokens: 0,
    responseId: null,
    finishReason: "stop",
    tokens: {
      uncachedInput: null,
      cachedInput: null,
      output: null,
      reasoning: null,
      ...tokens,
    },
    cost: null,
    durationMs: null,
    ...extra,
  };
}

// The tooltip a metric would show for a request, or "" when the request has no
// datum for it — the same skip the graph makes.
function tipFor(key: string, p: PromptTurn): string {
  const def = metric(key);
  const value = def.value(p);
  return value == null ? "" : tooltipFor(def, p, value);
}

describe("tooltipFor", () => {
  it("leads with the turn, which is what ties the point to the other graphs", () => {
    const tip = tipFor(
      "throughput",
      prompt(9, { output: 1_200, reasoning: 300 }, { durationMs: 15_000 }),
    );
    expect(tip.split("\n")[0]).toBe("Turn 9 — 100 tok/s");
  });

  it("gives throughput's two halves — what was generated, and over how long", () => {
    const tip = tipFor(
      "throughput",
      prompt(2, { output: 1_200, reasoning: 300 }, { durationMs: 15_000 }),
    );
    expect(tip).toContain("1,500 tokens in 15.0 s");
  });

  it("says what a request's price was charged for", () => {
    const tip = tipFor(
      "cost",
      prompt(
        4,
        { cachedInput: 30_000, uncachedInput: 2_000, output: 800 },
        { cost: { comparable: 0.041, actual: 0.041 } },
      ),
    );
    expect(tip).toContain("Turn 4 — $0.0410");
    expect(tip).toContain("32,000 tokens in, 800 tokens out");
    // The two figures agree, so there is nothing to distinguish.
    expect(tip).not.toContain("provider charged");
  });

  it("names the provider's own figure when it differs from the plotted one", () => {
    const tip = tipFor(
      "cost",
      prompt(5, { output: 100 }, { cost: { comparable: 0.05, actual: 0.03 } }),
    );
    // The point plots the comparable figure; the tip keeps it from being read as
    // the invoice.
    expect(tip).toContain("Turn 5 — $0.0500");
    expect(tip).toContain("the provider charged $0.0300");
  });

  it("gives a share's numerator and denominator, which the share alone hides", () => {
    const cache = tipFor(
      "cacheRead",
      prompt(7, { cachedInput: 45_000, uncachedInput: 5_000 }),
    );
    expect(cache).toContain("Turn 7 — 90%");
    expect(cache).toContain("45,000 cached of 50,000 tokens sent");

    const reasoning = tipFor(
      "reasoning",
      prompt(7, { output: 750, reasoning: 250 }),
    );
    expect(reasoning).toContain("Turn 7 — 25%");
    expect(reasoning).toContain("250 reasoning of 1,000 tokens generated");
  });

  it("counts a request that cached nothing as 0%, with its figures intact", () => {
    const tip = tipFor("cacheRead", prompt(1, { uncachedInput: 8_000 }));
    expect(tip).toContain("Turn 1 — 0%");
    expect(tip).toContain("0 cached of 8,000 tokens sent");
  });
});

describe("RequestMetricsGraphs", () => {
  it("says so plainly when the run has neither requests nor timings", () => {
    render(<RequestMetricsGraphs prompts={[]} />);
    expect(screen.getByText(/No requests yet/)).toBeInTheDocument();
  });

  it("draws a card per metric, each headed by its run-level figure", () => {
    render(
      <RequestMetricsGraphs
        prompts={[
          prompt(
            0,
            { cachedInput: 9_000, uncachedInput: 1_000, output: 500 },
            { durationMs: 5_000, cost: { comparable: 0.02, actual: 0.02 } },
          ),
        ]}
      />,
    );
    for (const m of METRICS) {
      expect(screen.getByText(m.label)).toBeInTheDocument();
    }
    // The cache-read chip is the run-level aggregate (9k of 10k input). The charts'
    // own axis ticks read as percentages too, so match the chips by their class.
    const chips = [
      ...document.querySelectorAll('[class*="metricCardLatest"]'),
    ].map((el) => el.textContent);
    expect(chips).toContain("90%");
  });
});
