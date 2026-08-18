// The **agent library** overlay: a configuration following a saved agent, and the
// derived set of fields it has pinned instead.
//
// Three things decide whether the feature works at all, and none of them is visible from
// the form:
//
// 1. An import that has not been touched must record *no* overrides. The overrides are
//    derived by comparing the profile against the saved agent, so anything the import
//    path does differently from the library — re-pointing a reference, seeding a param,
//    declaring a slot — would show up as a field pinned by a configuration nobody edited,
//    and would then stop following the saved agent forever.
// 2. A field the configuration has not pinned must follow the saved agent as it stands
//    *now*, which is the whole point of importing rather than duplicating.
// 3. gg must still be handed a whole agent. The resolution happens here; nothing
//    downstream of it knows an import ever existed.

import { describe, expect, it } from "vitest";
import type {
  GgAgentConfig,
  GgConfig,
  GgSavedAgent,
} from "@test-cabinet/run-record/gg";
import {
  agentOverrides,
  agentSourcesFromDraft,
  attachAgentSources,
  draftAgentOverrides,
  importSavedAgent,
  mergeAgentConfig,
  resolveCapabilitySet,
  revertImportedAgent,
  savedAgentFromDraft,
} from "./ggAgentLibrary";
import { DEFAULT_CAP_IDS } from "./ggCatalog";
import {
  blankAgentDraft,
  blankPrimaryModelSlot,
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  emptyDraft,
  seedAgentParams,
  seededRunLimits,
  wireAgentFromDraft,
  type GgConfigDraft,
} from "./ggConfigDraft";

/** A one-agent draft, the shape the standalone agent editor holds. */
function agentDraft(name: string): GgConfigDraft {
  const slot = blankPrimaryModelSlot();
  const blank = {
    ...blankAgentDraft(name, DEFAULT_CAP_IDS),
    modelSlotId: slot.id,
  };
  // Its `agent` params name itself, which is what the standalone editor seeds and what
  // an importing configuration carries onto the id it imports the profile under.
  const agent = seedAgentParams(blank, blank.id);
  return {
    agents: [agent],
    rootAgentId: agent.id,
    modelSlots: [slot],
    limits: seededRunLimits(),
    hooks: [],
  };
}

/** That draft as the library stores it. */
function saveAgent(id: string, draft: GgConfigDraft): GgSavedAgent {
  const body = savedAgentFromDraft(draft)!;
  return {
    id,
    name: body.agent.name,
    description: "",
    agent: body.agent,
    modelSlots: body.modelSlots,
    updatedAt: "2026-08-18T00:00:00Z",
  };
}

/** A saved agent called `reviewer`, deferring to a `primary` slot. */
function savedReviewer(
  edit: (draft: GgConfigDraft) => GgConfigDraft = (d) => d,
): GgSavedAgent {
  return saveAgent("saved-1", edit(agentDraft("reviewer")));
}

/** Patch the one agent of a draft. */
function patchAgent(
  draft: GgConfigDraft,
  agentId: string,
  patch: Partial<GgConfigDraft["agents"][number]>,
): GgConfigDraft {
  return {
    ...draft,
    agents: draft.agents.map((a) =>
      a.id === agentId ? { ...a, ...patch } : a,
    ),
  };
}

