import type {
  GgAgentConfig,
  GgAgentSource,
  GgCapabilityConfig,
  GgCapabilitySet,
  GgConfig,
  GgSavedAgent,
  GgSubagentRef,
} from "@test-cabinet/run-record/gg";
import {
  AGENT_MODES,
  CAPABILITIES,
  FSM_CAP_ID,
  RESPONSES_AS_CODE_CAP_ID,
} from "./ggCatalog";
import {
  agentDraftFromConfig,
  canonicalAgentCapabilities,
  mintAgentKey,
  draftFromCapabilitySet,
  resolveAgentReferences,
  seedAgentParams,
  wireAgentFromDraft,
  type GgAgentDraft,
  type GgConfigDraft,
} from "./ggConfigDraft";

// The **agent library**: agent profiles authored on their own, and the overlay that lets
// one configuration follow such a profile while pinning a few of its fields.
//
// A configuration is stored — and launched — with every agent written out in full,
// because gg is handed a capability set whose agents are already whole and resolves no
// reference of its own. Everything in this module runs on the console side of that line:
// it merges a saved agent with the configuration's overrides on the way in, and
// re-derives the overrides on the way back out.
//
// The overrides are **derived by comparison**, never accumulated as the operator types.
// A field that differs from the saved agent is overridden; one that matches is not. That
// is what makes "1 local change" mean the same thing after a reload as it does mid-edit,
// and it is why reverting is simply dropping the local value.

/**
 * One overridable field of an agent profile, as the editor names it.
 *
 * `model` covers the whole binding — the pinned id and the slot it defers to are one
 * decision, and taking half of each from two places would produce an agent bound to
 * neither. Capabilities are not here: each capability is a field of its own
 * (`capabilities.<id>`), so pinning one configuration's compaction settings leaves its
 * prompt, roster and every other capability following the saved agent.
 */
export interface AgentOverrideField {
  path: string;
  label: string;
}

/** The whole-agent fields, in the order the editor lists them. */
export const AGENT_OVERRIDE_FIELDS: ReadonlyArray<AgentOverrideField> = [
  { path: "slug", label: "Slug" },
  { path: "model", label: "Model binding" },
  { path: "modelSlots", label: "Model slots" },
  { path: "tools", label: "Tool allowlist" },
  { path: "operations", label: "API allowlist" },
  { path: "customInstructions", label: "Custom instructions" },
  { path: "systemPromptTemplate", label: "System prompt" },
  { path: "promptCacheTtl", label: "Prompt cache lifetime" },
  { path: "loopDetection", label: "Loop detection" },
  { path: "subagents", label: "Roster" },
  { path: "hooks", label: "Hooks" },
];

/**
 * How a stored agent's [type](GgAgentMode) reads on screen, taken from the two
 * mode-marker capabilities the profile records it as.
 */
