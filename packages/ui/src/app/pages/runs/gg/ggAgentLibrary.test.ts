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
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  renameAgentSlug,
  seedAgentParams,
  seededRunLimits,
  wireAgentFromDraft,
  type GgConfigDraft,
} from "./ggConfigDraft";

/**
 * A one-agent draft, the shape the standalone agent editor holds. The agent is born
 * declaring — and deferring to — its own passthrough `primary` slot, which is the
 * declaration a saved agent carries into every configuration that imports it; the
 * configuration itself declares no launch input of its own.
 */
function agentDraft(name: string): GgConfigDraft {
  const blank = blankAgentDraft(name, DEFAULT_CAP_IDS);
  // Its `agent` params name itself, which is what the standalone editor seeds and what
  // an importing configuration carries onto the slug it imports the profile under.
  const agent = seedAgentParams(blank, blank.id);
  return {
    agents: [agent],
    rootAgentId: agent.id,
    modelSlots: [],
    limits: seededRunLimits(),
    hooks: [],
  };
}

/** That draft as the library stores it. */
function saveAgent(id: string, draft: GgConfigDraft): GgSavedAgent {
  const agent = savedAgentFromDraft(draft)!;
  return {
    id,
    name: agent.name,
    description: "",
    agent,
    updatedAt: "2026-08-18T00:00:00Z",
  };
}

/** A saved agent called `reviewer`, deferring to a `primary` slot of its own. */
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

/**
 * Rename the one agent's only model slot and give it a default — keeping the slot's
 * editor-only id, so the binding that names it comes along.
 */
function renameSlot(
  draft: GgConfigDraft,
  name: string,
  defaultModelId: string,
): GgConfigDraft {
  const agent = draft.agents[0]!;
  return patchAgent(draft, agent.id, {
    modelSlots: agent.modelSlots.map((slot) => ({
      ...slot,
      name,
      defaultModelId,
    })),
  });
}