describe("importing a saved agent", () => {
  it("adds a profile that pins nothing", () => {
    const { draft, agentId } = importSavedAgent(emptyDraft(), savedReviewer());

    expect(draft.agents).toHaveLength(2);
    const imported = draft.agents.find((a) => a.id === agentId)!;
    // The id is minted from the saved profile's own, so what the configuration — and the
    // model it is shown to — names this profile by reads as the agent it came from.
    expect(agentId).toBe("reviewer");
    expect(imported.name).toBe("reviewer");
    expect(imported.source?.agentId).toBe("saved-1");
    // The one assertion the whole overlay rests on: an untouched import differs from the
    // saved agent in nothing at all.
    expect(draftAgentOverrides(draft, agentId)).toEqual([]);
  });

  it("does not become the root of a configuration that already has one", () => {
    const before = emptyDraft();
    const { draft, agentId } = importSavedAgent(before, savedReviewer());
    expect(draft.rootAgentId).toBe(before.rootAgentId);
    expect(draft.rootAgentId).not.toBe(agentId);
  });

  it("takes an id of its own, carrying its self-references onto it", () => {
    // The configuration already has an agent called `reviewer`, and the saved agent
    // lists itself in its own roster.
    const withRoster = savedReviewer((draft) => {
      const agent = draft.agents[0]!;
      return patchAgent(draft, agent.id, {
        subagents: [
          { agentId: agent.id, description: "itself", scopes: ["subagent"] },
        ],
      });
    });
    const base = emptyDraft();
    const renamed = {
      ...base,
      agents: base.agents.map((a) => ({ ...a, name: "reviewer" })),
    };

    const { draft, agentId } = importSavedAgent(renamed, withRoster);
    const imported = draft.agents.find((a) => a.id === agentId)!;
    // The other profile is called `reviewer` too — names collide freely — so what has to
    // be its own is the id, and the roster entry followed the import onto it rather than
    // resolving onto whichever profile the name would have matched.
    expect(imported.id).not.toBe(base.agents[0]!.id);
    expect(imported.subagents.map((s) => s.agentId)).toEqual([agentId]);
    // The display name is de-duplicated as a courtesy to whoever reads the list, and
    // nothing turns on it.
    expect(imported.name).toBe("reviewer-2");
    expect(draftAgentOverrides(draft, agentId)).toEqual([]);
  });

  it("declares a model slot the configuration does not have, with the library's default", () => {
    const saved = savedReviewer((draft) => ({
      ...draft,
      modelSlots: draft.modelSlots.map((s) => ({
        ...s,
        name: "critic",
        defaultModelId: "anthropic/claude-haiku-4.5",
      })),
    }));

    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const declared = draft.modelSlots.find((s) => s.name === "critic");
    expect(declared?.defaultModelId).toBe("anthropic/claude-haiku-4.5");
    const imported = draft.agents.find((a) => a.id === agentId)!;
    expect(imported.modelSlotId).toBe(declared?.id);
  });
});

describe("overrides", () => {
  it("names only the field that was edited", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const edited = patchAgent(draft, agentId, {
      customInstructions: "Be brief.",
    });
    expect(draftAgentOverrides(edited, agentId)).toEqual([
      "customInstructions",
    ]);
  });

  it("pins one capability rather than the whole set", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const imported = draft.agents.find((a) => a.id === agentId)!;
    const edited = patchAgent(draft, agentId, {
      capabilities: {
        ...imported.capabilities,
        shell: { ...imported.capabilities.shell!, enabled: false },
      },
    });
    expect(draftAgentOverrides(edited, agentId)).toEqual([
      "capabilities.shell",
    ]);
  });

  it("drops when the field is edited back to what the saved agent says", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const there = patchAgent(draft, agentId, {
      customInstructions: "Be brief.",
    });
    const back = patchAgent(there, agentId, { customInstructions: "" });
    expect(draftAgentOverrides(back, agentId)).toEqual([]);
  });

  it("is not raised by switching a capability off and on again", () => {
    // The editor appends a capability's calls when it is switched on, so the same set
    // comes back in a different order. Compared as a sequence that reads as the whole
    // allowlist being pinned — a field the operator never meant to stop following.
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const imported = draft.agents.find((a) => a.id === agentId)!;
    const shuffled = patchAgent(draft, agentId, {
      tools: [...imported.tools].reverse(),
      operations: [...imported.operations].reverse(),
      subagents: [...imported.subagents].reverse(),
    });
    expect(draftAgentOverrides(shuffled, agentId)).toEqual([]);
  });

  it("is raised by actually dropping a call from the allowlist", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const imported = draft.agents.find((a) => a.id === agentId)!;
    const narrowed = patchAgent(draft, agentId, {
      tools: imported.tools.slice(1),
    });
    expect(draftAgentOverrides(narrowed, agentId)).toEqual(["tools"]);
  });

  it("is not raised by renaming the profile", () => {
    // A name is the configuration's own display text and no field of the overlay at all:
    // nothing resolves a reference by reading one, so renaming a profile can never be the
    // thing that stops it following the library.
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const renamed = patchAgent(draft, agentId, { name: "critic" });
    expect(draftAgentOverrides(renamed, agentId)).toEqual([]);
  });
});

