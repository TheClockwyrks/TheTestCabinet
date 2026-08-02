import { describe, expect, it } from "vitest";
import type {
  GgCapabilitySet,
  GgReplayRecordV1,
} from "@test-cabinet/run-record/gg";
import type {
  GgReplayEntry,
  GgReplayPromptItem,
  GgReplayRecord,
} from "@test-cabinet/run-record/gg-replay";
import {
  buildLegacyReplayWalk,
  buildReplayWalk,
  contextSummary,
  formatShellCwd,
  joinContext,
  truncationNotice,
  type ReplayRequestRow,
} from "./replayModel";

// A minimal capability set — the walk carries it through untouched, so its contents
// matter only where a test reads them back.
const CAPABILITIES: GgCapabilitySet = {
  preset: "full",
  agents: [
    {
      name: "Root",
      capabilities: [{ id: "replay", enabled: true, params: {} }],
      modelId: "test/model",
    },
  ],
};

// A 1×1 transparent PNG, so an image that renders is a real one.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function record(over: Partial<GgReplayRecord> = {}): GgReplayRecord {
  return {
    formatVersion: 2,
    recorder: { ggVersion: "0.7.0" },
    fidelity: "standard",
    sessionId: "run-xyz",
    capabilitySet: CAPABILITIES,
    seed: { prompt: "Build the thing." },
    agents: [],
    messages: [],
    toolsets: [],
    texts: [],
    clips: [],
    blobs: [],
    entries: [],
    ...over,
  };
}

function promptItem(
  over: Partial<GgReplayPromptItem> & { message: number },
): GgReplayPromptItem {
  return {
    slot: "thread",
    source: "assistant",
    retention: "ephemeral",
    turn: 1,
    ...over,
  };
}

function modelIo(
  over: Partial<GgReplayEntry> & { agentId: string; seq: number },
): GgReplayEntry {
  const { agentId, seq, ...rest } = over;
  return {
    agentId,
    seq,
    type: "model_io",
    request: {
      role: "agent",
      shape: "complete",
      messages: [],
      fingerprint: { messages: 0, conversation: "abc" },
    },
    response: { text: "ok", finishReason: "stop" },
    ...rest,
  } as GgReplayEntry;
}