describe("importing a saved agent", () => {
  it("adds a profile that pins nothing", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);

    expect(draft.agents).toHaveLength(2);
    const imported = draft.agents.find((a) => a.id === agentId)!;
    // The profile is *this configuration's*, whichever library entry it follows, so it is
    // minted an internal id of its own rather than borrowing the library's. What comes
    // across is the **slug**, because that is the name the model reads and the name the
    // operator's other configurations already agree on.
    expect(agentId).not.toBe(saved.agent.id);
    expect(imported.slug).toBe("reviewer");
    expect(imported.name).toBe("reviewer");
    expect(imported.source?.agentId).toBe("saved-1");
    // The one assertion the whole overlay rests on: an untouched import differs from the
    // saved agent in nothing at all.
    expect(draftAgentOverrides(draft, agentId)).toEqual([]);
  });

  // The library holds whatever was written to it, and the editor fills a document in on
  // the way through — every param the catalog gives a default, whether or not gg refuses a
  // launch without it. A profile is always the editor's copy, so a basis that is not is a
  // basis that differs from every untouched import of it.
  it("pins nothing when the stored entry omits a param the editor fills in", () => {
    const saved = savedReviewer();
    // A document written before compaction's optional retry count was a control: gg reads
    // its absence as none, which is the same figure the editor now writes down.
    const stored: GgAgentConfig = {
      ...saved.agent,
      capabilities: (saved.agent.capabilities ?? []).map((cap) => {
        if (cap.id !== "compaction" || !cap.params) return cap;
        const params = { ...cap.params };
        delete params.maxRetries;
        return { ...cap, params };
      }),
    };
    expect(
      (stored.capabilities ?? []).find((c) => c.id === "compaction")?.params,
    ).not.toHaveProperty("maxRetries");

    const { draft, agentId } = importSavedAgent(emptyDraft(), {
      ...saved,
      agent: stored,
    });
    expect(draftAgentOverrides(draft, agentId)).toEqual([]);

    // And Revert still has the same nothing to do, rather than reporting a drift it
    // cannot clear.
    const reverted = revertImportedAgent(draft, agentId);
    expect(draftAgentOverrides(reverted, agentId)).toEqual([]);
  });

  it("does not become the root of a configuration that already has one", () => {
    const before = emptyDraft();
    const { draft, agentId } = importSavedAgent(before, savedReviewer());
    expect(draft.rootAgentId).toBe(before.rootAgentId);
    expect(draft.rootAgentId).not.toBe(agentId);
  });

  it("arrives under the saved agent's own slug, carrying its self-references onto it", () => {
    // The saved agent lists *itself* in its own roster, because the library holds one
    // profile and its slug is the only slug that profile can name.
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
    // The slug is the saved agent's own — nothing is uniquified — and the self-reference
    // was carried onto this profile's freshly minted id rather than left pointing at a
    // profile the configuration never declared.
    expect(imported.slug).toBe("reviewer");
    expect(imported.id).not.toBe(base.agents[0]!.id);
    expect(imported.subagents.map((s) => s.agentId)).toEqual([agentId]);
    // The display name is de-duplicated as a courtesy to whoever reads the list, and
    // nothing turns on it.
    expect(imported.name).toBe("reviewer-2");
    expect(draftAgentOverrides(draft, agentId)).toEqual([]);
  });

  // A slug is unique within a configuration, and an import will not rename itself to dodge
  // that: a silently renamed import is a profile the operator's other configurations, and
  // the model's own roster, no longer agree on. So the collision is left standing, and the
  // save gate is what reports it.
  it("collides with a profile already carrying its slug rather than renaming itself", () => {
    const saved = savedReviewer();
    const once = importSavedAgent(emptyDraft(), saved);
    const twice = importSavedAgent(once.draft, saved);

    expect(twice.draft.agents.map((a) => a.slug)).toEqual([
      "root",
      "reviewer",
      "reviewer",
    ]);
    expect(draftSaveError(twice.draft)).toMatch(/carry the same slug/);
    // Two profiles, not one seen twice: each has an internal id of its own, which is what
    // keeps them separately addressable for as long as the clash lasts.
    const ids = twice.draft.agents.map((a) => a.id);
    expect(new Set(ids).size).toBe(3);
    expect(twice.agentId).toBe(ids[2]);
    // Only the display names are told apart, which is cosmetic and always was.
    expect(twice.draft.agents.map((a) => a.name)).toEqual([
      "Root",
      "reviewer",
      "reviewer-2",
    ]);

    // Renaming either side is the way out, and it is one edit to one profile: the copy the
    // operator renamed stops clashing, the other keeps the name it always had.
    const apart = renameAgentSlug(twice.draft, twice.agentId, "second-opinion");
    expect(apart.agents.map((a) => a.slug)).toEqual([
      "root",
      "reviewer",
      "second-opinion",
    ]);
    expect(draftSaveError(apart)).toBeNull();
    // …and both copies still follow the saved agent, each under its own id.
    expect(agentSourcesFromDraft(apart).map((s) => s.profileId)).toEqual([
      ids[1],
      ids[2],
    ]);
  });

  // The other half of the same rule: the profile already carrying the slug need not be an
  // import at all. A configuration's own inline profile can be standing on the name, and the
  // import still refuses to rename itself around it — so the operator is told, and picks
  // which of the two moves.
  it("collides with a configuration's own inline profile just the same", () => {
    const base = emptyDraft();
    // The configuration's root already answers to `reviewer`, before the library is opened.
    const standing = renameAgentSlug(base, base.agents[0]!.id, "reviewer");

    const { draft, agentId } = importSavedAgent(standing, savedReviewer());
    expect(draftSaveError(draft)).toMatch(/carry the same slug/);

    // Renaming the *inline* profile clears it just as well as renaming the import, because
    // the clash is between two names and neither one is privileged.
    const cleared = renameAgentSlug(draft, standing.agents[0]!.id, "conductor");
    expect(draftSaveError(cleared)).toBeNull();
    // And the import went on following the library through the whole episode: the clash was
    // never anything the overlay had an opinion about.
    expect(draftAgentOverrides(cleared, agentId)).toEqual([]);
  });

  it("brings the model slots the saved agent's bindings defer to", () => {
    const saved = savedReviewer((draft) =>
      renameSlot(draft, "critic", "anthropic/claude-haiku-4.5"),
    );

    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const imported = draft.agents.find((a) => a.id === agentId)!;
    // The slot belongs to the agent, so the import carries the declaration its binding
    // names — default and all — rather than arriving bound to nothing.
    expect(
      imported.modelSlots.map((s) => [s.name, s.defaultModelId, s.passthrough]),
    ).toEqual([["critic", "anthropic/claude-haiku-4.5", true]]);
    expect(imported.modelSlotId).toBe(imported.modelSlots[0]!.id);
    // And the configuration declares nothing of its own: a passthrough slot reaches the
    // launch form as `reviewer.critic` without the configuration saying a word.
    expect(draft.modelSlots).toEqual([]);
    expect(draftAgentOverrides(draft, agentId)).toEqual([]);
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

  // The slug is a field of the overlay like any other — it has to be, because a
  // configuration that renamed an imported profile to clear a collision must keep that
  // name while following the saved agent in everything else.
  it("names the slug when the configuration renamed the imported profile", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const renamed = renameAgentSlug(draft, agentId, "second-opinion");
    expect(draftAgentOverrides(renamed, agentId)).toEqual(["slug"]);

    // Pinned, and still following: the saved agent moves in a field the configuration
    // does not pin, and the merged profile takes the change while keeping the name the
    // operator gave it — with every reference the saved agent makes to itself carried onto
    // this profile's own id.
    const moved = savedReviewer((d) =>
      patchAgent(d, d.agents[0]!.id, {
        customInstructions: "Be brief.",
        subagents: [
          {
            agentId: d.agents[0]!.id,
            description: "itself",
            scopes: ["subagent"],
          },
        ],
      }),
    );
    const merged = mergeAgentConfig(
      moved.agent,
      wireAgentFromDraft(renamed, agentId)!,
      ["slug"],
    );
    expect(merged.id).toBe(agentId);
    expect(merged.slug).toBe("second-opinion");
    expect(merged.customInstructions).toBe("Be brief.");
    expect(merged.subagents?.map((s) => s.agentId)).toEqual([agentId]);
  });

  // The internal id is never an override, because it is not the saved agent's to lend: the
  // library's profile and the configuration's are two profiles, and the one in the
  // configuration was minted an id the moment it was imported. If the id were compared like
  // any other field, every import would arrive pinning it and would follow nothing.
  it("never names the internal id, which is the configuration's own", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const wire = wireAgentFromDraft(draft, agentId)!;

    expect(wire.id).toBe(agentId);
    expect(wire.id).not.toBe(saved.agent.id);
    expect(agentOverrides(saved.agent, wire)).toEqual([]);
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
      id: "a-library",
      slug: "reviewer",
      name: "reviewer",
      capabilities: [],
      modelId: "",
      customInstructions: "from the library",
      systemPromptTemplate: "pinned here",
    };
    const stored: GgAgentConfig = {
      id: "a-profile",
      slug: "reviewer",
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

  it("takes the slug the configuration pinned, and the saved agent's otherwise", () => {
    const base: GgAgentConfig = {
      id: "a-library",
      slug: "reviewer",
      name: "reviewer",
      capabilities: [],
      modelId: "",
      subagents: [
        { agentId: "a-library", description: "itself", scopes: ["subagent"] },
      ],
    };
    const stored: GgAgentConfig = {
      id: "a-profile",
      slug: "second-opinion",
      name: "Second opinion",
      capabilities: [],
      modelId: "",
    };
    // Pinned, the configuration's slug wins — that is what an override *is*.
    const pinned = mergeAgentConfig(base, stored, ["slug"]);
    expect(pinned.slug).toBe("second-opinion");

    // Unpinned, the slug follows the saved agent like every other unpinned field. That is
    // what makes a slug collision something a launch can discover after the configuration
    // was stored, rather than something an import quietly renamed its way out of.
    const following = mergeAgentConfig(base, stored, []);
    expect(following.slug).toBe("reviewer");

    // The internal id is the configuration's own under either reading, and the saved
    // agent's self-reference is carried onto it — so the merged profile's roster names the
    // profile the configuration declares rather than the library entry it follows.
    expect([pinned.id, following.id]).toEqual(["a-profile", "a-profile"]);
    expect(pinned.subagents?.[0]?.agentId).toBe("a-profile");
    expect(following.subagents?.[0]?.agentId).toBe("a-profile");

    // The display name is the configuration's own text either way, and no field of the
    // overlay at all.
    expect([pinned.name, following.name]).toEqual([
      "Second opinion",
      "Second opinion",
    ]);
  });

  it("finds no override between an agent and itself", () => {
    const saved = savedReviewer();
    expect(agentOverrides(saved.agent, saved.agent)).toEqual([]);
  });
});

