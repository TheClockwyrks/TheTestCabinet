// What an agent was OFFERED, reduced onto the instance that reported it.
//
// The thing worth pinning here is the routing. A surface is the one fact on the stream that
// answers "could this agent have called that?", and it only answers it if it lands on the
// right instance: a root's toolset shown against a subagent would turn the feature into a
// lie that reads exactly like the truth. So these check both folds — the whole stream and
// the per-agent partitions — and the absence case, since every run recorded before gg
// emitted the event must still reduce to no surface at all rather than an empty one.

import { describe, expect, it } from "vitest";
import type {
  GgAgentApi,
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { reduceGgEvents, reduceGgEventsPerAgent } from "./useGgRunState";

const TS = "2026-08-03T00:00:00Z";

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

const spawn = (agentId: string, slot: string, parentAgentId?: string) =>
  gg(
    agentId,
    {
      type: "agent_spawned",
      slot,
      modelId: "vendor/big",
      depth: parentAgentId == null ? 0 : 1,
    } as GgTelemetryKind,
    parentAgentId,
  );

/** The surface one instance reports as it opens. Tool-calling unless `apis` are given. */
function surface(
  agentId: string,
  tools: string[],
  apis?: GgAgentApi[],
  withheld?: string[],
): HarnessEvent {
  return gg(agentId, {
    type: "agent_surface",
    executionMode: apis ? "responses_as_code" : "tool_calling",
    tools,
    // Omitted rather than empty for tool calling, exactly as gg writes it, so the reducer's
    // normalization is what these exercise. `withheld` is omitted the same way by an agent
    // that ablated nothing — or whose ablation named nothing gg knows.
    ...(apis ? { apis } : {}),
    ...(withheld ? { withheld } : {}),
  } as GgTelemetryKind);
}

describe("agent surface reduction", () => {
  it("lands each instance's surface on its own node", () => {
    const events = [
      spawn("root", "Root"),
      surface("root", ["read_file", "spawn_agent", "finish"]),
      spawn("agent-1", "reviewer", "root"),
      surface("agent-1", ["read_file", "approve", "request_changes"]),
    ];

    // The whole-stream fold knows every instance's surface at once, which is what lets the
    // Agents panel fold a profile's instances without re-reading their partitions.
    const state = reduceGgEvents(events);
    expect(state.agents.get("root")?.surface?.tools).toEqual([
      "read_file",
      "spawn_agent",
      "finish",
    ]);
    expect(state.agents.get("agent-1")?.surface?.tools).toEqual([
      "read_file",
      "approve",
      "request_changes",
    ]);

    // And it rides the forest copy, which is what every consumer actually walks.
    const reviewer = state.agentForest[0]!.children[0]!;
    expect(reviewer.id).toBe("agent-1");
    expect(reviewer.surface?.executionMode).toBe("tool_calling");

    // Each partition carries its own instance's surface, so the Instances explorer reads it
    // from the same slice it reads everything else about that agent from.
    const perAgent = reduceGgEventsPerAgent(events);
    expect(
      perAgent.get("agent-1")?.agents.get("agent-1")?.surface?.tools,
    ).toContain("approve");
    // A partition is seeded with a root node whether or not root emitted into it; the seed
    // must not inherit a surface it never reported.
    expect(
      perAgent.get("agent-1")?.agents.get("root")?.surface,
    ).toBeUndefined();
  });

  it("normalizes a tool-calling agent's absent apis to an empty list", () => {
    // The wire omits the key entirely for tool calling, so the state layer settles it once
    // rather than leaving every consumer to tell absent from empty.
    const state = reduceGgEvents([
      spawn("root", "Root"),
      surface("root", ["shell"]),
    ]);
    expect(state.agents.get("root")?.surface?.apis).toEqual([]);
  });

  it("carries the ablation gg resolved, and normalizes its absence", () => {
    // `withheld` is gg's own answer to what the profile's `disabledTools` actually took
    // away — the entries that name a gg tool. It has to reach the node, because a console
    // re-deriving it from the configuration would assert an ablation gg found inert (a
    // typo, a tool since removed) as one that applied. gg simply leaves such a name out,
    // so an agent whose whole ablation was inert reports the key omitted, exactly like one
    // that ablated nothing — and both settle to empty here.
    const state = reduceGgEvents([
      spawn("root", "Root"),
      surface("root", ["read_file"], undefined, ["run_shell"]),
      spawn("agent-1", "reviewer", "root"),
      surface("agent-1", ["read_file"]),
    ]);
    expect(state.agents.get("root")?.surface?.withheld).toEqual(["run_shell"]);
    expect(state.agents.get("agent-1")?.surface?.withheld).toEqual([]);
  });

  it("keeps a responses-as-code agent's api objects and their gates", () => {
    const state = reduceGgEvents([
      spawn("root", "Root"),
      surface(
        "root",
        ["read_file", "finish"],
        [
          {
            object: "fs",
            description: "Read and write the workspace.",
            functions: [{ name: "readFile", tool: "read_file" }],
          },
          {
            object: "view",
            description: "Show the model something.",
            // No gate: a view call is not backed by a tool, so it has no call count to join.
            functions: [{ name: "openFile" }],
          },
        ],
      ),
    ]);

    const apis = state.agents.get("root")!.surface!.apis;
    expect(apis.map((api) => api.object)).toEqual(["fs", "view"]);
    expect(apis[0]!.functions[0]!.tool).toBe("read_file");
    expect(apis[1]!.functions[0]!.tool).toBeUndefined();
  });

  it("leaves a stream that never reported one with no surface", () => {
    // Every run recorded before gg emitted the event. Nothing degrades: the node is exactly
    // what it was, and the absence is what tells a read-out to render nothing.
    const state = reduceGgEvents([
      spawn("root", "Root"),
      gg("root", { type: "turn_started" } as GgTelemetryKind),
    ]);
    expect(state.agents.get("root")?.surface).toBeUndefined();
    expect(state.agentForest[0]?.surface).toBeUndefined();
  });
});