describe("buildReplayWalk", () => {
  it("resolves a turn's pooled messages, toolset and prompt frame into one step", () => {
    const walk = buildReplayWalk(
      record({
        messages: [
          { id: "m0", body: { role: "system", content: "You are gg." } },
          { id: "m1", body: { role: "user", content: "Start the build." } },
        ],
        toolsets: [
          {
            id: "t0",
            tools: [{ name: "shell", description: "Run a shell command." }],
          },
        ],
        entries: [
          modelIo({
            agentId: "root",
            seq: 1,
            request: {
              role: "agent",
              shape: "complete",
              messages: [0, 1],
              toolset: 0,
              fingerprint: { messages: 2, conversation: "abc" },
            },
          }),
          {
            agentId: "root",
            seq: 2,
            type: "prompt_frame",
            items: [
              promptItem({
                message: 0,
                slot: "system",
                source: "system",
                retention: "pinned",
                turn: 0,
              }),
              promptItem({
                message: 1,
                source: "user_prompt",
                retention: "pinned",
                turn: 0,
              }),
            ],
          },
        ],
      }),
    );

    expect(walk.steps).toHaveLength(1);
    const step = walk.steps[0]!;
    expect(step.request.map((row) => row.message?.content)).toEqual([
      "You are gg.",
      "Start the build.",
    ]);
    // The frame lands after the call it describes, and its items attach to that call's
    // request — this is the Context column.
    expect(step.request.map((row) => row.context?.source)).toEqual([
      "system",
      "user_prompt",
    ]);
    expect(step.request[0]!.context?.slot).toBe("system");
    expect(step.tools).toEqual([
      { name: "shell", description: "Run a shell command." },
    ]);
    expect(walk.prompt).toBe("Build the thing.");
  });

  it("inflates a blob reference in a message body back into the image it stands for", () => {
    const walk = buildReplayWalk(
      record({
        blobs: [
          { id: "b0", mediaType: "image/png", bytes: 68, dataBase64: PIXEL },
        ],
        messages: [
          {
            id: "m0",
            body: {
              role: "user",
              content: "Match this mockup.",
              images: [{ $blob: 0 }],
            },
          },
        ],
        entries: [
          modelIo({
            agentId: "root",
            seq: 1,
            request: {
              role: "agent",
              shape: "complete",
              messages: [0],
              fingerprint: { messages: 1, conversation: "abc" },
            },
          }),
        ],
      }),
    );

    expect(walk.steps[0]!.request[0]!.message?.images).toEqual([
      { mediaType: "image/png", bytes: 68, dataBase64: PIXEL },
    ]);
  });

  it("leaves a dangling pool reference visible rather than dropping the message", () => {
    // A truncated capture can reference a body that was never written. The row survives
    // with no message, which is what renders as "message unavailable" — dropping it
    // would silently shorten the conversation instead.
    const walk = buildReplayWalk(
      record({
        messages: [{ id: "m0", body: { role: "user", content: "One." } }],
        entries: [
          modelIo({
            agentId: "root",
            seq: 1,
            request: {
              role: "agent",
              shape: "complete",
              messages: [0, 7],
              fingerprint: { messages: 2, conversation: "abc" },
            },
          }),
        ],
      }),
    );

    const rows = walk.steps[0]!.request;
    expect(rows).toHaveLength(2);
    expect(rows[1]!.message).toBeNull();
    expect(rows[1]!.poolIndex).toBe(7);
  });

  it("attaches a tool result to the turn that called it, with its pooled text", () => {
    const walk = buildReplayWalk(
      record({
        texts: ["src/\nCargo.toml", "2 entries"],
        entries: [
          modelIo({ agentId: "root", seq: 1 }),
          {
            agentId: "root",
            seq: 2,
            type: "tool_result",
            call: {
              id: "call-1",
              name: "shell",
              arguments: { cmd: "ls" },
              cwd: { type: "relative", path: "web" },
            },
            outcome: { ok: true, output: 0, summary: 1 },
          },
        ],
      }),
    );

    expect(walk.steps).toHaveLength(1);
    const [result] = walk.steps[0]!.toolResults;
    expect(result?.name).toBe("shell");
    expect(result?.output.text).toBe("src/\nCargo.toml");
    expect(result?.summary).toBe("2 entries");
    expect(result?.cwd).toBe("web");
  });

  it("keeps a compaction turn off the agent's own queue", () => {
    // The client-role discriminator exists so a summarizer call and the agent's next
    // real turn cannot interleave into one queue. A tool result recorded after the
    // summarizer's call belongs to the agent's turn, not to the summarizer's.
    const walk = buildReplayWalk(
      record({
        texts: ["done"],
        entries: [
          modelIo({ agentId: "root", seq: 1 }),
          modelIo({
            agentId: "root",
            seq: 2,
            request: {
              role: "compaction",
              shape: "complete",
              messages: [],
              fingerprint: { messages: 0, conversation: "sum" },
            },
          }),
          {
            agentId: "root",
            seq: 3,
            type: "tool_result",
            call: { id: "call-1", name: "shell", arguments: {} },
            outcome: { ok: true, output: 0 },
          },
        ],
      }),
    );

    expect(walk.steps.map((s) => s.role)).toEqual(["agent", "compaction"]);
    expect(walk.steps[0]!.toolResults).toHaveLength(1);
    expect(walk.steps[1]!.toolResults).toHaveLength(0);
  });

  it("surfaces a model error as its own step rather than dropping the turn", () => {
    const walk = buildReplayWalk(
      record({
        entries: [
          {
            agentId: "root",
            seq: 1,
            type: "model_error",
            request: {
              role: "agent",
              shape: "complete",
              messages: [],
              fingerprint: { messages: 0, conversation: "abc" },
            },
            error: {
              kind: "vision_unsupported",
              message: "this model cannot see images",
              modelId: "test/model",
            },
          },
        ],
      }),
    );

    expect(walk.steps[0]!.error?.kind).toBe("vision_unsupported");
    expect(walk.steps[0]!.response).toBeNull();
  });

  it("gives an orphan input a step of its own", () => {
    const walk = buildReplayWalk(
      record({
        texts: [""],
        entries: [
          {
            agentId: "agent-3",
            seq: 1,
            type: "tool_result",
            call: { id: "call-1", name: "shell", arguments: {} },
            outcome: { ok: true, output: 0 },
          },
        ],
      }),
    );

    expect(walk.steps).toHaveLength(1);
    expect(walk.steps[0]!.orphan).toBe(true);
    expect(walk.steps[0]!.toolResults).toHaveLength(1);
  });

  it("walks the entries in global seq order, not the order they were stored", () => {
    const walk = buildReplayWalk(
      record({
        entries: [
          modelIo({ agentId: "agent-0", seq: 4 }),
          modelIo({ agentId: "root", seq: 2 }),
        ],
      }),
    );

    expect(walk.steps.map((s) => s.seq)).toEqual([2, 4]);
  });

  it("reads an upgraded record's captured version from upgradedFrom, not formatVersion", () => {
    // The load-bearing distinction: a v1 body is upgraded into the v2 shape as it is
    // read, so the document in hand says `formatVersion: 2` while the recorder wrote 1.
    // Branching on the document's own version would report every legacy record as
    // current and hide the older-gg banner exactly where it is needed.
    const walk = buildReplayWalk(record({ formatVersion: 2, upgradedFrom: 1 }));
    expect(walk.capturedFormatVersion).toBe(1);
    expect(walk.capturedBeforeV2).toBe(true);

    const current = buildReplayWalk(record());
    expect(current.capturedBeforeV2).toBe(false);
  });

  it("lists an agent the provenance table names even when it never took a turn", () => {
    const walk = buildReplayWalk(
      record({
        agents: [
          { agentId: "root", profile: "Root", origin: { type: "root" } },
          {
            agentId: "agent-0",
            profile: "Builder",
            origin: { type: "spawn", parent: "root", ordinal: 1 },
            terminalStatus: "failed",
          },
        ],
        entries: [modelIo({ agentId: "root", seq: 1 })],
      }),
    );

    expect(walk.agents).toEqual([
      {
        id: "root",
        profile: "Root",
        origin: "root",
        terminalStatus: null,
        limitHit: null,
        steps: 1,
      },
      {
        id: "agent-0",
        profile: "Builder",
        origin: "spawned by root #1",
        terminalStatus: "failed",
        limitHit: null,
        steps: 0,
      },
    ]);
  });
});

