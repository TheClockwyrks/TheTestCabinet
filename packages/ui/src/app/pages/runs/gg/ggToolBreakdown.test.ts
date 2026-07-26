import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import {
  ggPeakContext,
  ggToolBreakdown,
  reduceGgEvents,
} from "./useGgRunState";

const TS = "2026-07-26T00:00:00Z";

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

describe("ggToolBreakdown", () => {
  it("counts calls from the feed and attributes result tokens from the message log", () => {
    const state = reduceGgEvents([
      gg({ type: "session_started" } as GgTelemetryKind),
      // Three tool calls in the feed: read_file twice, shell once.
      gg({ type: "tool_call", name: "read_file", args: {} } as GgTelemetryKind),
      gg({ type: "tool_call", name: "read_file", args: {} } as GgTelemetryKind),
      gg({ type: "tool_call", name: "shell", args: {} } as GgTelemetryKind),
      // The message log: an assistant turn naming those calls by id, then the tool
      // results that answer them (the tokens each tool's output added to the window).
      gg({
        type: "context_message",
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "read_file", args: {} },
          { id: "c2", name: "read_file", args: {} },
        ],
        images: [],
        tokens: 5,
      } as GgTelemetryKind),
      gg({
        type: "context_message",
        id: "t1",
        role: "tool",
        content: "…",
        toolCalls: [],
        toolCallId: "c1",
        images: [],
        tokens: 100,
      } as GgTelemetryKind),
      gg({
        type: "context_message",
        id: "t2",
        role: "tool",
        content: "…",
        toolCalls: [],
        toolCallId: "c2",
        images: [],
        tokens: 50,
      } as GgTelemetryKind),
      gg({
        type: "context_message",
        id: "a2",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c3", name: "shell", args: {} }],
        images: [],
        tokens: 5,
      } as GgTelemetryKind),
      gg({
        type: "context_message",
        id: "t3",
        role: "tool",
        content: "…",
        toolCallId: "c3",
        toolCalls: [],
        images: [],
        tokens: 30,
      } as GgTelemetryKind),
    ]);

    const breakdown = ggToolBreakdown(state);
    expect(breakdown.outputTokensKnown).toBe(true);
    // Total distinct context material = every pooled message's tokens.
    expect(breakdown.totalContextTokens).toBe(5 + 100 + 50 + 5 + 30);
    // Most-called first: read_file (2 calls, 150 result tokens), then shell (1, 30).
    expect(breakdown.tools).toEqual([
      { name: "read_file", calls: 2, outputTokens: 150 },
      { name: "shell", calls: 1, outputTokens: 30 },
    ]);
    expect(breakdown.totalCalls).toBe(3);
  });

  it("counts calls even with the message log off, marking output tokens unknown", () => {
    const state = reduceGgEvents([
      gg({ type: "session_started" } as GgTelemetryKind),
      gg({
        type: "tool_call",
        name: "write_file",
        args: {},
      } as GgTelemetryKind),
      gg({
        type: "tool_call",
        name: "write_file",
        args: {},
      } as GgTelemetryKind),
    ]);
    const breakdown = ggToolBreakdown(state);
    // No pool → per-tool result tokens can't be attributed, but calls still count.
    expect(breakdown.outputTokensKnown).toBe(false);
    expect(breakdown.totalContextTokens).toBe(0);
    expect(breakdown.tools).toEqual([
      { name: "write_file", calls: 2, outputTokens: 0 },
    ]);
  });
});

describe("ggPeakContext", () => {
  it("reports the high-water mark of tokens and fullness across the run", () => {
    const state = reduceGgEvents([
      gg({ type: "session_started" } as GgTelemetryKind),
      gg({
        type: "context_breakdown",
        bySource: [],
        totalTokens: 600,
        windowLimit: 1000,
        fullness: 0.6,
      } as GgTelemetryKind),
      gg({
        type: "context_breakdown",
        bySource: [],
        totalTokens: 900,
        windowLimit: 1000,
        fullness: 0.9,
      } as GgTelemetryKind),
      // A drop (e.g. a compaction reclaim) does not lower the peak already reached.
      gg({
        type: "context_breakdown",
        bySource: [],
        totalTokens: 300,
        windowLimit: 1000,
        fullness: 0.3,
      } as GgTelemetryKind),
    ]);
    const peak = ggPeakContext(state);
    expect(peak).toEqual({ tokens: 900, fullness: 0.9 });
  });

  it("is null when no breakdown snapshot ever arrived", () => {
    const state = reduceGgEvents([
      gg({ type: "session_started" } as GgTelemetryKind),
    ]);
    expect(ggPeakContext(state)).toBeNull();
  });
});
