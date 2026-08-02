import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  CONTEXT_SOURCE_COLORS,
  CONTEXT_SOURCE_LABELS,
  CONTEXT_SOURCES,
  contextTooltip,
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
  "text_view",
  "skill",
  "memory",
  "task_list",
  "board",
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
  return { agents: [{ name: "Root", capabilities, modelId: "mock/x" }] };
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

  it("reads the named agent's own capabilities, not the Root's", () => {
    // The graph is one agent's window, so the capabilities that decide which bands
    // it can hold are that agent's. A task list enabled only on an implementer fills
    // that agent's window and nobody else's — reading the Root's configuration would
    // hide the band on exactly the agent that has it.
    const set = {
      agents: [
        {
          name: "Root",
          capabilities: [{ id: "shell", enabled: true, params: {} }],
          modelId: "mock/x",
        },
        {
          name: "Coder",
          capabilities: [{ id: "tasks", enabled: true, params: {} }],
          modelId: "mock/x",
        },
      ],
    } as GgCapabilitySet;
    expect(visibleSources(set, series, "Coder")).toContain("task_list");
    expect(visibleSources(set, series, "Root")).not.toContain("task_list");
    // An agent whose profile is not (yet) known falls back to the Root's.
    expect(visibleSources(set, series, null)).not.toContain("task_list");
  });
});

describe("contextTooltip", () => {
  const sources: GgContextSource[] = ["system", "assistant", "tool_output"];
  const snap = snapshot(
    12,
    { system: 3_000, assistant: 5_000, tool_output: 12_000 },
    100_000,
  );

  it("gives the whole turn's composition, not just the hovered band", () => {
    const tip = contextTooltip(snap, sources, "assistant");
    expect(tip).toContain("Turn 12 — 20,000 tokens");
    expect(tip).toContain("System: 3,000");
    expect(tip).toContain("Assistant: 5,000");
    expect(tip).toContain("Tool output: 12,000");
  });

  it("reports how full the window is, the signal compaction acts on", () => {
    expect(contextTooltip(snap, sources, "system")).toContain(
      "(20% of window)",
    );
  });

  it("omits the fullness when the run never reported a limit", () => {
    // A share of an unknown ceiling is not a figure. (Built by hand: `snapshot`'s
    // default limit applies to an explicit `undefined` too.)
    const noLimit: ContextSnapshot = {
      timestamp: "2026-07-24T00:00:03Z",
      turn: 3,
      bySource: bySource({ system: 500 }),
      totalTokens: 500,
    };
    expect(contextTooltip(noLimit, ["system"], "system")).not.toContain(
      "window",
    );
  });

  it("marks which band the pointer is on", () => {
    const tip = contextTooltip(snap, sources, "tool_output");
    expect(tip).toContain("▸ Tool output");
    expect(tip).not.toContain("▸ System");
  });

  it("reports each band's share of the turn", () => {
    const tip = contextTooltip(snap, sources, "system");
    expect(tip).toContain("Tool output: 12,000 (60%)");
    expect(tip).toContain("Assistant: 5,000 (25%)");
  });

  it("keeps the graph's fixed source order rather than sorting by size", () => {
    // The tip reads against the bands and the legend; re-sorting it under the
    // pointer would make the same window look different turn to turn.
    const tip = contextTooltip(snap, sources, "system");
    const rows = tip.split("\n").slice(1);
    expect(rows.map((r) => r.replace("▸", "").trim().split(":")[0])).toEqual([
      "System",
      "Assistant",
      "Tool output",
    ]);
  });

  it("omits shares for a turn holding nothing at all", () => {
    const empty = snapshot(0, {}, 100_000);
    const tip = contextTooltip(empty, ["system"], "system");
    expect(tip).toContain("System: 0");
    expect(tip).not.toContain("(NaN");
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

// The band tables are four parallel lists plus a fifth in SCSS, and only two of the five
// are type-checked against `GgContextSource`. These assertions cover the other three, which
// is where a new band goes wrong: silently, by taking its neighbour's hue.
describe("the band tables", () => {
  it("carries every context source the contract declares, in the contract's order", () => {
    // `SOURCE_ORDER` is this file's transcription of `GgContextSource::ALL`; the graph's own
    // list must be the same list, in the same order, since band order and palette index are
    // both keyed to position.
    expect([...CONTEXT_SOURCES]).toEqual(SOURCE_ORDER);
    expect(Object.keys(CONTEXT_SOURCE_LABELS)).toEqual(SOURCE_ORDER);
    expect(Object.keys(CONTEXT_SOURCE_COLORS)).toEqual(SOURCE_ORDER);
  });

  it("gives every band a hue of its own", () => {
    const hues = Object.values(CONTEXT_SOURCE_COLORS);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it("keeps the SCSS swatch palette in lockstep with the band colors", () => {
    // `$context-palette` is keyed by NUMERIC INDEX and nothing type-checks it, so a band
    // inserted anywhere but the end shifts every later swatch onto its neighbour's hue —
    // wrong colors, no error, in the legend the graph is read against. This is the check
    // that turns that into a failing test.
    // Read as source text, not imported: the test setup stubs SCSS modules to a class-name
    // proxy, and `new URL(…, import.meta.url)` is rewritten by Vite's asset handling, so the
    // path is composed by hand.
    const scss = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "GgPanels.module.scss"),
      "utf8",
    );
    const map = /\$context-palette:\s*\(([^)]*)\)/.exec(scss);
    expect(map).not.toBeNull();
    const entries = [...map![1]!.matchAll(/(\d+):\s*(#[0-9a-fA-F]{6})/g)].map(
      ([, index, color]) => [Number(index), color!.toLowerCase()] as const,
    );
    expect(entries.map(([index]) => index)).toEqual(
      CONTEXT_SOURCES.map((_, i) => i),
    );
    expect(entries.map(([, color]) => color)).toEqual(
      CONTEXT_SOURCES.map((source) =>
        CONTEXT_SOURCE_COLORS[source].toLowerCase(),
      ),
    );
  });

  it("shows agent views to a run with every capability withheld", () => {
    // `view.openText` is bound whatever the capability set says — a run with no tools at all
    // must still be able to show its model something — so the band is never filtered out for
    // want of a capability, unlike file views.
    const series = [snapshot(1, { system: 1_000 })];
    expect(visibleSources(caps([]), series)).toContain("text_view");
    expect(visibleSources(caps([]), series)).not.toContain("file_view");
  });

  it("names agent views apart from file views in the legend", () => {
    const series = [
      snapshot(1, { system: 1_000 }),
      snapshot(2, { system: 1_000, text_view: 400 }),
    ];
    render(
      <ContextFillGraph
        series={series}
        latest={series[1]!}
        capabilitySet={caps(["read-file"])}
      />,
    );
    expect(screen.getByText("Agent views")).toBeInTheDocument();
    expect(screen.getByText("File views")).toBeInTheDocument();
  });
});