describe("resolving a stored configuration", () => {
  /**
   * A stored configuration holding one imported profile, and the internal id that profile
   * was minted — which is what the link to the library is keyed by, and the only handle the
   * configuration has on it once the slug is something either side may change.
   */
  function storedConfig(
    saved: GgSavedAgent,
    overrides: string[],
  ): { config: GgConfig; profileId: string } {
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    return {
      profileId: agentId,
      config: {
        id: "cfg-1",
        name: "review arm",
        description: "",
        capabilitySet: capabilitySetFromDraft(draft, "review arm"),
        agentSources: [{ profileId: agentId, agentId: saved.id, overrides }],
        updatedAt: "2026-08-18T00:00:00Z",
      },
    };
  }

  it("carries a change to the saved agent into a field the configuration does not pin", () => {
    const { config, profileId } = storedConfig(savedReviewer(), []);
    const moved = savedReviewer((draft) =>
      patchAgent(draft, draft.agents[0]!.id, {
        customInstructions: "Be brief.",
      }),
    );

    const resolved = resolveCapabilitySet(config, [moved]);
    const reviewer = resolved.agents?.find((a) => a.id === profileId);
    expect(reviewer?.customInstructions).toBe("Be brief.");
  });

  it("leaves a pinned field alone when the saved agent moves", () => {
    const { config, profileId } = storedConfig(savedReviewer(), [
      "customInstructions",
    ]);
    const moved = savedReviewer((draft) =>
      patchAgent(draft, draft.agents[0]!.id, {
        customInstructions: "Be brief.",
      }),
    );

    const resolved = resolveCapabilitySet(config, [moved]);
    const reviewer = resolved.agents?.find((a) => a.id === profileId);
    expect(reviewer?.customInstructions).toBeUndefined();
  });

  it("falls back to the configuration's own copy when the saved agent is gone", () => {
    const { config } = storedConfig(savedReviewer(), []);
    const resolved = resolveCapabilitySet(config, []);
    expect(resolved.agents).toEqual(config.capabilitySet.agents);
  });

  // The link is on the internal id, which nothing renames — so a saved agent the operator
  // renamed in the library after this configuration imported it is still the agent this
  // profile follows. Keying the link on either side's *name* would have quietly detached the
  // profile at the moment the library entry was renamed, and the form would show a plain
  // inline agent with no way back.
  it("keeps following a saved agent that was renamed after the import", () => {
    const saved = savedReviewer();
    const { config, profileId } = storedConfig(saved, []);
    const renamed: GgSavedAgent = {
      ...saved,
      name: "second opinion",
      agent: { ...saved.agent, slug: "second-opinion" },
    };

    const resolved = resolveCapabilitySet(config, [renamed]);
    const reviewer = resolved.agents?.find((a) => a.id === profileId);
    // Still followed, and the slug is a field like any other: unpinned, it follows the
    // library.
    expect(reviewer?.slug).toBe("second-opinion");

    // Pinned, it does not — which is how a configuration that renamed the profile to clear
    // a collision keeps that name however the library entry is spelled afterwards.
    const pinnedConfig = storedConfig(saved, ["slug"]);
    const stored = pinnedConfig.config.capabilitySet.agents?.find(
      (a) => a.id === pinnedConfig.profileId,
    );
    expect(stored?.slug).toBe("reviewer");
    const held = resolveCapabilitySet(pinnedConfig.config, [
      renamed,
    ]).agents?.find((a) => a.id === pinnedConfig.profileId);
    expect(held?.slug).toBe("reviewer");
  });

  it("carries a slot the saved agent picked up after the configuration was stored", () => {
    const { config, profileId } = storedConfig(savedReviewer(), []);
    const moved = savedReviewer((draft) =>
      renameSlot(draft, "critic", "anthropic/claude-haiku-4.5"),
    );

    const resolved = resolveCapabilitySet(config, [moved]);
    const reviewer = resolved.agents?.find((a) => a.id === profileId);
    // The slot rides on the agent, so a configuration that pins nothing takes the new
    // declaration — and the binding that names it — without being re-saved.
    expect(reviewer?.modelSlots).toEqual([
      {
        name: "critic",
        defaultModelId: "anthropic/claude-haiku-4.5",
        passthrough: true,
      },
    ]);
    expect(reviewer?.modelSlot).toBe("critic");
  });
});

