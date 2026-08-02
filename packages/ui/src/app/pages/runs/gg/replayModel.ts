// The Replay view's walk model: a stored replay record resolved into the ordered,
// per-agent steps a developer walks.
//
// The record is a content-addressed input log (see gg/analysis/replay-records) — four
// pools plus a flat list of entries that reference them by index. Nothing in that shape
// is renderable on its own, so this module resolves it: pooled bodies become the same
// `PooledMessage` the live monitor's message log produces, pooled texts and image blobs
// become the strings and pictures they stand for, and the entries fold into steps.
//
// **One step is one model turn of one agent**: what it saw (the request, message by
// message, each with the window position the prompt frame recorded for it), what it did
// (the response, or the error the call failed with), and everything the run recorded
// against that turn afterwards — the tool results it produced, and the shell/git/probe/
// clock inputs its work consumed. Steps come back in opening-`seq` order, the global
// timeline across the whole agent tree, each tagged with its agent.
//
// The walk is **lenient by design**: it renders whatever the record holds. A truncated
// capture ends mid-turn, a corrupt one can reference a pool entry that was never
// written, and a pre-v2 record carries no prompt frames at all. None of those is an
// error here — they are facts about the capture, surfaced (a dangling reference reads as
// "message unavailable", an unattributed message says so) rather than thrown.

import type {
  GgAgentStatus,
  GgCapabilitySet,
  GgContextSource,
  GgLimitBreach,
  GgLoggedToolCall,
  GgReplayEntryV1,
  GgReplayRecordV1,
} from "@test-cabinet/run-record/gg";
import type {
  GgClientRole,
  GgReplayAgent,
  GgReplayCommand,
  GgReplayEntry,
  GgReplayFidelity,
  GgReplayFileRegion,
  GgReplayModelError,
  GgReplayPromptItem,
  GgReplayPromptSlot,
  GgReplayRecord,
  GgReplayRecorder,
  GgReplayRequestShape,
  GgReplayRetention,
  GgReplayTruncation,
  GgShellCwd,
  GgShellOrigin,
} from "@test-cabinet/run-record/gg-replay";
import {
  GG_REPLAY_FORMAT_V1,
  GG_REPLAY_FORMAT_VERSION,
} from "../../../../client/clients";
import type { PooledImage, PooledMessage } from "./useGgRunState";

/**
 * The key an image payload is replaced by inside a pooled message body — mirrors
 * `GG_REPLAY_BLOB_REF_KEY` in `crates/core/src/gg_replay.rs`.
 *
 * A body carries `{ "$blob": 3 }` where the client sent
 * `{ mediaType, dataBase64, bytes }`, so one 500 KB picture costs 500 KB once no matter
 * how many turns it survived.
 */
const BLOB_REF_KEY = "$blob";

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** Where one message sat in the agent's window, from the turn's prompt frame. */
export interface ReplayContextItem {
  /** Which slot of the window model it came from. */
  slot: GgReplayPromptSlot;
  /** The band it is attributed to — the same palette the Context graph uses. */
  source: GgContextSource;
  /** Whether it survives a compaction boundary verbatim. */
  retention: GgReplayRetention;
  /** The session turn it was pushed on (`0` for everything seeded before turn one). */
  turn: number;
  /** Its selector tag — a file view's workspace path, or the fullness sentinel. */
  label: string | null;
  /** The `offset`/`limit` window a paged file view covers. */
  region: GgReplayFileRegion | null;
}

/** One message of a step's request, resolved from the pool and placed in the window. */
export interface ReplayRequestRow {
  /** A stable React key — the pool index and the message's position in the request. */
  key: string;
  /** Its index into the record's message pool, for the fallback context join. */
  poolIndex: number | null;
  /** The resolved body, or `null` for an index the pool does not reach. */
  message: PooledMessage | null;
  /** Where it sat in the window, when a prompt frame recorded this turn. */
  context: ReplayContextItem | null;
}

/** One tool the model was offered this turn. */
export interface ReplayToolDefinition {
  name: string;
  description: string;
}

