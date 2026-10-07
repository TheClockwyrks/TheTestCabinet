import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@clockwyrks/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { reduceGgEvents } from "./useGgRunState";
import { CompactionView } from "./CompactionView";

const TS = "2026-07-26T00:00:00Z";

// Wrap a gg telemetry payload in the HarnessEvent envelope the stream delivers.
function gg(kind: GgTelemetryKind): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId: "root",
      ...kind,
    } as GgTelemetryEvent,
  };
}

// A compaction event carrying the full recorded detail (strategy, pre/post
// composition, and the summary text) the Compaction view reads.
function compaction(over: Partial<GgTelemetryKind> = {}): HarnessEvent {
  return gg({
    type: "compaction",
    strategy: "self-summarization",
    triggerFullness: 0.85,
    beforeTokens: 1000,
    afterTokens: 250,
    summaryTokens: 120,
    retained: { skills: 2, tasks: 3, memories: 1, issues: 0 },
    beforeBySource: [
      { source: "system", tokens: 50 },
      { source: "assistant", tokens: 600 },
      { source: "tool_output", tokens: 350 },
    ],
    afterBySource: [
      { source: "system", tokens: 50 },
      { source: "history", tokens: 120 },
    ],
    summary: "Building: a maze game\nNext step: add scoring",
    summaryFallback: false,
    ...over,
  } as GgTelemetryKind);
}

describe("compaction reducer fold", () => {
  it("carries the strategy, summary, fallback flag, and pre/post composition", () => {
    const state = reduceGgEvents([
      gg({ type: "session_started" } as GgTelemetryKind),
      compaction(),
    ]);
    expect(state.compactions).toHaveLength(1);
    const c = state.compactions[0];
    if (!c) throw new Error("expected a compaction boundary");
    expect(c.strategy).toBe("self-summarization");
    expect(c.summary).toContain("Building: a maze game");
    expect(c.summaryFallback).toBe(false);
    expect(c.beforeBySource).toHaveLength(3);
    expect(c.afterBySource).toHaveLength(2);
    expect(c.beforeTokens).toBe(1000);
    expect(c.afterTokens).toBe(250);
  });
});

describe("CompactionView", () => {
  it("renders each boundary's strategy, reclaim, and summary text", () => {
    const state = reduceGgEvents([compaction()]);
    render(<CompactionView compactions={state.compactions} />);
    expect(screen.getByText("Self-summarization")).toBeInTheDocument();
    // 1000 -> 250 reclaims 75%.
    expect(screen.getByText(/reclaimed 75%/)).toBeInTheDocument();
    expect(screen.getByText(/Building: a maze game/)).toBeInTheDocument();
  });

  it("flags a fallback summary", () => {
    const state = reduceGgEvents([
      compaction({ summaryFallback: true } as Partial<GgTelemetryKind>),
    ]);
    render(<CompactionView compactions={state.compactions} />);
    expect(screen.getByText(/Summarization failed/)).toBeInTheDocument();
  });

  it("shows an empty state with no compactions", () => {
    render(<CompactionView compactions={[]} />);
    expect(screen.getByText(/No compactions yet/)).toBeInTheDocument();
  });
});