describe("merging", () => {
  it("takes an unpinned field from the saved agent and a pinned one from the configuration", () => {
    const base: GgAgentConfig = {
      id: "reviewer",
      name: "reviewer",
      capabilities: [],
      modelId: "",
      customInstructions: "from the library",
      systemPromptTemplate: "pinned here",
    };
    const stored: GgAgentConfig = {
      id: "reviewer",
      name: "reviewer",
      capabilities: [],
      modelId: "",
      customInstructions: "stale copy",
      systemPromptTemplate: "pinned here",
    };
    const merged = mergeAgentConfig(base, stored, ["systemPromptTemplate"]);
    expect(merged.customInstructions).toBe("from the library");
    expect(merged.systemPromptTemplate).toBe("pinned here");
  });

  it("keeps the configuration's identity and carries the saved agent's self-references onto it", () => {
    const base: GgAgentConfig = {
      id: "reviewer",
      name: "reviewer",
      capabilities: [],
      modelId: "",
      subagents: [
        { agentId: "reviewer", description: "itself", scopes: ["subagent"] },
      ],
    };
    const stored: GgAgentConfig = {
      id: "reviewer-2",
      name: "Second opinion",
      capabilities: [],
      modelId: "",
    };
    const merged = mergeAgentConfig(base, stored, []);
    // Both halves of the identity are the configuration's: the id because every other
    // reference in the set holds it, the name because it is the configuration's own text.
    expect(merged.id).toBe("reviewer-2");
    expect(merged.name).toBe("Second opinion");
    expect(merged.subagents?.[0]?.agentId).toBe("reviewer-2");
  });

  it("finds no override between an agent and itself", () => {
    const saved = savedReviewer();
    expect(agentOverrides(saved.agent, saved.agent)).toEqual([]);
  });
});

describe("resolving a stored configuration", () => {
  /** A stored configuration holding one imported profile. */
  function storedConfig(saved: GgSavedAgent, overrides: string[]): GgConfig {
    const { draft } = importSavedAgent(emptyDraft(), saved);
    return {
      id: "cfg-1",
      name: "review arm",
      description: "",
      capabilitySet: capabilitySetFromDraft(draft, "review arm"),
      agentSources: [{ profileId: "reviewer", agentId: saved.id, overrides }],
      updatedAt: "2026-08-18T00:00:00Z",
    };
  }

  it("carries a change to the saved agent into a field the configuration does not pin", () => {
    const config = storedConfig(savedReviewer(), []);
    const moved = savedReviewer((draft) =>
      patchAgent(draft, draft.agents[0]!.id, {
        customInstructions: "Be brief.",
      }),
    );

    const resolved = resolveCapabilitySet(config, [moved]);
    const reviewer = resolved.agents?.find((a) => a.id === "reviewer");
    expect(reviewer?.customInstructions).toBe("Be brief.");
  });

  it("leaves a pinned field alone when the saved agent moves", () => {
    const config = storedConfig(savedReviewer(), ["customInstructions"]);
    const moved = savedReviewer((draft) =>
      patchAgent(draft, draft.agents[0]!.id, {
        customInstructions: "Be brief.",
      }),
    );

    const resolved = resolveCapabilitySet(config, [moved]);
    const reviewer = resolved.agents?.find((a) => a.id === "reviewer");
    expect(reviewer?.customInstructions).toBeUndefined();
  });

  it("falls back to the configuration's own copy when the saved agent is gone", () => {
    const config = storedConfig(savedReviewer(), []);
    const resolved = resolveCapabilitySet(config, []);
    expect(resolved.agents).toEqual(config.capabilitySet.agents);
  });

  it("declares a slot the saved agent picked up after the configuration was stored", () => {
    const config = storedConfig(savedReviewer(), []);
    const moved = savedReviewer((draft) => ({
      ...draft,
      modelSlots: draft.modelSlots.map((s) => ({
        ...s,
        name: "critic",
        defaultModelId: "anthropic/claude-haiku-4.5",
      })),
    }));

    const resolved = resolveCapabilitySet(config, [moved]);
    expect(resolved.modelSlots).toContainEqual({
      name: "critic",
      defaultModelId: "anthropic/claude-haiku-4.5",
    });
  });
});

describe("detaching and reverting", () => {
  it("records no source for a profile whose saved agent has gone", () => {
    const saved = savedReviewer();
    const { draft } = importSavedAgent(emptyDraft(), saved);
    const orphaned = attachAgentSources(
      { ...draft, agents: draft.agents.map((a) => ({ ...a, source: null })) },
      [{ profileId: "reviewer", agentId: saved.id, overrides: [] }],
      [],
    );
    expect(agentSourcesFromDraft(orphaned)).toEqual([]);
  });

  it("restores the saved agent's fields while keeping the profile's identity", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const edited = patchAgent(draft, agentId, {
      customInstructions: "Be brief.",
      name: "critic",
    });

    const reverted = revertImportedAgent(edited, agentId);
    const agent = reverted.agents.find((a) => a.id === agentId)!;
    // Same id and same position, so every reference to it survives — a roster entry, an
    // `agent` param, the source itself — and the display name it was given is kept too.
    expect(reverted.agents.map((a) => a.id)).toEqual(
      edited.agents.map((a) => a.id),
    );
    expect(agent.name).toBe("critic");
    expect(agent.source?.agentId).toBe(saved.id);
    expect(wireAgentFromDraft(reverted, agentId)?.customInstructions).toBe(
      undefined,
    );
    expect(draftAgentOverrides(reverted, agentId)).toEqual([]);
  });
});