/** What the model produced this turn. */
export interface ReplayResponse {
  /**
   * The reply as a message, so it renders through the very same row component the
   * request's messages do rather than a second, near-identical one.
   */
  message: PooledMessage;
  /** Why the turn stopped. */
  finishReason: string | null;
  /** The turn's cost, when the provider reported one. */
  cost: number | null;
}

/**
 * A pooled payload as it is displayed: the recorded text, and — when a **standard**
 * fidelity capture clipped it — what the whole of it was.
 *
 * The clip has to travel with the text rather than beside it. A reader shown 32 KiB of a
 * command's output cannot otherwise tell a command that printed exactly that from one
 * that printed forty megabytes, and it is precisely the second case where the missing
 * part is the part worth having.
 */
export interface ReplayText {
  /** What the record holds — the whole payload, or the tail of it that was kept. */
  text: string;
  /** What was dropped, or `null` for a payload recorded whole. */
  clip: ReplayClip | null;
}

/** What a [clipped](ReplayText) payload is missing. */
export interface ReplayClip {
  /** How many bytes the whole payload had. */
  originalBytes: number;
  /** How many bytes of it the record kept. */
  keptBytes: number;
}

/** One subprocess the run recorded, with its pooled streams resolved. */
export interface ReplayCommand {
  command: string;
  /** Where it ran, as the record expresses it — workspace-relative wherever possible. */
  cwd: string | null;
  exitCode: number;
  stdout: ReplayText;
  stderr: ReplayText;
}

/** One tool call and the outcome the run's dispatch returned for it. */
export interface ReplayToolResult {
  key: string;
  seq: number;
  id: string;
  name: string;
  arguments: unknown;
  cwd: string | null;
  ok: boolean;
  output: ReplayText;
  summary: string | null;
  images: PooledImage[];
  data: Record<string, unknown> | null;
  failure: Record<string, unknown> | null;
}

/**
 * An input the turn consumed that is not a model call or a tool result — a shell or
 * `git` invocation, the cancel probe, or a deadline clock read.
 *
 * These are recorded from gg 0.7.0's full capture seams onward; a record written before
 * them simply carries none, which is why they are a list rather than fixed fields.
 */
export type ReplaySideEntry = { key: string; seq: number } & (
  | { kind: "shell"; origin: GgShellOrigin; command: ReplayCommand }
  | { kind: "git"; command: ReplayCommand }
  | { kind: "cancel_probe"; canceled: boolean }
  | { kind: "clock"; elapsedMs: number; remainingMs: number | null }
);

/** One model turn of one agent, with everything the run recorded against it. */
export interface ReplayStep {
  key: string;
  agentId: string;
  /** The `seq` the turn's model call was recorded at — its place on the timeline. */
  seq: number;
  /** Which of gg's two clients issued it: the agent's own, or compaction's summarizer. */
  role: GgClientRole;
  /** Whether the offered tool was required (`complete_requiring`). */
  shape: GgReplayRequestShape;
  request: ReplayRequestRow[];
  tools: ReplayToolDefinition[];
  response: ReplayResponse | null;
  /** Why the call failed, for a turn that produced an error rather than a response. */
  error: GgReplayModelError | null;
  toolResults: ReplayToolResult[];
  side: ReplaySideEntry[];
  /**
   * True for a step opened by an input that had no model turn to attach to — an orphan
   * a complete record never produces. Kept rather than dropped: an input that silently
   * vanished would be the one thing a reader could not tell from a run that never
   * produced it.
   */
  orphan: boolean;
}

/** One agent the walk saw, for the agent filter. */
export interface ReplayWalkAgent {
  id: string;
  /** The agent profile it ran under, from the record's provenance table. */
  profile: string | null;
  /** How it came to exist, as a short phrase (`spawned by root #2`, `issue TTC-3 #1`). */
  origin: string | null;
  /** The status its turn loop ended in, when the record carries one. */
  terminalStatus: GgAgentStatus | null;
  /** The ceiling that stopped it, when one did. */
  limitHit: GgLimitBreach | null;
  /** How many steps of the walk are its own. */
  steps: number;
}