describe("detaching and reverting", () => {
  it("records no source for a profile whose saved agent has gone", () => {
    const saved = savedReviewer();
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const orphaned = attachAgentSources(
      { ...draft, agents: draft.agents.map((a) => ({ ...a, source: null })) },
      [{ profileId: agentId, agentId: saved.id, overrides: [] }],
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
    const { draft, agentId } = importSavedAgent(emptyDraft(), saved);
    const trip = roundTrip(draft, [saved]);

    expect(trip.resaved.capabilitySet).toEqual(trip.stored.capabilitySet);
    // The source is keyed by the profile's internal id, which the load path reads off the
    // stored set rather than minting again — so the reloaded configuration points at the
    // same profile the stored one did.
    expect(trip.resaved.agentSources).toEqual([
      { profileId: agentId, agentId: "saved-1", overrides: [] },
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
        profileId: imported.agentId,
        agentId: "saved-1",
        overrides: ["customInstructions", "promptCacheTtl"],
      },
    ]);
  });

  it("keeps two imports of one saved agent pointed at it separately", () => {
    // Two copies of one saved agent, told apart by the slug the operator gave the first to
    // clear the collision the second import stood in. This is the case a source keyed by
    // either *name* could not survive: for as long as the clash lasts both are shown under
    // one slug, so one of the two would follow the other's overrides and neither the form
    // nor the stored document would say which.
    const saved = savedReviewer();
    const once = importSavedAgent(emptyDraft(), saved);
    const apart = renameAgentSlug(once.draft, once.agentId, "second-opinion");
    const twice = importSavedAgent(apart, saved);
    const draft = patchAgent(twice.draft, twice.agentId, {
      name: "reviewer",
      customInstructions: "Be brief.",
    });
    const trip = roundTrip(draft, [saved]);

    expect(once.agentId).not.toBe(twice.agentId);
    expect(trip.resaved.capabilitySet).toEqual(trip.stored.capabilitySet);
    // The renamed copy pins its slug and nothing else; the second pins the one field it
    // was edited in. Both still follow `saved-1`, each under the id it was minted.
    expect(trip.resaved.agentSources).toEqual([
      { profileId: once.agentId, agentId: "saved-1", overrides: ["slug"] },
      {
        profileId: twice.agentId,
        agentId: "saved-1",
        overrides: ["customInstructions"],
      },
    ]);
  });

  // Two imports the operator has *not* told apart yet is a document that has to survive
  // being stored and reopened just as well: the clash is a save gate the console reports,
  // not something the overlay is entitled to resolve by dropping one of the two links.
  it("records a source per profile even while two of them carry one slug", () => {
    const saved = savedReviewer();
    const once = importSavedAgent(emptyDraft(), saved);
    const twice = importSavedAgent(once.draft, saved);

    const sources = agentSourcesFromDraft(twice.draft);
    expect(sources.map((s) => s.profileId)).toEqual([
      once.agentId,
      twice.agentId,
    ]);
    expect(sources.every((s) => s.agentId === "saved-1")).toBe(true);
    // Neither has pinned anything: they arrived under the saved agent's own slug, which is
    // the whole reason they clash.
    expect(sources.map((s) => s.overrides)).toEqual([[], []]);
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
      { profileId: imported.agentId, agentId: "saved-1", overrides: [] },
    ]);
  });
});