// Storing a configuration and opening it again.
//
// This is the failure the whole design turns on. Overrides are derived by comparison, so
// anything the load path does differently from the save path shows up as a field the
// configuration has pinned — and a field pinned by nobody never follows the saved agent
// again. A drift here is silent, permanent, and invisible in the form.
describe("round-tripping a stored configuration", () => {
  /** Save a draft the way the page does, load it back, and save it again. */
  function roundTrip(draft: GgConfigDraft, library: GgSavedAgent[]) {
    const stored: GgConfig = {
      id: "cfg-1",
      name: "review arm",
      description: "",
      capabilitySet: capabilitySetFromDraft(draft, "review arm"),
      agentSources: agentSourcesFromDraft(draft),
      updatedAt: "2026-08-18T00:00:00Z",
    };
    const reloaded = attachAgentSources(
      draftFromCapabilitySet(resolveCapabilitySet(stored, library)),
      stored.agentSources,
      library,
    );
    return {
      stored,
      reloaded,
      resaved: {
        capabilitySet: capabilitySetFromDraft(reloaded, "review arm"),
        agentSources: agentSourcesFromDraft(reloaded),
      },
    };
  }

  it("re-saves an untouched import byte for byte", () => {
    const saved = savedReviewer();
    const { draft } = importSavedAgent(emptyDraft(), saved);
    const trip = roundTrip(draft, [saved]);

    expect(trip.resaved.capabilitySet).toEqual(trip.stored.capabilitySet);
    expect(trip.resaved.agentSources).toEqual([
      { profileId: "reviewer", agentId: "saved-1", overrides: [] },
    ]);
  });

  it("re-saves an overridden import with the same overrides", () => {
    const saved = savedReviewer();
    const imported = importSavedAgent(emptyDraft(), saved);
    const draft = patchAgent(imported.draft, imported.agentId, {
      customInstructions: "Be brief.",
      promptCacheTtl: "extended",
    });
    const trip = roundTrip(draft, [saved]);

    expect(trip.resaved.capabilitySet).toEqual(trip.stored.capabilitySet);
    expect(trip.resaved.agentSources).toEqual([
      {
        profileId: "reviewer",
        agentId: "saved-1",
        overrides: ["customInstructions", "promptCacheTtl"],
      },
    ]);
  });

  it("keeps two imports of one saved agent pointed at it separately", () => {
    const saved = savedReviewer();
    const once = importSavedAgent(emptyDraft(), saved);
    const twice = importSavedAgent(once.draft, saved);
    // Both copies are shown under the one name, which is the case a source keyed by the
    // displayed text could not survive: one of the two would follow the other's overrides,
    // and neither the form nor the stored document would say which.
    const draft = patchAgent(twice.draft, twice.agentId, {
      name: "reviewer",
      customInstructions: "Be brief.",
    });
    const trip = roundTrip(draft, [saved]);

    expect(trip.resaved.capabilitySet).toEqual(trip.stored.capabilitySet);
    // The second copy took an id of its own, and only it pins anything.
    expect(trip.resaved.agentSources).toEqual([
      { profileId: "reviewer", agentId: "saved-1", overrides: [] },
      {
        profileId: "reviewer-2",
        agentId: "saved-1",
        overrides: ["customInstructions"],
      },
    ]);
  });

  it("keeps a renamed import following its saved agent", () => {
    const saved = savedReviewer();
    const imported = importSavedAgent(emptyDraft(), saved);
    const draft = patchAgent(imported.draft, imported.agentId, {
      name: "critic",
    });
    const trip = roundTrip(draft, [saved]);

    // Renamed, and still following: the source names the profile's id, which the rename
    // left where it was.
    expect(trip.resaved.agentSources).toEqual([
      { profileId: "reviewer", agentId: "saved-1", overrides: [] },
    ]);
  });
});