/** A stored replay record, resolved into the walk the console renders. */
export interface ReplayWalk {
  sessionId: string;
  capabilitySet: GgCapabilitySet;
  recorder: GgReplayRecorder;
  fidelity: GgReplayFidelity;
  /**
   * The format the **recorder** wrote — not the format of the document in hand.
   *
   * A pre-v2 body is upgraded into the v2 shape as it is read, so branching on the
   * document's own `formatVersion` would report every record as current. This is the
   * value the older-gg banner is driven from, mirroring
   * `GgReplayRecord::captured_before_v2()`.
   */
  capturedFormatVersion: number;
  /** Whether the recorder wrote a pre-v2 format — see {@link capturedFormatVersion}. */
  capturedBeforeV2: boolean;
  /** What the record is missing, when it is missing something. */
  truncation: GgReplayTruncation | null;
  /** The build prompt the session was invoked with, when the record carries a seed. */
  prompt: string | null;
  agents: ReplayWalkAgent[];
  steps: ReplayStep[];
}

// ---------------------------------------------------------------------------
// Building the walk
// ---------------------------------------------------------------------------

/**
 * Resolve a pooled (format v2) replay record into its walk.
 */
export function buildReplayWalk(record: GgReplayRecord): ReplayWalk {
  const blobs: PooledImage[] = (record.blobs ?? []).map((blob) => ({
    mediaType: blob.mediaType,
    bytes: blob.bytes,
    dataBase64: blob.dataBase64,
  }));
  const texts = record.texts ?? [];
  // The clip table is sparse and keyed by pool index, so it is turned into a lookup once
  // rather than scanned per payload.
  const clips = new Map<number, number>(
    (record.clips ?? []).map((clip) => [clip.text, clip.originalBytes]),
  );
  const resolveText = (index: number | undefined): ReplayText => {
    const text = index == null ? "" : (texts[index] ?? "");
    const originalBytes = index == null ? undefined : clips.get(index);
    return {
      text,
      clip:
        originalBytes == null
          ? null
          : // Measured in UTF-8 bytes, as the recorder measured it — a payload of
            // multi-byte characters would otherwise report a "kept" figure larger than
            // the ceiling that produced it.
            {
              originalBytes,
              keptBytes: new TextEncoder().encode(text).length,
            },
    };
  };
  const resolveBlob = (index: number): PooledImage | null =>
    blobs[index] ?? null;
  const resolveMessage = (index: number): PooledMessage | null => {
    const pooled = record.messages?.[index];
    if (!pooled) return null;
    return pooledFromBody(pooled.id, pooled.body, resolveBlob);
  };

  const steps = assemble(
    [...(record.entries ?? [])]
      .sort((a, b) => a.seq - b.seq)
      .map((entry) =>
        walkEntry(entry, record, resolveMessage, resolveText, resolveBlob),
      ),
  );
  // What the *recorder* wrote, which `upgradedFrom` carries once a pre-v2 body has been
  // read into the v2 shape; the document's own version is always the current one by
  // then. Absent on a record captured at the version it reports.
  const capturedFormatVersion = record.upgradedFrom ?? record.formatVersion;
  return {
    sessionId: record.sessionId,
    capabilitySet: record.capabilitySet,
    recorder: record.recorder ?? {},
    fidelity: record.fidelity ?? "standard",
    capturedFormatVersion,
    capturedBeforeV2: capturedFormatVersion < GG_REPLAY_FORMAT_VERSION,
    truncation: record.truncation ?? null,
    prompt: record.seed?.prompt ? record.seed.prompt : null,
    agents: walkAgents(steps, record.agents ?? []),
    steps,
  };
}

/**
 * Resolve a **legacy** (format v1) replay record into the same walk.
 *
 * A v1 record is a transcript: every turn carries its whole conversation and its whole
 * offered-tool array inline, and only two of the eight input kinds exist at all. It is
 * read here rather than upgraded into the v2 shape first because the upgrade's defining
 * step is content-addressing every pooled body, and a walk that fabricated those ids to
 * reuse one code path would be claiming a provenance the record does not have. What the
 * two paths genuinely share — the resolution of a body into a message, the fold of
 * entries into steps — they share as functions.
 */
