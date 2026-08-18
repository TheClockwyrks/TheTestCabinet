// What an agent was OFFERED, reduced onto the instance that reported it.
//
// The thing worth pinning here is the routing. A surface is the one fact on the stream that
// answers "could this agent have called that?", and it only answers it if it lands on the
// right instance: a root's toolset shown against a subagent would turn the feature into a
// lie that reads exactly like the truth. So these check both folds — the whole stream and
// the per-agent partitions — and the absence case, since an instance read before its
// surface arrives must reduce to no surface at all rather than to an empty one.

import { describe, expect, it } from "vitest";
import type {
  GgAgentApi,
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { reduceGgEvents, reduceGgEventsPerAgent } from "./useGgRunState";
import { apiCallSpellings } from "./ggSurfaceCalls";

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

const spawn = (agentId: string, profileId: string, parentAgentId?: string) =>
  gg(
    agentId,
    {
      type: "agent_spawned",
      profileId,
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
  docViewTypes?: string,
): HarnessEvent {
  return gg(agentId, {
    type: "agent_surface",
    executionMode: apis ? "responses_as_code" : "tool_calling",
    tools,
    // Omitted rather than empty for tool calling, exactly as gg writes it, so the reducer's
    // normalization is what these exercise. `docViewTypes` is omitted the same way by an
    // agent that opens no documentation at all.
    ...(apis ? { apis } : {}),
    ...(docViewTypes ? { docViewTypes } : {}),
  } as GgTelemetryKind);
}

describe("agent surface reduction", () => {
  it("lands each instance's surface on its own node", () => {
    const events = [
      spawn("root", "root"),
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
      spawn("root", "root"),
      surface("root", ["shell"]),
    ]);
    expect(state.agents.get("root")?.surface?.apis).toEqual([]);
  });

  it("keeps a responses-as-code agent's modules and each function's own operation", () => {
    const state = reduceGgEvents([
      spawn("root", "root"),
      surface(
        "root",
        ["read_file", "finish"],
        [
          {
            module: "files",
            path: "gg.files",
            description: "Read and write the workspace.",
            functions: [{ name: "readFile", operation: "files.read_file" }],
          },
          {
            module: "views",
            path: "gg.views",
            description: "Show the model something.",
            // No tool backs this one, and it carries an operation all the same: the API
            // layer counts it exactly as it counts the read next to it.
            functions: [{ name: "openFile", operation: "views.open_file" }],
          },
        ],
      ),
    ]);

    const apis = state.agents.get("root")!.surface!.apis;
    // Both names survive the reduction, because they are for different readers: the id is
    // what a cross-arm reader groups by, and the path is what the model wrote.
    expect(apis.map((api) => api.module)).toEqual(["files", "views"]);
    expect(apis.map((api) => api.path)).toEqual(["gg.files", "gg.views"]);
    expect(apis[0]!.functions[0]!.operation).toBe("files.read_file");
    expect(apis[1]!.functions[0]!.operation).toBe("views.open_file");
  });

  it("keeps the documentation mode each instance was on, and normalizes its absence", () => {
    // The arm of a per-agent A/B. It has to land on the instance, not the run: one run can
    // hold two agents in two modes, and a reader attributing the documentation band's tokens
    // to a mode needs the mode of the agent that spent them.
    const state = reduceGgEvents([
      spawn("root", "root"),
      surface(
        "root",
        ["read_file"],
        [
          {
            module: "files",
            path: "gg.files",
            description: "Read and write the workspace.",
            functions: [{ name: "readFile", operation: "files.read_file" }],
          },
        ],
        "return+parameters+errors",
      ),
      spawn("agent-1", "reviewer", "root"),
      surface("agent-1", ["read_file"]),
    ]);
    expect(state.agents.get("root")?.surface?.docViewTypes).toBe(
      "return+parameters+errors",
    );
    // A tool-calling instance opens no documentation and reports no mode; the reducer settles
    // that to null rather than leaving every consumer to tell absent from empty.
    expect(state.agents.get("agent-1")?.surface?.docViewTypes).toBeNull();
  });

  it("counts each api call under the operation it resolved to", () => {
    // The key is the OPERATION, so the same count is produced by an arm that spelled the
    // call `readFile` and one that spelled it `read_file`. Every model-facing call a
    // program makes has one — the documentation family included — so there is nothing here
    // that has to be counted under something else.
    const state = reduceGgEvents([
      spawn("root", "root"),
      gg("root", {
        type: "api_call",
        operation: "views.open_file",
      } as GgTelemetryKind),
      gg("root", {
        type: "api_result",
        operation: "views.open_file",
        ok: true,
      } as GgTelemetryKind),
      gg("root", {
        type: "api_call",
        operation: "docs.search",
      } as GgTelemetryKind),
      gg("root", {
        type: "api_call",
        operation: "docs.search",
      } as GgTelemetryKind),
    ]);

    expect(state.apiCalls.get("views.open_file")).toBe(1);
    expect(state.apiCalls.get("docs.search")).toBe(2);
    // The other surface's record stays empty: a program emits no `tool_call` at all.
    expect(state.toolCalls.size).toBe(0);
  });

  it("leaves a stream that never reported one with no surface", () => {
    // An instance read before its `agent_surface` arrived. Nothing degrades: the node is
    // exactly what it was, and the absence is what tells a read-out to render nothing.
    const state = reduceGgEvents([
      spawn("root", "root"),
      gg("root", { type: "turn_started" } as GgTelemetryKind),
    ]);
    expect(state.agents.get("root")?.surface).toBeUndefined();
    expect(state.agentForest[0]?.surface).toBeUndefined();
  });
});

describe("apiCallSpellings", () => {
  it("maps the recorded operation back to the spelling the model wrote", () => {
    // The wire carries gg's operation id and nothing else, so every read-out of what an
    // agent CALLED has to come back through the surface to say it the way the program said
    // it — and the two vocabularies genuinely differ, which is the point: `files.read_file`
    // is what a Rust arm's program would be recorded under too.
    const spellings = apiCallSpellings([
      {
        module: "files",
        path: "gg.files",
        description: "the workspace",
        functions: [
          { name: "readFile", operation: "files.read_file" },
          { name: "readTextFile", operation: "files.read_text_file" },
        ],
      },
      {
        module: "views",
        path: "gg.views",
        description: "show yourself something",
        functions: [{ name: "openFile", operation: "views.open_file" }],
      },
    ]);
    expect(spellings.get("files.read_file")).toBe("gg.files.readFile");
    expect(spellings.get("files.read_text_file")).toBe("gg.files.readTextFile");
    expect(spellings.get("views.open_file")).toBe("gg.views.openFile");
  });

  it("keeps an arm's canonical binding where two spellings serve one operation", () => {
    // An arm may offer a method beside the free function — the same operation, reached two
    // ways — and both rows carry the same figure, because gg counts what was done. The name
    // shown is the first, which is the binding every arm has; the alias follows it in the
    // catalogue and would otherwise overwrite it.
    const spellings = apiCallSpellings([
      {
        module: "delegation",
        path: "gg.delegation",
        description: "hand work to children",
        functions: [
          { name: "sendMessage", operation: "delegation.send_message" },
          { name: "SubagentHandle.send", operation: "delegation.send_message" },
        ],
      },
    ]);
    expect(spellings.get("delegation.send_message")).toBe(
      "gg.delegation.sendMessage",
    );
  });
});
