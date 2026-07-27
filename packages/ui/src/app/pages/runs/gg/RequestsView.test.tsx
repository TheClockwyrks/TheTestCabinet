import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { reduceGgEvents } from "./useGgRunState";
import { RequestsView } from "./RequestsView";

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

// The message-log stream for a two-turn run in which the system prompt and build prompt
// repeat across turns (defined once), turn 1's reply becomes turn 2's history, and each
// turn's prompt points into the pool.
function twoTurnStream(): HarnessEvent[] {
  return [
    gg({ type: "session_started" } as GgTelemetryKind),
    // Turn 1 definitions + prompt.
    gg({
      type: "context_message",
      id: "m_sys",
      role: "system",
      content: "you are gg",
      toolCalls: [],
      images: [],
      tokens: 10,
    } as GgTelemetryKind),
    gg({
      type: "context_message",
      id: "m_prompt",
      role: "user",
      content: "build a game",
      toolCalls: [],
      images: [],
      tokens: 20,
    } as GgTelemetryKind),
    gg({
      type: "context_message",
      id: "m_reply1",
      role: "assistant",
      content: "on it",
      toolCalls: [],
      images: [],
      tokens: 5,
    } as GgTelemetryKind),
    gg({
      type: "prompt",
      request: [
        { id: "m_sys", source: "system" },
        { id: "m_prompt", source: "user_prompt" },
      ],
      totalTokens: 30,
      responseId: "m_reply1",
      finishReason: "stop",
      tokens: { uncachedInput: 30, output: 5 },
    } as GgTelemetryKind),
    // Turn 2: reuse m_sys/m_prompt (no re-definition), reply1 now history; new reply.
    gg({
      type: "context_message",
      id: "m_reply2",
      role: "assistant",
      content: "done",
      toolCalls: [],
      images: [],
      tokens: 4,
    } as GgTelemetryKind),
    gg({
      type: "prompt",
      request: [
        { id: "m_sys", source: "system" },
        { id: "m_prompt", source: "user_prompt" },
        { id: "m_reply1", source: "assistant" },
      ],
      totalTokens: 35,
      responseId: "m_reply2",
      finishReason: "stop",
      tokens: { uncachedInput: 35, output: 4 },
    } as GgTelemetryKind),
  ];
}

describe("message log reduction", () => {
  it("pools each message once and records each turn's pointers", () => {
    const state = reduceGgEvents(twoTurnStream());
    // Four unique messages defined, keyed by id.
    expect(state.messagePool.size).toBe(4);
    expect(state.messagePool.get("m_sys")?.content).toBe("you are gg");
    expect(state.messagePool.get("m_reply1")?.role).toBe("assistant");
    // Two prompts, numbered by turn, pointing into the pool.
    expect(state.prompts).toHaveLength(2);
    expect(state.prompts[0]!.turn).toBe(0);
    expect(state.prompts[0]!.request.map((r) => r.id)).toEqual([
      "m_sys",
      "m_prompt",
    ]);
    expect(state.prompts[0]!.responseId).toBe("m_reply1");
    expect(state.prompts[1]!.request).toHaveLength(3);
    // Turn 2 references turn 1's reply by its unchanged id — no re-definition.
    expect(state.prompts[1]!.request[2]!.id).toBe("m_reply1");
  });

  it("empty when the stream carries no message log", () => {
    const state = reduceGgEvents([
      gg({ type: "session_started" } as GgTelemetryKind),
    ]);
    expect(state.messagePool.size).toBe(0);
    expect(state.prompts).toEqual([]);
  });
});

describe("RequestsView", () => {
  it("renders each turn's request messages and response, resolving pointers", () => {
    const state = reduceGgEvents(twoTurnStream());
    render(
      <RequestsView
        prompts={state.prompts}
        pool={state.messagePool}
        live={false}
      />,
    );
    // Both turns are present.
    expect(screen.getByText("Turn 1")).toBeInTheDocument();
    expect(screen.getByText("Turn 2")).toBeInTheDocument();
    // The resolved message content is shown (a message renders both a collapsed preview
    // and its full body, so it appears more than once), including the response reply —
    // proving the pointers resolved against the pool.
    expect(screen.getAllByText("build a game").length).toBeGreaterThan(0);
    expect(screen.getAllByText("done").length).toBeGreaterThan(0);
  });

  it("shows an empty state with nothing logged", () => {
    render(<RequestsView prompts={[]} pool={new Map()} live={false} />);
    expect(screen.getByText("No requests were recorded.")).toBeInTheDocument();
  });

  it("marks a turn with no response", () => {
    const state = reduceGgEvents([
      gg({
        type: "context_message",
        id: "m1",
        role: "system",
        content: "s",
        toolCalls: [],
        images: [],
        tokens: 3,
      } as GgTelemetryKind),
      gg({
        type: "prompt",
        request: [{ id: "m1", source: "system" }],
        totalTokens: 3,
        finishReason: "stop",
        tokens: {},
      } as GgTelemetryKind),
    ]);
    render(
      <RequestsView
        prompts={state.prompts}
        pool={state.messagePool}
        live={false}
      />,
    );
    const turn = screen.getByText("Turn 1").closest("details")!;
    expect(within(turn).getByText(/No assistant message/)).toBeInTheDocument();
  });
});
