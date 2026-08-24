// The Programs file: each responses-as-code turn's reply as a program with its verdict.
//
// These pin two things. The fold: that each `prompt` opens one program, that the turn's
// `code_execution` and `turn_outcome` attach to it and to nothing else, and that the
// status is the turn's error KIND read as compile / runtime / success — not the
// execution's `ok`, which carries no class. And the file's gating and rendering: offered
// only to an instance that answers in code, every row collapsed, the status on the row,
// the program and the error inside it.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
  GgTurnErrorKind,
  GgTurnErrorType,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { programStatusOf, reduceGgEvents } from "./useGgRunState";
import type { GgAgentSurface } from "./useGgRunState";
import { ProgramsView } from "./ProgramsView";
import { fileLabel, filesFor } from "./ggAgentEntries";

const TS = "2026-08-23T00:00:00Z";

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

// One code turn: the reply defined into the pool, the prompt pointing at it, the
// execution, and the outcome — in the order gg emits them.
function codeTurn(
  n: number,
  program: string,
  execution: { ok: boolean; error?: string; logs?: string[] } | null,
  failure?: { kind: GgTurnErrorKind; type: GgTurnErrorType },
): HarnessEvent[] {
  const id = `m_reply${n}`;
  return [
    gg({ type: "turn_started" } as GgTelemetryKind),
    gg({
      type: "context_message",
      id,
      role: "assistant",
      content: program,
      toolCalls: [],
      images: [],
      tokens: 12,
    } as GgTelemetryKind),
    gg({
      type: "prompt",
      request: [{ id: "m_sys", source: "system" }],
      totalTokens: 10,
      responseId: id,
      finishReason: "stop",
      tokens: { uncachedInput: 10, output: 12 },
    } as GgTelemetryKind),
    ...(execution
      ? [
          gg({
            type: "code_execution",
            ok: execution.ok,
            toolCalls: 0,
            error: execution.error,
            logs: execution.logs,
            durationMs: 7,
          } as GgTelemetryKind),
        ]
      : []),
    gg({
      type: "turn_outcome",
      outcome: failure ? "error" : "progressed",
      error: failure?.kind,
      errorType: failure?.type,
      consecutiveErrors: failure ? 1 : 0,
      turns: n,
    } as GgTelemetryKind),
  ];
}

function threeTurnStream(): HarnessEvent[] {
  return [
    gg({ type: "session_started" } as GgTelemetryKind),
    gg({
      type: "context_message",
      id: "m_sys",
      role: "system",
      content: "you are gg",
      toolCalls: [],
      images: [],
      tokens: 10,
    } as GgTelemetryKind),
    ...codeTurn(1, 'import { files } from "gg";\nfiles.read("a");', {
      ok: true,
      logs: ["hello"],
    }),
    ...codeTurn(
      2,
      "const x: number = 'no';",
      { ok: false, error: "TS2322: Type 'string' is not assignable" },
      { kind: "transpile", type: "transpile_compile" },
    ),
    ...codeTurn(
      3,
      "throw new Error('boom');",
      { ok: false, error: "Error: boom" },
      { kind: "program_fault", type: "program_throw" },
    ),
  ];
}

const codeSurface: GgAgentSurface = {
  executionMode: "responses_as_code",
  docViewTypes: null,
  tools: [],
  apis: [],
};
const toolSurface: GgAgentSurface = {
  executionMode: "tool_calling",
  docViewTypes: null,
  tools: ["read_file"],
  apis: [],
};

describe("program fold", () => {
  it("opens one program per prompt and attaches its execution and outcome", () => {
    const { programs } = reduceGgEvents(threeTurnStream());
    expect(programs.map((p) => p.turn)).toEqual([0, 1, 2]);
    expect(programs.map((p) => p.status)).toEqual([
      "success",
      "compile",
      "runtime",
    ]);
    expect(programs[0]).toMatchObject({
      responseId: "m_reply1",
      executed: true,
      error: null,
      errorKind: null,
      logs: ["hello"],
      durationMs: 7,
    });
    expect(programs[1]).toMatchObject({
      error: "TS2322: Type 'string' is not assignable",
      errorKind: "transpile",
      errorType: "transpile_compile",
    });
    expect(programs[2]).toMatchObject({
      error: "Error: boom",
      errorType: "program_throw",
    });
  });

  it("classifies by the turn's error kind, not the execution's ok flag", () => {
    expect(programStatusOf(undefined)).toBe("success");
    expect(programStatusOf("transpile")).toBe("compile");
    expect(programStatusOf("program_fault")).toBe("runtime");
    expect(programStatusOf("sandbox_limit")).toBe("runtime");
    expect(programStatusOf("missing_completion")).toBe("other");
    expect(programStatusOf("model_api")).toBe("other");
  });

  it("classifies a turn whose reply never ran by its outcome alone", () => {
    const { programs } = reduceGgEvents([
      ...codeTurn(1, "not a program", null, {
        kind: "model_api",
        type: "model_parse",
      }),
    ]);
    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({
      status: "other",
      executed: false,
      error: null,
      errorType: "model_parse",
    });
  });

  it("does not attach an unprompted turn's outcome to the previous program", () => {
    const { programs } = reduceGgEvents([
      ...codeTurn(1, "ok()", { ok: true }),
      // A turn the model call itself failed on: started, judged, never prompted.
      gg({ type: "turn_started" } as GgTelemetryKind),
      gg({
        type: "turn_outcome",
        outcome: "error",
        error: "model_api",
        errorType: "model_retry_exhausted",
        consecutiveErrors: 1,
        turns: 2,
      } as GgTelemetryKind),
    ]);
    expect(programs).toHaveLength(1);
    expect(programs[0]!.status).toBe("success");
  });
});

describe("programs file", () => {
  it("is offered only to an instance that answers in code", () => {
    expect(filesFor(null, "root", codeSurface)).toContain("programs");
    expect(filesFor(null, "root", toolSurface)).not.toContain("programs");
    expect(filesFor(null, "root", undefined)).not.toContain("programs");
    expect(fileLabel("programs", codeSurface)).toBe("programs");
  });

  it("lists every turn collapsed with its status, and opens onto program + error", () => {
    const state = reduceGgEvents(threeTurnStream());
    render(
      <ProgramsView
        programs={state.programs}
        pool={state.messagePool}
        live={false}
      />,
    );
    const rows = screen.getAllByRole("group");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).not.toHaveAttribute("open");

    expect(within(rows[0]!).getByText("success")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("compile")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("runtime")).toBeInTheDocument();

    // The preview is the program's first line.
    expect(
      within(rows[0]!).getByText('import { files } from "gg";'),
    ).toBeInTheDocument();

    // Inside a failed row: the program, then the error under a caption naming where it
    // happened and the specific type.
    expect(within(rows[1]!).getByText(/Compile error/)).toBeInTheDocument();
    expect(
      within(rows[1]!).getByText("TS2322: Type 'string' is not assignable"),
    ).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/Runtime error/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Error: boom")).toBeInTheDocument();
    // A clean row carries no error section.
    expect(within(rows[0]!).queryByText(/error/i)).toBeNull();
  });

  it("shows a waiting state while live and an empty state when not", () => {
    const { rerender } = render(
      <ProgramsView programs={[]} pool={new Map()} live />,
    );
    expect(
      screen.getByText("Waiting for the first program…"),
    ).toBeInTheDocument();
    rerender(<ProgramsView programs={[]} pool={new Map()} live={false} />);
    expect(screen.getByText("No programs were recorded.")).toBeInTheDocument();
  });
});