export function agentModeLabel(agent: GgAgentConfig): string {
  const on = (id: string) =>
    (agent.capabilities ?? []).some((cap) => cap.id === id && cap.enabled);
  const mode = on(FSM_CAP_ID)
    ? "fsm"
    : on(RESPONSES_AS_CODE_CAP_ID)
      ? "rac"
      : "tools";
  return AGENT_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** The `capabilities.<id>` path for one capability. */
export function capabilityOverridePath(capId: string): string {
  return `capabilities.${capId}`;
}

/**
 * How one override path reads on screen. A capability takes the catalog's own name for
 * it, so the two vocabularies an operator sees — the editor's and this list — agree.
 */
export function overrideLabel(path: string): string {
  const field = AGENT_OVERRIDE_FIELDS.find((f) => f.path === path);
  if (field) return field.label;
  const capId = path.startsWith("capabilities.")
    ? path.slice("capabilities.".length)
    : null;
  const cap = capId ? CAPABILITIES.find((c) => c.id === capId) : undefined;
  return cap?.name ?? capId ?? path;
}

// A value's canonical text, with object keys sorted so two shapes that say the same
// thing compare equal whatever order they were built in. An absent key and an explicit
// `undefined` are the same statement, and both read as `null` here.
function stable(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return v.map(canonical);
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = canonical((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(canonical(value));
}

/**
 * One field's value in the form the comparison reads it, with the fields that are
 * **sets** put in a fixed order first.
 *
 * The two allowlists and the roster are sets: an agent granted `shell` and `read_file`
 * is the same agent however the two are listed, and the editor appends rather than
 * re-deriving in catalog order — switching a capability off and on again moves its calls
 * to the end of the list. Compared as sequences, that no-op would pin the whole
 * allowlist to the configuration, and the profile would stop following the saved agent
 * in the one field an operator is least likely to look at. Hooks stay a sequence: they
 * run in the order they are listed.
 */
function comparable(path: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (path === "tools" || path === "operations") return [...value].sort();
  if (path === "subagents") {
    return (value as GgSubagentRef[])
      .map((entry) => ({ ...entry, scopes: [...(entry.scopes ?? [])].sort() }))
      .sort((a, b) => a.agentId.localeCompare(b.agentId));
  }
  return value;
}

/** The capability ids either side of a comparison configures. */
function capabilityIds(...agents: GgAgentConfig[]): string[] {
  const ids = new Set<string>();
  for (const agent of agents) {
    for (const cap of agent.capabilities ?? []) ids.add(cap.id);
  }
  return [...ids];
}

function capabilityConfig(
  agent: GgAgentConfig,
  capId: string,
): GgCapabilityConfig | undefined {
  return (agent.capabilities ?? []).find((cap) => cap.id === capId);
}

/**
 * Re-point every reference an agent makes to the profile `from` so it names `to`.
 *
 * A saved agent names *itself* in its own roster and in any `agent` param it carries,
 * because the library holds one profile and its id is the only id that profile can name.
 * The profile a configuration imports it as is a different profile with an id of its own,
 * so the import has to carry those self-references onto that id — otherwise it arrives
 * with an empty roster and its params pointing at a profile the configuration never
 * declared.
 */
export function repointAgentReferences(
  agent: GgAgentConfig,
  from: string,
  to: string,
): GgAgentConfig {
  if (from === to) return agent;
  const capabilities = (agent.capabilities ?? []).map((cap) => {
    const spec = CAPABILITIES.find((c) => c.id === cap.id);
    const agentKeys = (spec?.params ?? [])
      .filter((p) => p.kind === "agent")
      .map((p) => p.key);
    if (!agentKeys.length || !cap.params) return cap;
    const params = { ...cap.params };
    for (const key of agentKeys) {
      if (params[key] === from) params[key] = to;
    }
    return { ...cap, params };
  });
  return {
    ...agent,
    capabilities,
    ...(agent.subagents
      ? {
          subagents: agent.subagents.map((s) =>
            s.agentId === from ? { ...s, agentId: to } : s,
          ),
        }
      : {}),
  };
}

/**
 * The saved agent as it applies to the profile carrying `profileId`: put through the
 * editor's own load and save, its id replaced, and every self-reference carried across
 * with it.
 *
 * Both halves of the overlay run against this rather than against the stored agent
 * itself, so the id a profile was imported under is never mistaken for an override — and
 * neither is anything the editor
 * [fills in](canonicalAgentCapabilities) on the way in. A profile is always the editor's
 * copy, so a basis that is not leaves an untouched import pinning whatever the editor
 * filled in, which detaches it from the agent it follows and leaves Revert with nothing
 * to do.
 */
export function agentBasisAs(
  base: GgAgentConfig,
  profileId: string,
): GgAgentConfig {
  const from = base.id ?? base.slug;
  const canonical = canonicalAgentCapabilities({ ...base, id: from });
  return repointAgentReferences(
    { ...canonical, id: profileId },
    from,
    profileId,
  );
}

/**
 * The fields in which `agent` departs from the saved agent it follows — the overrides
 * this configuration pins.
 *
 * The comparison is by value, so editing a field back to what the saved agent says drops
 * the override rather than freezing the old value under a new name.
 *
 * The slug is compared, because a configuration that renamed an imported profile to clear
 * a collision has to keep that name while following the saved agent in everything else.
 * The display name is the configuration's own text and is not a field of the overlay at
 * all.
 */
export function agentOverrides(
  base: GgAgentConfig,
  agent: GgAgentConfig,
): string[] {
  const basis = agentBasisAs(base, agent.id ?? agent.slug);
  const out: string[] = [];
  if (base.slug !== agent.slug) out.push("slug");
  if (
    stable({ modelId: basis.modelId, modelSlot: basis.modelSlot }) !==
    stable({ modelId: agent.modelId, modelSlot: agent.modelSlot })
  ) {
    out.push("model");
  }
  for (const field of AGENT_OVERRIDE_FIELDS) {
    if (field.path === "model" || field.path === "slug") continue;
    const key = field.path as keyof GgAgentConfig;
    if (
      stable(comparable(field.path, basis[key])) !==
      stable(comparable(field.path, agent[key]))
    ) {
      out.push(field.path);
    }
  }
  for (const capId of capabilityIds(basis, agent)) {
    if (
      stable(capabilityConfig(basis, capId)) !==
      stable(capabilityConfig(agent, capId))
    ) {
      out.push(capabilityOverridePath(capId));
    }
  }
  return out;
}

/**
 * The saved agent with this configuration's overrides laid on top of it: the profile a
 * run actually carries.
 *
 * `stored` is the configuration's own resolved copy, which is where an overridden field
 * is read from. The display name always wins from it, because it is the configuration's
 * own text rather than anything the saved agent lends it.
 *
 * The slug is a field like any other: it follows the saved agent unless this configuration
 * pinned it, which is what makes a slug collision something a launch can discover after the
 * configuration was stored. Whichever slug wins, the profile's references to itself are
 * carried onto it.
 */
export function mergeAgentConfig(
  base: GgAgentConfig,
  stored: GgAgentConfig,
  overrides: ReadonlyArray<string>,
): GgAgentConfig {
  const pinned = new Set(overrides);
  const merged: GgAgentConfig = {
    // The profile's internal id is the configuration's own and is never the saved agent's:
    // this is *this* configuration's profile, whichever library entry it follows.
    ...agentBasisAs(base, stored.id ?? stored.slug),
    slug: pinned.has("slug") ? stored.slug : base.slug,
    name: stored.name,
  };
  if (pinned.has("model")) {
    merged.modelId = stored.modelId;
    if (stored.modelSlot === undefined) delete merged.modelSlot;
    else merged.modelSlot = stored.modelSlot;
  }
  for (const field of AGENT_OVERRIDE_FIELDS) {
    if (field.path === "model" || field.path === "slug") continue;
    if (!pinned.has(field.path)) continue;
    const key = field.path as keyof GgAgentConfig;
    const value = stored[key];
    if (value === undefined) delete merged[key];
    // The paths are a closed list of the contract's own optional fields, so the write
    // is type-safe field by field even though the key is only known at run time.
    else (merged as Record<string, unknown>)[key] = value;
  }
  const capIds = capabilityIds(merged, stored).filter((id) =>
    pinned.has(capabilityOverridePath(id)),
  );
  if (capIds.length) {
    const overridden = new Set(capIds);
    const kept = (merged.capabilities ?? []).filter(
      (cap) => !overridden.has(cap.id),
    );
    const taken = (stored.capabilities ?? []).filter((cap) =>
      overridden.has(cap.id),
    );
    // Written back in the stored order, which is the catalog's, so the merged agent
    // lists its capabilities the way every other agent does.
    const byId = new Map([...kept, ...taken].map((cap) => [cap.id, cap]));
    merged.capabilities = CAPABILITIES.flatMap((cap) => {
      const found = byId.get(cap.id);
      return found ? [found] : [];
    });
  }
  return merged;
}

/**
 * A configuration's capability set with every imported agent resolved against the
 * library as it stands.
 *
 * This runs on every read, which is what makes an import a live reference: a
 * configuration launched after its saved agent changed carries the new version of every
 * field it does not override. A source whose saved agent is gone resolves to the
 * configuration's own stored copy, so the configuration keeps working.
 */
export function resolveCapabilitySet(
  config: GgConfig,
  library: ReadonlyArray<GgSavedAgent>,
): GgCapabilitySet {
  const sources = new Map(
    config.agentSources.map((s) => [s.profileId, s] as const),
  );
  const savedById = new Map(library.map((saved) => [saved.id, saved] as const));
  if (!sources.size) return config.capabilitySet;
  const agents = (config.capabilitySet.agents ?? []).map((stored) => {
    // The link is keyed by the profile's internal id, which is minted once and never
    // rewritten — so a saved agent renamed since this configuration was stored is still
    // followed, and a slug two profiles now share still resolves to exactly one of them.
    const source = stored.id ? sources.get(stored.id) : undefined;
    const saved = source ? savedById.get(source.agentId) : undefined;
    if (!source || !saved) return stored;
    return mergeAgentConfig(saved.agent, stored, source.overrides);
  });
  return { ...config.capabilitySet, agents };
}

/**
 * The draft with each imported profile pointed back at the saved agent it follows.
 *
 * Called after the set has been resolved and loaded, because the link lives on the
 * configuration rather than in the capability set. A source naming a saved agent the
 * account no longer holds is dropped: the profile is already whole, and it now belongs
 * to the configuration alone.
 */
export function attachAgentSources(
  draft: GgConfigDraft,
  sources: ReadonlyArray<GgAgentSource>,
  library: ReadonlyArray<GgSavedAgent>,
): GgConfigDraft {
  if (!sources.length) return draft;
  const byProfileId = new Map(sources.map((s) => [s.profileId, s] as const));
  const savedById = new Map(library.map((saved) => [saved.id, saved] as const));
  return {
    ...draft,
    agents: draft.agents.map((agent) => {
      const source = byProfileId.get(agent.id);
      const saved = source ? savedById.get(source.agentId) : undefined;
      if (!source || !saved) return agent;
      return {
        ...agent,
        source: {
          agentId: saved.id,
          name: saved.name,
          base: saved.agent,
        },
      };
    }),
  };
}

/**
 * Where each of the draft's imported profiles came from, as the configuration stores it.
 *
 * A profile whose saved agent has gone contributes nothing, which is how deleting a
 * saved agent detaches the profiles that followed it.
 */
export function agentSourcesFromDraft(draft: GgConfigDraft): GgAgentSource[] {
  return draft.agents.flatMap((agent) => {
    const base = agent.source?.base;
    if (!agent.source || !base) return [];
    const wire = wireAgentFromDraft(draft, agent.id);
    if (!wire?.id) return [];
    return [
      {
        profileId: wire.id,
        agentId: agent.source.agentId,
        overrides: agentOverrides(base, wire),
      },
    ];
  });
}

/** The overrides one imported profile currently pins, as the editor shows them. */
export function draftAgentOverrides(
  draft: GgConfigDraft,
  agentId: string,
): string[] {
  const agent = draft.agents.find((a) => a.id === agentId);
  const base = agent?.source?.base;
  if (!base) return [];
  const wire = wireAgentFromDraft(draft, agentId);
  return wire ? agentOverrides(base, wire) : [];
}

/**
 * A display name for an imported profile that no agent in `agents` is already showing,
 * starting from `wanted`.
 *
 * Cosmetic, and only that. Names are display text: two profiles may carry one name without
 * a single reference in the configuration becoming ambiguous, so an import no longer has to
 * uniquify anything to be *correct* — what has to be unique is the profile's
 * [slug](GgAgentDraft.slug), which is its own field. A list of three profiles all reading
 * "Reviewer" is simply a list an operator cannot work in, and this is what spares them it.
 */
function unusedName(
  agents: ReadonlyArray<GgAgentDraft>,
  wanted: string,
): string {
  const taken = new Set(agents.map((a) => a.name.trim()));
  if (!taken.has(wanted)) return wanted;
  let n = 2;
  while (taken.has(`${wanted}-${n}`)) n += 1;
  return `${wanted}-${n}`;
}

/**
 * Place a profile built from `base` into the draft as the profile `profileId`, displayed
 * as `name`, carrying the model slots it declares.
 *
 * Both halves of an import land here: adding a saved agent, and reverting one that has
 * drifted. Each is the same act — take the saved agent as it stands and make it a profile
 * of this configuration — so both go through one path.
 */
function placeAgent(
  draft: GgConfigDraft,
  base: GgAgentConfig,
  profileId: string,
  name: string,
): { draft: GgConfigDraft; agent: GgAgentDraft } {
  const rebased = { ...agentBasisAs(base, profileId), name };
  const built = agentDraftFromConfig(rebased);
  // The roster is resolved against the ids the configuration declares *with this profile
  // in it*, because a saved agent's roster names itself — and an entry naming a profile
  // the set does not declare is dropped.
  const declared = new Set([...draft.agents.map((a) => a.id), profileId]);
  const agent = seedAgentParams(
    resolveAgentReferences(built, rebased, declared),
    draft.rootAgentId || built.id,
  );
  return {
    draft: {
      ...draft,
      agents: [...draft.agents, agent],
      rootAgentId: draft.rootAgentId || agent.id,
    },
    agent,
  };
}

/**
 * The draft with a saved agent imported into it, and the slug of the profile it became.
 *
 * The import arrives whole, under the saved agent's own slug and with the model slots its
 * bindings defer to. A slug is unique within a configuration, so importing an agent whose
 * slug another profile already carries leaves the draft unsaveable until the operator
 * renames one of the two, which the save gate says in as many words. Nothing is uniquified
 * here: a silently renamed import is a profile the operator's other configurations, and the
 * model's own roster, no longer agree on. It becomes the root only when the configuration
 * had no agents at all.
 */
export function importSavedAgent(
  draft: GgConfigDraft,
  saved: GgSavedAgent,
): { draft: GgConfigDraft; agentId: string } {
  // A profile of this configuration, not the library's: it is minted an id of its own, so
  // importing one saved agent twice yields two profiles the configuration tells apart.
  const profileId = mintAgentKey();
  const name = unusedName(draft.agents, saved.agent.name.trim());
  const placed = placeAgent(draft, saved.agent, profileId, name);
  const source = {
    agentId: saved.id,
    name: saved.name,
    base: saved.agent,
  };
  return {
    draft: {
      ...placed.draft,
      // The row [placeAgent] appended, addressed by its **position**. Keying this by the
      // profile's slug would attach the link to every profile carrying it — and carrying
      // one is exactly the collision an import is allowed to land in, so a configuration's
      // own inline profile would come out following a saved agent nobody pointed it at,
      // and go on doing so after the import beside it was removed.
      agents: placed.draft.agents.map((a, i) =>
        i === placed.draft.agents.length - 1 ? { ...a, source } : a,
      ),
    },
    agentId: placed.agent.id,
  };
}

/**
 * The draft with one imported profile's overrides dropped: it is rebuilt from the saved
 * agent as it stands, keeping its id, its name and its position, so every reference to it
 * survives the rebuild.
 *
 * A profile that follows nothing, or whose saved agent is gone, is returned untouched.
 */
export function revertImportedAgent(
  draft: GgConfigDraft,
  agentId: string,
): GgConfigDraft {
  const index = draft.agents.findIndex((a) => a.id === agentId);
  const agent = draft.agents[index];
  const source = agent?.source;
  const base = source?.base;
  if (!agent || !source || !base) return draft;

  const name = agent.name.trim();
  const without = {
    ...draft,
    agents: draft.agents.filter((a) => a.id !== agentId),
  };
  const placed = placeAgent(without, base, agent.id, name);
  const rebuilt = { ...placed.agent, source };
  const others = placed.draft.agents.slice(0, -1);
  return {
    ...placed.draft,
    agents: [...others.slice(0, index), rebuilt, ...others.slice(index)],
    rootAgentId: draft.rootAgentId,
  };
}

/**
 * One of a configuration's profiles as the library would store it, model slots and all.
 *
 * This is what Save to library writes, and it is the same shape the standalone editor
 * produces — so a profile written to the library from a configuration comes back as an
 * import that pins nothing.
 */
export function savedAgentFromProfile(
  draft: GgConfigDraft,
  agentId: string,
): GgAgentConfig | null {
  return wireAgentFromDraft(draft, agentId);
}

/**
 * A saved agent opened as a one-agent configuration draft, which is what the standalone
 * editor mounts: the same per-agent form a configuration opens, over a draft holding that
 * agent and the slots it declares.
 */
export function draftFromSavedAgent(saved: GgSavedAgent): GgConfigDraft {
  return draftFromCapabilitySet({ agents: [saved.agent] });
}

/** A one-agent draft as the library stores it. */
export function savedAgentFromDraft(
  draft: GgConfigDraft,
): GgAgentConfig | null {
  const agent = draft.agents[0];
  return agent ? savedAgentFromProfile(draft, agent.id) : null;
}