describe("buildLegacyReplayWalk", () => {
  const LEGACY: GgReplayRecordV1 = {
    sessionId: "run-old",
    capabilitySet: CAPABILITIES,
    entries: [
      {
        agentId: "root",
        seq: 1,
        type: "model_io",
        request: {
          messages: [
            { role: "system", content: "You are gg." },
            { role: "user", content: "Start the build." },
          ],
          tools: [{ name: "shell", description: "Run a shell command." }],
        },
        response: {
          text: "I'll list the files.",
          toolCalls: [
            { id: "call-1", name: "shell", arguments: { cmd: "ls" } },
          ],
          finishReason: "tool_calls",
          usage: { output: 40, reasoning: 2 },
        },
      },
      {
        agentId: "root",
        seq: 2,
        type: "tool_result",
        call: { id: "call-1", name: "shell", arguments: { cmd: "ls" } },
        outcome: { ok: true, output: "src/\nCargo.toml", summary: "2 entries" },
      },
    ],
  };

  it("walks a transcript record with its payloads inline", () => {
    const walk = buildLegacyReplayWalk(LEGACY);

    expect(walk.capturedBeforeV2).toBe(true);
    expect(walk.steps).toHaveLength(1);
    const step = walk.steps[0]!;
    expect(step.request.map((row) => row.message?.content)).toEqual([
      "You are gg.",
      "Start the build.",
    ]);
    // A v1 record has no prompt frame at all, which is the whole reason the banner
    // exists: the Context column has nothing to show and says so.
    expect(step.request.every((row) => row.context == null)).toBe(true);
    expect(step.response?.message.content).toBe("I'll list the files.");
    expect(step.response?.message.tokens).toBe(42);
    expect(step.toolResults[0]?.output.text).toBe("src/\nCargo.toml");
  });

  it("reports standard fidelity rather than inferring full from the capability", () => {
    // Every v1 record was opted into via the `replay` capability, but none of them
    // carries a full-only input — v1 recorded no clock reads at all — so reading the
    // capability back would invite the reader to conclude the session had none.
    expect(buildLegacyReplayWalk(LEGACY).fidelity).toBe("standard");
  });
});

