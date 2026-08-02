import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { reduceGgEvents } from "./useGgRunState";
import type { PooledMessage, PromptTurn } from "./useGgRunState";
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

// A one-turn stream whose single request message is a tool result — the only kind of
// message that answers a named call, and so the only kind with anything left to say in
// its expansion now that the role and the token cost have been dropped from it.
function toolResultStream(): HarnessEvent[] {
  return [
    gg({
      type: "context_message",
      id: "m_tool",
      role: "tool",
      content: "42",
      toolCalls: [],
      images: [],
      tokens: 7,
      toolCallId: "call_7",
    } as GgTelemetryKind),
    gg({
      type: "prompt",
      request: [{ id: "m_tool", source: "tool_output" }],
      totalTokens: 7,
      finishReason: "stop",
      tokens: {},
    } as GgTelemetryKind),
  ];
}

// A pooled message and a turn built by hand, so a test can hand `RequestsView` turn
// numbers the reducer would never produce from a whole stream — the view takes
// `PromptTurn[]` as its contract, and a caller may pass a slice of an agent's turns or
// a resumed agent's stream, neither of which is a contiguous 0-based run.
function pooled(id: string, content: string): PooledMessage {
  return { id, role: "user", content, toolCalls: [], images: [], tokens: 5 };
}

function turnAt(turn: number, messageId: string): PromptTurn {
  return {
    turn,
    request: [{ id: messageId, source: "user_prompt" }],
    totalTokens: 5,
    responseId: null,
    finishReason: "stop",
    tokens: {
      uncachedInput: 5,
      cachedInput: null,
      output: null,
      reasoning: null,
    },
    cost: null,
    durationMs: null,
  };
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

  // The expansion is the full-width read of one message's text; it no longer repeats
  // the role and the token cost, both of which the collapsed row above it already
  // carries as the band tag and the token column.
  it("does not repeat the role or the token count in an expanded message", () => {
    const state = reduceGgEvents(twoTurnStream());
    render(
      <RequestsView
        prompts={state.prompts}
        pool={state.messagePool}
        live={false}
      />,
    );
    // The band tags still label every row ("User prompt" appears once per turn).
    expect(screen.getAllByText("User prompt").length).toBeGreaterThan(0);
    // But the raw role and the "N tokens" restatement are gone from the bodies.
    expect(screen.queryByText("user")).toBeNull();
    expect(screen.queryByText("system")).toBeNull();
    expect(screen.queryByText("20 tokens")).toBeNull();
    expect(screen.queryByText("10 tokens")).toBeNull();
  });

  // With the role and cost gone, most messages have nothing left to put in the meta
  // line — so it is not rendered at all rather than left empty, holding a blank line
  // open in every expansion.
  it("omits the meta line entirely when a message answers no call", () => {
    const state = reduceGgEvents(twoTurnStream());
    render(
      <RequestsView
        prompts={state.prompts}
        pool={state.messagePool}
        live={false}
      />,
    );
    // Both the collapsed preview and the expanded <pre> carry the text; either one
    // resolves to the message's own <details>.
    const message = screen.getAllByText("build a game")[0]!.closest("details")!;
    expect(message.querySelector("p")).toBeNull();
  });

  // The pairing back to the call a tool result answers appears nowhere else, so it
  // survives as the expansion's only meta.
  it("names the call a tool result answers", () => {
    const state = reduceGgEvents(toolResultStream());
    render(
      <RequestsView
        prompts={state.prompts}
        pool={state.messagePool}
        live={false}
      />,
    );
    const message = screen.getAllByText("42")[0]!.closest("details")!;
    expect(message.querySelector("p")?.textContent).toBe("answers call_7");
  });

  // The newest turn is opened by its own recorded turn number, not by its position in
  // the list — the two coincide only while the turns are a contiguous 0-based run, and
  // keying on the index left every turn shut whenever they were not.
  it("opens the newest turn when the turn numbers are not zero-based", () => {
    const pool = new Map<string, PooledMessage>([
      ["m_a", pooled("m_a", "the earlier turn")],
      ["m_b", pooled("m_b", "the newest turn")],
    ]);
    render(
      <RequestsView
        prompts={[turnAt(7, "m_a"), turnAt(9, "m_b")]}
        pool={pool}
        live={false}
      />,
    );
    const earlier = screen.getByText("Turn 8").closest("details")!;
    const newest = screen.getByText("Turn 10").closest("details")!;
    expect(newest.open).toBe(true);
    expect(earlier.open).toBe(false);
    // The open turn actually shows its contents — the point of opening it.
    expect(
      within(newest).getAllByText("the newest turn").length,
    ).toBeGreaterThan(0);
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
  // One message in one band, so a band-tag assertion has exactly one row to read.
  function bandedStream(source: string): HarnessEvent[] {
    return [
      gg({
        type: "context_message",
        id: "m1",
        role: "user",
        content: "the material",
        toolCalls: [],
        images: [],
        tokens: 3,
        label: "changed-files",
      } as GgTelemetryKind),
      gg({
        type: "prompt",
        request: [{ id: "m1", source }],
        totalTokens: 3,
        finishReason: "stop",
        tokens: {},
      } as unknown as GgTelemetryKind),
    ];
  }

  it("tags a view the agent composed for itself as its own band", () => {
    const state = reduceGgEvents(bandedStream("text_view"));
    render(
      <RequestsView
        prompts={state.prompts}
        pool={state.messagePool}
        live={false}
      />,
    );
    expect(screen.getByText("Agent views")).toBeInTheDocument();
    // Not folded into the file band it sits beside in the contract.
    expect(screen.queryByText("File views")).toBeNull();
  });

  it("falls back to the raw tag for a band this build cannot name", () => {
    // The console reads records written by any gg, including one newer than itself. The
    // lookup used to be unguarded, so an unrecognised source rendered a nameless row with
    // no swatch — which reads as a rendering bug rather than as a band this build predates.
    const state = reduceGgEvents(bandedStream("band_from_the_future"));
    render(
      <RequestsView
        prompts={state.prompts}
        pool={state.messagePool}
        live={false}
      />,
    );
    expect(screen.getByText("band_from_the_future")).toBeInTheDocument();
  });
});