export function buildLegacyReplayWalk(record: GgReplayRecordV1): ReplayWalk {
  const steps = assemble(
    [...(record.entries ?? [])]
      .sort((a, b) => a.seq - b.seq)
      .map((entry, index) => legacyWalkEntry(entry, index)),
  );
  return {
    sessionId: record.sessionId,
    capabilitySet: record.capabilitySet,
    recorder: {},
    // v1 capture was opt-in, so every v1 record *was* opted into — but none of them
    // carries a single full-only input, and reporting one as `full` would invite the
    // reader to conclude the session had no clock reads rather than that the build had
    // no clock capture. Mirrors the same choice in the Rust upgrade.
    fidelity: "standard",
    capturedFormatVersion: GG_REPLAY_FORMAT_V1,
    capturedBeforeV2: true,
    truncation: null,
    prompt: null,
    agents: walkAgents(steps, []),
    steps,
  };
}

// One entry of the input log, resolved but not yet folded into a step.
type WalkEntry = { agentId: string; seq: number } & (
  | {
      kind: "model_io";
      role: GgClientRole;
      shape: GgReplayRequestShape;
      request: ReplayRequestRow[];
      tools: ReplayToolDefinition[];
      response: ReplayResponse | null;
      error: null;
    }
  | {
      kind: "model_error";
      role: GgClientRole;
      shape: GgReplayRequestShape;
      request: ReplayRequestRow[];
      tools: ReplayToolDefinition[];
      response: null;
      error: GgReplayModelError;
    }
  | { kind: "tool_result"; result: ReplayToolResult }
  | { kind: "prompt_frame"; items: GgReplayPromptItem[] }
  | { kind: "side"; side: ReplaySideEntry }
);

/**
 * Fold the resolved input log into steps.
 *
 * A model call opens a step for its agent; everything the agent recorded afterwards —
 * its tool results, its prompt frame, its shell and clock reads — attaches to that open
 * step until its next call replaces it. This is the attachment rule the record itself is
 * written to (the frame lands after the call it describes and before the next one), so
 * the fold is a transcription of it rather than a guess.
 *
 * Only an **agent-role** call opens a step. A compaction summarizer's call is a step of
 * its own — that is what the client-role discriminator is for — but it consumes no tools
 * and builds no window, so nothing may attach to it, and letting it become the agent's
 * open step would hand the agent's next tool result to the summarizer.
 */
