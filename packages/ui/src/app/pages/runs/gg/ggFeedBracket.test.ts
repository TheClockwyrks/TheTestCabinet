// The feed's call bracket, tested on the WHOLE stream rather than on a per-agent slice.
//
// `foldFeedRows` suppresses a `tool_call` row while its agent has an `api_call` bracket open,
// so one action reads as one row in the model's own spelling. The bracket is keyed per emitting
// agent, and this file exists because that key is the part a test can accidentally stop
// checking.
//
// A delegation is where it matters. `api_call` is emitted BEFORE the work, so `agents.spawn`
// holds its bracket open for as long as the parent waits — which is the child's entire sub-run.
// A run-wide flag would suppress every tool row the child emitted during that wait, and the
// child's feed would go silent for the one stretch anybody would be reading it.
//
// The trap: `reduceGgEventsPerAgent` buckets by `agentId` and folds each bucket separately, so
// the parent's `api_call` never enters the child's partition at all. A test that opens the
// child's slice therefore passes under a run-wide flag just as happily as under a per-agent
// one — it cannot fail for the reason it was written. So these fold the combined stream, where
// both agents' events meet and the key is actually load-bearing.

import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { reduceGgEvents } from "./useGgRunState";

const TS = "2026-08-04T00:00:00Z";

function gg(
  agentId: string,
  kind: GgTelemetryKind,
  parentAgentId?: string,
): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId,
      parentAgentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

const spawn = (agentId: string, slot: string, depth: number, parent?: string) =>
  gg(
    agentId,
    {
      type: "agent_spawned",
      slot,
      modelId: "mock/scripted-builder",
      depth,
    } as GgTelemetryKind,
    parent,
  );

const apiCall = (agentId: string, object: string, fn: string) =>
  gg(agentId, { type: "api_call", object, function: fn } as GgTelemetryKind);

const apiResult = (agentId: string, object: string, fn: string) =>
  gg(agentId, {
    type: "api_result",
    object,
    function: fn,
    ok: true,
  } as GgTelemetryKind);

const toolCall = (agentId: string, name: string, args: unknown) =>
  gg(agentId, { type: "tool_call", name, args } as GgTelemetryKind);

const toolResult = (agentId: string, name: string) =>
  gg(agentId, {
    type: "tool_result",
    name,
    ok: true,
    summary: "1 kB",
  } as GgTelemetryKind);

// Every row a given agent contributed, in order — the reading each agent's feed shows.
const rowsFor = (feed: { agentId?: string; detail: string }[], id: string) =>
  feed.filter((row) => row.agentId === id).map((row) => row.detail);

describe("the feed's call bracket, folded over the whole stream", () => {
  it("does not let a parent's open bracket suppress a child's tool rows", () => {
    // The ordering a real delegation produces: the parent opens `agents.spawn`, the child
    // runs its whole sub-run inside that window, and only then does the parent's call return.
    const state = reduceGgEvents([
      spawn("root", "Root", 0),
      spawn("agent-0", "worker", 1, "root"),
      apiCall("root", "agents", "spawn"),
      toolCall("agent-0", "read_file", { path: "b.ts" }),
      toolResult("agent-0", "read_file"),
      apiResult("root", "agents", "spawn"),
    ]);

    // The child called a tool and its feed says so. Under a run-wide bracket this is the
    // assertion that breaks: the parent's open call would have eaten both rows.
    const child = rowsFor(state.feed, "agent-0");
    expect(child.some((detail) => detail.includes("read_file"))).toBe(true);

    // ...and the parent's own bracket still reads as the one call it made, in the model's
    // spelling, with no `read_file` attributed to it.
    const parent = rowsFor(state.feed, "root");
    expect(parent.some((detail) => detail.includes("agents.spawn"))).toBe(true);
    expect(parent.some((detail) => detail.includes("read_file"))).toBe(false);
  });

  it("still absorbs a bridged tool call into the bracket of the agent that opened it", () => {
    // The other half of the same key: suppression must happen when the tool call really is
    // the parent's own. Same shape as above, one agent instead of two.
    const state = reduceGgEvents([
      spawn("root", "Root", 0),
      apiCall("root", "fs", "read_file"),
      toolCall("root", "read_file", { path: "a.ts" }),
      toolResult("root", "read_file"),
      apiResult("root", "fs", "read_file"),
    ]);

    const rows = rowsFor(state.feed, "root");
    // One action, one call row: the tool underneath contributes no row of its own.
    expect(rows.filter((detail) => detail.includes("read_file")).length).toBe(
      rows.filter((detail) => detail.includes("fs.read")).length,
    );
    expect(rows.some((detail) => detail === "read_file")).toBe(false);
  });
});