describe("joinContext", () => {
  const row = (poolIndex: number | null): ReplayRequestRow => ({
    key: `k${poolIndex}`,
    poolIndex,
    message: null,
    context: null,
  });

  it("joins positionally when the frame covers the request exactly", () => {
    // Two rows carrying the *same* pooled message, which only a positional join can
    // tell apart — an index lookup would give both the first item's band.
    const rows = [row(5), row(5)];
    joinContext(rows, [
      promptItem({ message: 5, source: "skill", turn: 1 }),
      promptItem({ message: 5, source: "memory", turn: 2 }),
    ]);
    expect(rows.map((r) => r.context?.source)).toEqual(["skill", "memory"]);
  });

  it("falls back to matching pool indices when the counts disagree", () => {
    const rows = [row(1), row(2), row(3)];
    joinContext(rows, [promptItem({ message: 3, source: "board", turn: 4 })]);
    expect(rows.map((r) => r.context?.source)).toEqual([
      undefined,
      undefined,
      "board",
    ]);
  });
});

describe("contextSummary", () => {
  it("names the slot only where the band does not already say it", () => {
    expect(
      contextSummary({
        slot: "thread",
        source: "assistant",
        retention: "ephemeral",
        turn: 7,
        label: null,
        region: null,
      }),
    ).toBe("ephemeral · t7");
    // A system prompt and a rebuilt context-usage signal are both `system`-banded,
    // pinned and unlabelled — the slot is the only thing that tells them apart.
    expect(
      contextSummary({
        slot: "context_usage",
        source: "system",
        retention: "pinned",
        turn: 0,
        label: "__context_usage__",
        region: null,
      }),
    ).toBe("usage slot · pinned · t0 · __context_usage__");
  });

  it("spells an agent-composed view as its bare label", () => {
    // A text view is keyed by a label, not by a path, and is never paged — appending a
    // window to it would describe a region of a file it is not.
    expect(
      contextSummary({
        slot: "thread",
        source: "text_view",
        retention: "ephemeral",
        turn: 5,
        label: "changed-files",
        region: null,
      }),
    ).toBe("ephemeral · t5 · changed-files");
  });

  it("spells a paged file view as path@offset+limit", () => {
    expect(
      contextSummary({
        slot: "thread",
        source: "file_view",
        retention: "pinned",
        turn: 3,
        label: "src/main.ts",
        region: { offset: 120, limit: 80 },
      }),
    ).toBe("pinned · t3 · src/main.ts@120+80");
  });
});

describe("formatShellCwd", () => {
  it("says nothing for the workspace root and names anything else", () => {
    expect(formatShellCwd({ type: "workspace" })).toBeNull();
    expect(formatShellCwd(undefined)).toBeNull();
    expect(formatShellCwd({ type: "relative", path: "web" })).toBe("web");
    expect(formatShellCwd({ type: "absolute", path: "/work/impl" })).toBe(
      "/work/impl",
    );
  });
});

describe("truncationNotice", () => {
  it("states what stopped the capture and where the record still holds", () => {
    expect(
      truncationNotice({ reason: "session_killed", lastSeq: 41 }),
    ).toContain("killed mid-capture");
    expect(
      truncationNotice({ reason: "session_killed", lastSeq: 41 }),
    ).toContain("seq 41");
    expect(
      truncationNotice({ reason: "byte_ceiling", bytes: 268435456 }),
    ).toContain("256.0 MB");
  });
});