function assemble(entries: WalkEntry[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  const open = new Map<string, ReplayStep>();

  // The step an attaching input belongs to: its agent's currently-open turn, or a
  // synthetic orphan step so nothing recorded is ever dropped.
  const attachTo = (entry: WalkEntry): ReplayStep => {
    const step = open.get(entry.agentId);
    if (step) return step;
    const orphan = emptyStep(entry.agentId, entry.seq, true);
    steps.push(orphan);
    open.set(entry.agentId, orphan);
    return orphan;
  };

  for (const entry of entries) {
    switch (entry.kind) {
      case "model_io":
      case "model_error": {
        const step: ReplayStep = {
          ...emptyStep(entry.agentId, entry.seq, false),
          role: entry.role,
          shape: entry.shape,
          request: entry.request,
          tools: entry.tools,
          response: entry.response,
          error: entry.error,
        };
        steps.push(step);
        if (entry.role === "agent") open.set(entry.agentId, step);
        break;
      }
      case "tool_result":
        attachTo(entry).toolResults.push(entry.result);
        break;
      case "prompt_frame":
        joinContext(attachTo(entry).request, entry.items);
        break;
      case "side":
        attachTo(entry).side.push(entry.side);
        break;
    }
  }
  return steps;
}

function emptyStep(agentId: string, seq: number, orphan: boolean): ReplayStep {
  return {
    key: `${agentId}#${seq}`,
    agentId,
    seq,
    role: "agent",
    shape: "complete",
    request: [],
    tools: [],
    response: null,
    error: null,
    toolResults: [],
    side: [],
    orphan,
  };
}

/**
 * Place each prompt-frame item onto the request message it describes, in place.
 *
 * **Positionally when the two agree**, because the frame *is* that window: it holds the
 * items in the order they were rendered to the client, which is the order the request
 * carries them in. When the counts differ — a truncated frame, or a build whose window
 * contributed a message the frame did not record — each row instead takes the first
 * unclaimed item naming its own pool index, so a mismatch costs the rows it actually
 * affects rather than shifting every band by one.
 */
export function joinContext(
  rows: ReplayRequestRow[],
  items: GgReplayPromptItem[],
): void {
  if (rows.length === items.length) {
    rows.forEach((row, index) => {
      row.context = contextItem(items[index]!);
    });
    return;
  }
  const byIndex = new Map<number, GgReplayPromptItem[]>();
  for (const item of items) {
    const queue = byIndex.get(item.message);
    if (queue) queue.push(item);
    else byIndex.set(item.message, [item]);
  }
  for (const row of rows) {
    if (row.poolIndex == null) continue;
    const item = byIndex.get(row.poolIndex)?.shift();
    if (item) row.context = contextItem(item);
  }
}

function contextItem(item: GgReplayPromptItem): ReplayContextItem {
  return {
    slot: item.slot,
    source: item.source,
    retention: item.retention,
    turn: item.turn,
    label: item.label ?? null,
    region: item.region ?? null,
  };
}

// ---------------------------------------------------------------------------
// Entry resolution
// ---------------------------------------------------------------------------

function walkEntry(
  entry: GgReplayEntry,
  record: GgReplayRecord,
  resolveMessage: (index: number) => PooledMessage | null,
  resolveText: (index: number | undefined) => ReplayText,
  resolveBlob: (index: number) => PooledImage | null,
): WalkEntry {
  const at = { agentId: entry.agentId, seq: entry.seq };
  switch (entry.type) {
    case "model_io":
    case "model_error": {
      const request = entry.request.messages.map((poolIndex, position) => ({
        key: `${poolIndex}@${position}`,
        poolIndex,
        message: resolveMessage(poolIndex),
        context: null,
      }));
      const tools = readToolDefinitions(
        entry.request.toolset == null
          ? null
          : (record.toolsets?.[entry.request.toolset]?.tools ?? null),
      );
      return entry.type === "model_io"
        ? {
            ...at,
            kind: "model_io",
            role: entry.request.role,
            shape: entry.request.shape,
            request,
            tools,
            response: readResponse(entry.response),
            error: null,
          }
        : {
            ...at,
            kind: "model_error",
            role: entry.request.role,
            shape: entry.request.shape,
            request,
            tools,
            response: null,
            error: entry.error,
          };
    }
    case "tool_result":
      return {
        ...at,
        kind: "tool_result",
        result: {
          key: `tool-${entry.seq}`,
          seq: entry.seq,
          id: entry.call.id,
          name: entry.call.name,
          arguments: entry.call.arguments,
          cwd: formatShellCwd(entry.call.cwd),
          ok: entry.outcome.ok,
          output: resolveText(entry.outcome.output),
          summary:
            entry.outcome.summary == null
              ? null
              : resolveText(entry.outcome.summary).text,
          images: (entry.outcome.images ?? [])
            .map(resolveBlob)
            .filter((image): image is PooledImage => image != null),
          data: entry.outcome.data ?? null,
          failure: entry.outcome.failure ?? null,
        },
      };
    case "prompt_frame":
      return { ...at, kind: "prompt_frame", items: entry.items };
    case "shell":
      return {
        ...at,
        kind: "side",
        side: {
          key: `shell-${entry.seq}`,
          seq: entry.seq,
          kind: "shell",
          origin: entry.origin,
          command: readCommand(entry.command, resolveText),
        },
      };
    case "git":
      return {
        ...at,
        kind: "side",
        side: {
          key: `git-${entry.seq}`,
          seq: entry.seq,
          kind: "git",
          command: readCommand(entry.command, resolveText),
        },
      };
    case "cancel_probe":
      return {
        ...at,
        kind: "side",
        side: {
          key: `cancel-${entry.seq}`,
          seq: entry.seq,
          kind: "cancel_probe",
          canceled: entry.canceled,
        },
      };
    case "clock":
      return {
        ...at,
        kind: "side",
        side: {
          key: `clock-${entry.seq}`,
          seq: entry.seq,
          kind: "clock",
          elapsedMs: entry.elapsedMs,
          remainingMs: entry.remainingMs ?? null,
        },
      };
  }
}

// A v1 entry: the same two kinds, with every payload inline instead of pooled.
function legacyWalkEntry(entry: GgReplayEntryV1, index: number): WalkEntry {
  const at = { agentId: entry.agentId, seq: entry.seq };
  if (entry.type === "model_io") {
    const messages = asArray(entry.request.messages);
    return {
      ...at,
      kind: "model_io",
      // v1 predates both discriminators, and every request it holds was an ordinary
      // agent call: gg's second client was never wrapped in the recorder at all.
      role: "agent",
      shape: "complete",
      request: messages.map((body, position) => ({
        key: `v1-${index}-${position}`,
        poolIndex: null,
        message: pooledFromBody(
          `v1-${index}-${position}`,
          asRecord(body) ?? {},
          () => null,
        ),
        context: null,
      })),
      tools: readToolDefinitions(entry.request.tools ?? null),
      response: readResponse(entry.response),
      error: null,
    };
  }
  const outcome = entry.outcome;
  return {
    ...at,
    kind: "tool_result",
    result: {
      key: `tool-${entry.seq}`,
      seq: entry.seq,
      id: asString(entry.call.id) ?? "",
      name: asString(entry.call.name) ?? "(unknown)",
      arguments: entry.call.arguments ?? null,
      cwd: null,
      ok: typeof outcome.ok === "boolean" ? outcome.ok : false,
      // A v1 record predates both pooling and clipping, so its payload is inline and is
      // by definition whole.
      output: { text: asString(outcome.output) ?? "", clip: null },
      summary: asString(outcome.summary),
      images: asArray(outcome.images)
        .map(readInlineImage)
        .filter((image): image is PooledImage => image != null),
      data: asRecord(outcome.data),
      failure: asRecord(outcome.failure),
    },
  };
}

// ---------------------------------------------------------------------------
// Payload readers
// ---------------------------------------------------------------------------
//
// The bodies a record pools are owned by the `gg` binary — its `Message`,
// `ToolDefinition` and `ModelResponse` — so the contract carries them as free-form JSON
// and these narrow them for display, tolerating a missing or oddly-shaped field rather
// than throwing. That leniency is the same one the walk itself has: this is a captured
// record being read after the fact, and a partial one should still render.

/**
 * Resolve one pooled message body into the shape the message-row component renders,
 * inflating each [blob reference](BLOB_REF_KEY) back into the image it stands for.
 *
 * `tokens` is deliberately left absent: a replay record pins the exact bodies but not
 * gg's per-item estimate of what they cost, and a `0` there would report a real message
 * as free.
 */
function pooledFromBody(
  id: string,
  body: Record<string, unknown>,
  resolveBlob: (index: number) => PooledImage | null,
): PooledMessage {
  return {
    id,
    role: asString(body.role) ?? "?",
    content: asString(body.content) ?? undefined,
    toolCalls: asArray(body.toolCalls).map(readToolCall),
    toolCallId: asString(body.toolCallId) ?? undefined,
    images: asArray(body.images)
      .map((image) => {
        const reference = blobRefIndex(image);
        return reference == null
          ? readInlineImage(image)
          : resolveBlob(reference);
      })
      .filter((image): image is PooledImage => image != null),
  };
}

/** The blob-pool index a `{ "$blob": n }` reference names, or `null` for anything else. */
function blobRefIndex(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) return null;
  const index = record[BLOB_REF_KEY];
  return typeof index === "number" ? index : null;
}

