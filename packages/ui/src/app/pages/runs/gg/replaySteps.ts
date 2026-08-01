import type {
  GgReplayEntryV1,
  GgReplayRecordV1,
  GgReplayStep,
  GgReplayToolStep,
} from "@test-cabinet/run-record/gg";

// The step-through data model the replay debug view renders, derived on the client
// from a run's raw replay record. This mirrors the Rust `GgReplayRecordV1::steps()`
// derivation exactly (crates/core `gg.rs`) — the backend serves the raw record, and
// this is the same *lenient* walk the driver's step model uses: a model-I/O entry
// opens a step for its agent (what it SAW: the request; what it DID: the response),
// and each following tool-result entry for that same agent attaches to that agent's
// currently-open step. Steps come back in opening-`seq` order — the global timeline
// across the whole agent tree — each tagged with its `agentId`. The derivation never
// fails: a tool result with no open model turn for its agent (which a complete record
// never produces) surfaces as its own synthetic step with a null request/response
// rather than being dropped.

/**
 * Derive the ordered, per-agent {@link GgReplayStep} list from a raw
 * {@link GgReplayRecordV1} — the mirror of the Rust `GgReplayRecordV1::steps()`.
 */
export function deriveReplaySteps(record: GgReplayRecordV1): GgReplayStep[] {
  const entries: GgReplayEntryV1[] = [...record.entries].sort(
    (a, b) => a.seq - b.seq,
  );

  const steps: GgReplayStep[] = [];
  // The index of each agent's currently-open step (its most recent model turn), so a
  // following tool result attaches to the right turn even as agents interleave.
  const open = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type === "model_io") {
      open.set(entry.agentId, steps.length);
      steps.push({
        agentId: entry.agentId,
        seq: entry.seq,
        saw: entry.request,
        did: entry.response,
        toolResults: [],
      });
    } else {
      const tool: GgReplayToolStep = {
        call: entry.call,
        outcome: entry.outcome,
      };
      const idx = open.get(entry.agentId);
      if (idx !== undefined) {
        steps[idx]!.toolResults.push(tool);
      } else {
        steps.push({
          agentId: entry.agentId,
          seq: entry.seq,
          saw: null,
          did: null,
          toolResults: [tool],
        });
      }
    }
  }
  return steps;
}

// --- Typed readers over the JSON payloads --------------------------------------
//
// The replay payloads are carried as opaque JSON (`Record<string, unknown>`) because
// the `gg` binary owns their concrete shapes (its `Message`, `ToolDefinition`,
// `ModelResponse`, `ToolCall`, `ToolOutcome`). These readers narrow them for display,
// tolerating a missing/oddly-shaped field rather than throwing — this is debug
// tooling reading a captured record, and a partial record should still render.

/** One message in what an agent saw this turn (a `gg` `Message`). */
export interface ReplayMessage {
  role: string;
  content: string | null;
  toolCalls: ReplayToolCall[];
  toolCallId: string | null;
}

/** One tool the model was offered this turn (a `gg` `ToolDefinition`). */
export interface ReplayToolDefinition {
  name: string;
  description: string;
}

/** A tool call the model made (a `gg` `ToolCall`). */
export interface ReplayToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

/** What the model did this turn (a `gg` `ModelResponse`). */
export interface ReplayResponse {
  text: string | null;
  toolCalls: ReplayToolCall[];
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  cost: unknown;
}

/** A tool call's recorded outcome (a `gg` `ToolOutcome`). */
export interface ReplayOutcome {
  ok: boolean | null;
  output: string;
  summary: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readToolCall(value: unknown): ReplayToolCall {
  const rec = asRecord(value) ?? {};
  return {
    id: asString(rec.id) ?? "",
    name: asString(rec.name) ?? "(unknown)",
    arguments: rec.arguments ?? null,
  };
}

/** The `{ messages, tools }` an agent saw this turn, narrowed for display. */
export function readSaw(saw: GgReplayStep["saw"]): {
  messages: ReplayMessage[];
  tools: ReplayToolDefinition[];
} {
  const rec = asRecord(saw);
  const messagesRaw = Array.isArray(rec?.messages) ? rec.messages : [];
  const toolsRaw = Array.isArray(rec?.tools) ? rec.tools : [];
  const messages: ReplayMessage[] = messagesRaw.map((m) => {
    const mr = asRecord(m) ?? {};
    const calls = Array.isArray(mr.toolCalls) ? mr.toolCalls : [];
    return {
      role: asString(mr.role) ?? "?",
      content: asString(mr.content),
      toolCalls: calls.map(readToolCall),
      toolCallId: asString(mr.toolCallId),
    };
  });
  const tools: ReplayToolDefinition[] = toolsRaw.map((tdef) => {
    const tr = asRecord(tdef) ?? {};
    return {
      name: asString(tr.name) ?? "(unknown)",
      description: asString(tr.description) ?? "",
    };
  });
  return { messages, tools };
}

/** The model response an agent produced this turn, narrowed for display. */
export function readDid(did: GgReplayStep["did"]): ReplayResponse | null {
  const rec = asRecord(did);
  if (!rec) return null;
  const calls = Array.isArray(rec.toolCalls) ? rec.toolCalls : [];
  return {
    text: asString(rec.text),
    toolCalls: calls.map(readToolCall),
    finishReason: readFinishReason(rec.finishReason),
    usage: asRecord(rec.usage),
    cost: rec.cost ?? null,
  };
}

// The `gg` `FinishReason` serializes either as a bare string (`"stop"`,
// `"tool_calls"`, …) or, for the catch-all `Other(String)`, as `{ other: "…" }`.
function readFinishReason(value: unknown): string | null {
  const bare = asString(value);
  if (bare) return bare;
  const rec = asRecord(value);
  if (rec) {
    const other = asString(rec.other);
    if (other) return `other: ${other}`;
  }
  return null;
}

/** The call side of a tool step, narrowed for display. */
export function readCall(call: GgReplayToolStep["call"]): ReplayToolCall {
  return readToolCall(call);
}

/** The outcome side of a tool step, narrowed for display. */
export function readOutcome(outcome: GgReplayToolStep["outcome"]): ReplayOutcome {
  const rec = asRecord(outcome) ?? {};
  return {
    ok: typeof rec.ok === "boolean" ? rec.ok : null,
    output: asString(rec.output) ?? "",
    summary: asString(rec.summary),
  };
}
