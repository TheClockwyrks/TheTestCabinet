import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  GgCapabilityConfig,
  GgCapabilitySet,
  GgContextSource,
  GgContextSourceUsage,
} from "@test-cabinet/run-record/gg";
import {
  ContextFillGraph,
  contextYMax,
  visibleSources,
} from "./ContextFillGraph";
import type { ContextSnapshot } from "./useGgRunState";

// The fixed source order gg always reports (zeros included).
const SOURCE_ORDER: GgContextSource[] = [
  "system",
  "user_prompt",
  "assistant",
  "tool_output",
  "file_view",
  "skill",
  "memory",
  "task_list",
  "board",
  "plan",
  "history",
];

function bySource(
  partial: Partial<Record<GgContextSource, number>>,
): GgContextSourceUsage[] {
  return SOURCE_ORDER.map((source) => ({
    source,
    tokens: partial[source] ?? 0,
  }));
}

function snapshot(
  turn: number,
  partial: Partial<Record<GgContextSource, number>>,
  windowLimit: number | undefined = 200_000,
): ContextSnapshot {
  const totalTokens = Object.values(partial).reduce((a, b) => a + b, 0);
  return {
    timestamp: `2026-07-24T00:00:0${turn}Z`,
    turn,
    bySource: bySource(partial),
    totalTokens,
    windowLimit,
    fullness: windowLimit ? totalTokens / windowLimit : undefined,
  };
}

function caps(ids: readonly string[]): GgCapabilitySet {
  const capabilities: GgCapabilityConfig[] = ids.map((id) => ({
    id,
    enabled: true,
    params: {},
  }));
  return { capabilities, slots: [{ slot: "primary", modelId: "mock/x" }] };
}

describe("contextYMax", () => {
  it("frames the plot to the peak plus headroom, not to the window", () => {
    // A run using a sliver of a million-token window must not draw as a flat line
    // along the axis: the scale follows the data.
    const series = [
      snapshot(1, { system: 1_000 }),
      snapshot(2, { system: 40 }),
    ];
    expect(contextYMax(series, 1_000_000)).toBe(1_250);
  });

  it("never frames above the window limit", () => {
    const series = [snapshot(1, { system: 90_000 })];
    expect(contextYMax(series, 100_000)).toBe(100_000);
  });

  it("falls back to the data when no window limit is known", () => {
    const series = [snapshot(1, { system: 800 }, undefined)];
    expect(contextYMax(series, null)).toBe(1_000);
  });

  it("never returns a degenerate zero top", () => {
    expect(contextYMax([], 200_000)).toBe(1);
  });
});

describe("visibleSources", () => {
  const series = [snapshot(1, { system: 1_000, assistant: 500 })];

  it("omits the sources whose capability the run disabled", () => {
    const visible = visibleSources(caps(["shell", "read-file"]), series);
    expect(visible).not.toContain("skill");
    expect(visible).not.toContain("memory");
    expect(visible).not.toContain("task_list");
    expect(visible).not.toContain("board");
    expect(visible).not.toContain("plan");
    // The unconditional sources — what any run is made of — always stay.
    expect(visible).toContain("system");
    expect(visible).toContain("assistant");
    expect(visible).toContain("history");
    // ...as does the one whose capability is on.
    expect(visible).toContain("file_view");
  });

  it("keeps a source whose capability is on", () => {
    expect(visibleSources(caps(["skills", "memories"]), series)).toContain(
      "skill",
    );
  });

  it("treats the legacy filesystem umbrella as read-file", () => {
    expect(visibleSources(caps(["filesystem"]), series)).toContain("file_view");
  });

  it("never hides a source that actually holds tokens", () => {
    // Hiding a band with tokens in it would drop it out of the stack and misstate
    // the total, so real material always wins over the configuration.
    const withSkill = [snapshot(1, { system: 1_000, skill: 300 })];
    expect(visibleSources(caps(["shell"]), withSkill)).toContain("skill");
  });

  it("shows every source until the capability set is known", () => {
    expect(visibleSources(null, series)).toHaveLength(SOURCE_ORDER.length);
  });
});

describe("ContextFillGraph", () => {
  it("lists only the enabled sources in the legend", () => {
    const series = [
      snapshot(1, { system: 1_000 }),
      snapshot(2, { system: 1_000, assistant: 400 }),
    ];
    render(
      <ContextFillGraph
        series={series}
        latest={series[1]!}
        capabilitySet={caps(["shell", "skills"])}
      />,
    );
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.queryByText("Memories")).not.toBeInTheDocument();
    expect(screen.queryByText("Task list")).not.toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });
});