// An image carried inline — how a v1 record and an un-substituted body hold one.
function readInlineImage(value: unknown): PooledImage | null {
  const record = asRecord(value);
  const mediaType = asString(record?.mediaType);
  if (!record || mediaType == null) return null;
  return {
    mediaType,
    bytes: typeof record.bytes === "number" ? record.bytes : 0,
    dataBase64: asString(record.dataBase64) ?? undefined,
  };
}

function readToolCall(value: unknown): GgLoggedToolCall {
  const record = asRecord(value) ?? {};
  return {
    id: asString(record.id) ?? "",
    name: asString(record.name) ?? "(unknown)",
    args: asRecord(record.arguments) ?? {},
  };
}

function readToolDefinitions(value: unknown): ReplayToolDefinition[] {
  return asArray(value).map((tool) => {
    const record = asRecord(tool) ?? {};
    return {
      name: asString(record.name) ?? "(unknown)",
      description: asString(record.description) ?? "",
    };
  });
}

/**
 * Narrow a recorded `ModelResponse` into the reply as a message plus the two facts that
 * are not part of one: why the turn stopped and what it cost.
 *
 * The message's `tokens` is the turn's **output** total — the reply's own cost, which is
 * what the token column means. The input side belongs to the request, not to this row.
 */
function readResponse(value: unknown): ReplayResponse | null {
  const record = asRecord(value);
  if (!record) return null;
  const usage = asRecord(record.usage);
  const cost = asRecord(record.cost);
  return {
    message: {
      id: "response",
      role: "assistant",
      content: asString(record.text) ?? undefined,
      toolCalls: asArray(record.toolCalls).map(readToolCall),
      images: [],
      tokens: sumReported(asNumber(usage?.output), asNumber(usage?.reasoning)),
    },
    finishReason: readFinishReason(record.finishReason),
    cost: asNumber(cost?.comparable) ?? asNumber(cost?.actual),
  };
}

// gg's `FinishReason` serializes either as a bare string (`"stop"`, `"tool_calls"`, …)
// or, for the catch-all `Other(String)`, as `{ other: "…" }`.
function readFinishReason(value: unknown): string | null {
  const bare = asString(value);
  if (bare) return bare;
  const other = asString(asRecord(value)?.other);
  return other == null ? null : `other: ${other}`;
}

function readCommand(
  command: GgReplayCommand,
  resolveText: (index: number | undefined) => ReplayText,
): ReplayCommand {
  return {
    command: command.command,
    cwd: formatShellCwd(command.cwd),
    exitCode: command.exitCode,
    stdout: resolveText(command.stdout),
    stderr: resolveText(command.stderr),
  };
}

/**
 * Where a recorded command ran, as one readable string: `null` for the workspace root
 * (the overwhelming majority, and a row that said "workspace" on every line would be
 * noise), the relative path for a subdirectory, and the absolute path — which is not
 * portable, and is recorded precisely so that is visible — spelled out in full.
 */
export function formatShellCwd(cwd: GgShellCwd | undefined): string | null {
  if (cwd == null || cwd.type === "workspace") return null;
  return cwd.path;
}

// ---------------------------------------------------------------------------
// Display derivations
// ---------------------------------------------------------------------------

// What each window slot is called in the Context column. `thread` is the ordinary case
// and is left unsaid; the other two are named because a system prompt and a rebuilt
// context-usage signal are otherwise indistinguishable — both `system`-banded, both
// pinned, both unlabelled — which is the single most valuable thing the prompt frame
// records.
const SLOT_LABELS: Record<GgReplayPromptSlot, string | null> = {
  system: "system slot",
  thread: null,
  context_usage: "usage slot",
};

/**
 * The Context column's one line for a message: its slot (where that says something the
 * band does not), whether it survives compaction, the turn it was pushed on, and — for a
 * labelled item — its selector, with a paged file view's `path@offset+limit` window.
 */
export function contextSummary(item: ReplayContextItem): string {
  const parts: string[] = [];
  const slot = SLOT_LABELS[item.slot];
  if (slot) parts.push(slot);
  parts.push(item.retention);
  parts.push(`t${item.turn}`);
  const view = viewLabel(item);
  if (view) parts.push(view);
  return parts.join(" · ");
}

/**
 * A labelled item's selector, with a paged view's window appended where it has one.
 *
 * Not file-specific: a selector is a workspace path on a file view and the agent's own label
 * on a text view, and only the first kind is ever paged. The region is appended only when the
 * record carries one, so a text view reads as its bare label rather than as a window over a
 * file it is not.
 */
export function viewLabel(item: ReplayContextItem): string | null {
  if (item.label == null) return null;
  return item.region == null
    ? item.label
    : `${item.label}@${item.region.offset}+${item.region.limit}`;
}

/**
 * What a truncation means, in a sentence.
 *
 * Every reason is a *recorded fact* rather than an error — capture degrades, it never
 * fails the run it observes — so each reads as a statement about the capture, and each
 * says where the record stops so a reader can tell "the session ended here" from "the
 * recording ended here".
 */
export function truncationNotice(truncation: GgReplayTruncation): string {
  const upTo =
    truncation.lastSeq == null
      ? ""
      : ` Everything up to seq ${truncation.lastSeq} is intact.`;
  switch (truncation.reason) {
    case "byte_ceiling":
      return `Capture stopped at the run's replay byte ceiling${
        truncation.bytes == null ? "" : ` (${formatBytes(truncation.bytes)})`
      }, so this record ends before the session did.${upTo}`;
    case "session_killed":
      return `The session was killed mid-capture — the journal has no end marker, so the record ends wherever gg stopped.${upTo}`;
    case "corrupt_journal":
      return `The capture journal was damaged, so the record was cut at the last entry that read cleanly.${upTo}`;
    case "write_failed":
      return `Capture could not write to its journal and stopped for the rest of the run.${upTo}`;
  }
}

/** A byte figure for a notice — the ceiling a capture stopped at. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** How an agent came to exist, as a short phrase for the agent filter. */
export function originLabel(agent: GgReplayAgent): string {
  const origin = agent.origin;
  switch (origin.type) {
    case "root":
      return "root";
    case "spawn":
      return `spawned by ${origin.parent} #${origin.ordinal}`;
    case "succession":
      return `succeeded ${origin.predecessor} #${origin.ordinal}`;
    case "issue_attempt":
      return `issue ${origin.issue}, attempt ${origin.attempt}`;
    case "reviewer":
      return `review of ${origin.issue}, round ${origin.round} #${origin.position}`;
    case "merge":
      return `merge of ${origin.issue} #${origin.ordinal}`;
  }
}

/**
 * The agents the filter offers: those that took a step, in first-appearance order, then
 * any the provenance table names that never did.
 *
 * An agent with no steps is worth listing rather than hiding — a spawned agent that
 * never reached a model call is a fact about the run, and the table is the only place it
 * is recorded at all.
 */
function walkAgents(
  steps: ReplayStep[],
  table: GgReplayAgent[],
): ReplayWalkAgent[] {
  const rows = new Map<string, ReplayWalkAgent>();
  const byId = new Map(table.map((agent) => [agent.agentId, agent]));
  const row = (id: string): ReplayWalkAgent => {
    let existing = rows.get(id);
    if (!existing) {
      const recorded = byId.get(id);
      existing = {
        id,
        profile: recorded?.profile ?? null,
        origin: recorded ? originLabel(recorded) : null,
        terminalStatus: recorded?.terminalStatus ?? null,
        limitHit: recorded?.limitHit ?? null,
        steps: 0,
      };
      rows.set(id, existing);
    }
    return existing;
  };
  for (const step of steps) row(step.agentId).steps += 1;
  for (const agent of table) row(agent.agentId);
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The sum of two optionally-reported counts: absent only when neither was reported, so a
// provider that folds reasoning into `output` still yields a total rather than nothing.
function sumReported(a: number | null, b: number | null): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}
