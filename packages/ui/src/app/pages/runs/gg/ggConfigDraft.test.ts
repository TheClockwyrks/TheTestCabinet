import { describe, expect, it } from "vitest";
import type {
  GgAgentConfig,
  GgCapabilityConfig,
  GgCapabilitySet,
  GgModuleKind,
} from "@test-cabinet/run-record/gg";
import {
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE,
} from "@test-cabinet/run-record/gg-system-prompt";
import {
  agentSaveError,
  agentStates,
  bindModelSlots,
  blankAgentDraft,
  capabilityActive,
  capabilityGrantWarning,
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  fsmStatesWarnings,
  grantsOf,
  launchModelSlots,
  loopDetectionWarning,
  renameStateDraft,
  resetAgentForMode,
  runLimitsWarning,
  setFeatureBundle,
  type GgAgentDraft,
  type GgConfigDraft,
} from "./ggConfigDraft";
import {
  BUILT_IN_SKILL_OPTIONS,
  CAPABILITIES,
  DEFAULT_ERROR_RATE_WINDOW,
  DEFAULT_MAX_CONSECUTIVE_ERRORS,
  DEFAULT_MAX_ERROR_RATE,
  DEFAULT_MAX_PARALLEL,
  DEFAULT_MEMORY_MAX_COUNT,
  DEFAULT_MEMORY_MAX_LEN_DESCRIPTION,
  DEFAULT_MEMORY_MAX_LEN_PER,
  DEFAULT_SHELL_MAX_CHARS,
  DEFAULT_SHELL_MAX_LINES,
  FSM_CAP,
  FSM_CAP_ID,
  RESPONSES_AS_CODE_CAP_ID,
  ROOT_AGENT,
  RUN_LIMIT_SPECS,
  capabilitySpec,
  paramApplies,
  type GgAgentMode,
} from "./ggCatalog";

// One agent profile with only the fields a given assertion cares about; the rest take
// the defaults the wire type uses. Pins a placeholder model by default so a fixture is
// launchable (an agent with neither a pinned model nor a model slot is a save error);
// tests that exercise deferral pass an explicit `modelSlot`, which wins.
function agent(partial: Partial<GgAgentConfig> = {}): GgAgentConfig {
  return { name: "Root", capabilities: [], modelId: "mock/x", ...partial };
}

// A capability set as the wire carries it (per-agent now), defaulting to a bare Root.
function set(partial: Partial<GgCapabilitySet>): GgCapabilitySet {
  return { agents: [agent()], ...partial };
}

// A set whose single Root agent carries the given capabilities.
function capSet(capabilities: GgCapabilityConfig[]): GgCapabilitySet {
  return { agents: [agent({ capabilities })] };
}

// The Root agent's capability rows in a draft / wire set.
function draftCaps(d: ReturnType<typeof draftFromCapabilitySet>) {
  return d.agents[0]!.capabilities;
}
function setCaps(s: GgCapabilitySet) {
  return s.agents[0]!.capabilities;
}

describe("gg model slots", () => {
  it("asks only for the slots an agent actually defers to", () => {
    const configured = set({
      modelSlots: [
        { name: "primary" },
        { name: "critic", defaultModelId: "anthropic/claude-haiku-4.5" },
        // Declared but consumed by nothing — asking for it would change nothing.
        { name: "orphan" },
      ],
      agents: [
        agent({ modelSlot: "primary" }),
        agent({ name: "reviewer", modelSlot: "critic" }),
        agent({ name: "judge", modelId: "openai/o-fixed" }),
      ],
    });
    expect(launchModelSlots(configured)).toEqual([
      { name: "primary" },
      { name: "critic", defaultModelId: "anthropic/claude-haiku-4.5" },
    ]);
  });

  it("resolves every deferred agent and drops the declarations", () => {
    const configured = set({
      preset: "critic-sweep",
      modelSlots: [{ name: "critic" }],
      agents: [
        agent({ modelSlot: "critic" }),
        agent({ name: "reviewer", modelSlot: "critic" }),
        agent({ name: "judge", modelId: "openai/o-fixed" }),
      ],
    });
    const launched = bindModelSlots(configured, {
      critic: "anthropic/claude-haiku-4.5",
    });
    // What runs is fully pinned; two agents share the `critic` slot, and the
    // internally pinned `judge` is untouched.
    expect(
      launched.agents.map((a) => ({ name: a.name, modelId: a.modelId })),
    ).toEqual([
      { name: "Root", modelId: "anthropic/claude-haiku-4.5" },
      { name: "reviewer", modelId: "anthropic/claude-haiku-4.5" },
      { name: "judge", modelId: "openai/o-fixed" },
    ]);
    expect(launched.agents.every((a) => a.modelSlot === undefined)).toBe(true);
    expect(launched.modelSlots).toBeUndefined();
    expect(launched.preset).toBe("critic-sweep");
  });

  it("still asks for a model when an agent names an undeclared slot", () => {
    const configured = set({ agents: [agent({ modelSlot: "primary" })] });
    expect(launchModelSlots(configured)).toEqual([{ name: "primary" }]);
    expect(
      bindModelSlots(configured, { primary: "openai/gpt-5.6-sol" }).agents[0]
        ?.modelId,
    ).toBe("openai/gpt-5.6-sol");
  });

  it("synthesizes a Root when a set carries no agents", () => {
    const draft = draftFromCapabilitySet({
      agents: [],
    } as unknown as GgCapabilitySet);
    expect(draft.agents).toHaveLength(1);
    expect(draft.agents[0]!.name).toBe("Root");
  });

  it("round-trips a declared slot through the editor draft", () => {
    const configured = set({
      modelSlots: [{ name: "critic", defaultModelId: "anthropic/haiku" }],
      agents: [
        agent({ modelSlot: "critic" }),
        agent({ name: "reviewer", modelId: "openai/o-fixed" }),
      ],
    });
    const back = capabilitySetFromDraft(
      draftFromCapabilitySet(configured),
      null,
    );
    expect(back.modelSlots).toEqual([
      { name: "critic", defaultModelId: "anthropic/haiku" },
    ]);
    expect(
      back.agents.map((a) => ({
        name: a.name,
        modelId: a.modelId,
        modelSlot: a.modelSlot,
      })),
    ).toEqual([
      { name: "Root", modelId: "", modelSlot: "critic" },
      { name: "reviewer", modelId: "openai/o-fixed", modelSlot: undefined },
    ]);
  });

  it("refuses to save an agent bound to a slot that was never declared", () => {
    const draft = emptyDraft();
    expect(draftSaveError(draft)).toBeNull();
    draft.agents[0]!.modelSlotId = "slot-that-was-deleted";
    expect(draftSaveError(draft)).toContain("model slot");
  });

  // The whole point of binding a slot by internal id: the name is a label the launch
  // form shows, so changing it must move every agent bound to it rather than orphan them.
  it("keeps an agent bound to a model slot that is renamed", () => {
    const draft = emptyDraft();
    draft.modelSlots[0]!.name = "critic";
    expect(draftSaveError(draft)).toBeNull();
    const back = capabilitySetFromDraft(draft, null);
    expect(back.modelSlots).toEqual([{ name: "critic" }]);
    expect(back.agents[0]!.modelSlot).toBe("critic");
  });
});

describe("gg agents", () => {
  it("round-trips a multi-agent configuration with a subagent allowlist", () => {
    const configured = set({
      modelSlots: [{ name: "primary" }],
      agents: [
        agent({
          modelSlot: "primary",
          subagents: [
            {
              agent: "reviewer",
              description: "for hard reviews",
              scopes: ["subagent"],
            },
          ],
        }),
        agent({ name: "reviewer", modelId: "openai/o-fixed" }),
      ],
    });
    const back = capabilitySetFromDraft(
      draftFromCapabilitySet(configured),
      null,
    );
    expect(back.agents.map((a) => a.name)).toEqual(["Root", "reviewer"]);
    expect(back.agents[0]!.subagents).toEqual([
      {
        agent: "reviewer",
        description: "for hard reviews",
        scopes: ["subagent"],
      },
    ]);
  });

  it("round-trips a custom prompt and a full template override", () => {
    const configured = set({
      agents: [
        agent({
          modelSlot: "primary",
          customInstructions: "Prefer TDD.",
          systemPromptTemplate:
            "You are a custom agent. {{customInstructions}}",
        }),
      ],
      modelSlots: [{ name: "primary" }],
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.agents[0]!.customInstructions).toBe("Prefer TDD.");
    const back = capabilitySetFromDraft(draft, null);
    expect(back.agents[0]!.customInstructions).toBe("Prefer TDD.");
    expect(back.agents[0]!.systemPromptTemplate).toBe(
      "You are a custom agent. {{customInstructions}}",
    );
  });

  it("stores no override when the template is left at the default", () => {
    const draft = emptyDraft();
    // The editor seeds the textarea with the default and blanks it back to "" on a
    // match, so a draft carrying the default verbatim writes no override.
    draft.agents[0]!.systemPromptTemplate = "";
    expect(
      capabilitySetFromDraft(draft, null).agents[0]!.systemPromptTemplate,
    ).toBeUndefined();
    // A non-empty override is preserved.
    draft.agents[0]!.systemPromptTemplate =
      DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE + "\nextra";
    expect(
      capabilitySetFromDraft(draft, null).agents[0]!.systemPromptTemplate,
    ).toContain("extra");
  });

  // gg renders one responses-as-code template for every program language — it names no
  // function, and what is specific to a language is a segment gated inside it — so a code
  // agent has exactly one default to be left at, whatever arm of a study it is.
  it("stores no override when a code agent's template is left at its one default", () => {
    const draft = emptyDraft();
    draft.agents = [blankAgentDraft(ROOT_AGENT, [RESPONSES_AS_CODE_CAP_ID])];
    expect(draft.agents[0]!.mode).toBe("rac");

    draft.agents[0]!.systemPromptTemplate = "";
    expect(
      capabilitySetFromDraft(draft, null).agents[0]!.systemPromptTemplate,
    ).toBeUndefined();

    draft.agents[0]!.systemPromptTemplate =
      DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE + "\nextra";
    expect(
      capabilitySetFromDraft(draft, null).agents[0]!.systemPromptTemplate,
    ).toContain("extra");
  });

  it("round-trips the prompt-cache lifetime per agent, writing no key at the default", () => {
    const configured = set({
      modelSlots: [{ name: "primary" }],
      agents: [
        agent({ modelSlot: "primary", promptCacheTtl: "extended" }),
        agent({ name: "scout", modelId: "openai/o-fixed" }),
      ],
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.agents[0]!.promptCacheTtl).toBe("extended");
    // An agent that names no lifetime loads as the provider default rather than as the
    // priced-up one.
    expect(draft.agents[1]!.promptCacheTtl).toBe("standard");

    const back = capabilitySetFromDraft(draft, null);
    expect(back.agents[0]!.promptCacheTtl).toBe("extended");
    expect(back.agents[1]!.promptCacheTtl).toBeUndefined();
  });

  it("round-trips loop detection knob for knob, writing no key when nobody armed it", () => {
    const configured = set({
      agents: [
        agent({
          loopDetection: {
            enabled: true,
            windowWords: 512,
            // 0 is a SETTING on this knob — "abandon as soon as the window saturates" —
            // not an unset field, and it has to survive as one.
            minSaturatedRun: 0,
          },
        }),
        agent({ name: "scout" }),
      ],
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.agents[0]!.loopDetection.enabled).toBe(true);
    expect(draft.agents[0]!.loopDetection.knobs.windowWords).toBe("512");
    expect(draft.agents[0]!.loopDetection.knobs.minSaturatedRun).toBe("0");
    // A knob the configuration did not name is an empty field, which is exactly "take
    // gg's default" — seeding it with the default figure would freeze today's number into
    // every stored configuration.
    expect(draft.agents[0]!.loopDetection.knobs.repeatThreshold).toBe("");
    // An agent that names no declaration loads disarmed, which is gg's own reading of
    // the absent key.
    expect(draft.agents[1]!.loopDetection.enabled).toBe(false);

    const back = capabilitySetFromDraft(draft, null);
    expect(back.agents[0]!.loopDetection).toEqual({
      enabled: true,
      windowWords: 512,
      minSaturatedRun: 0,
    });
    expect(back.agents[1]!.loopDetection).toBeUndefined();
  });

  it("keeps the knobs of a detector that was tuned and then switched off", () => {
    // The operator configured it and disarmed it; discarding the settings on save would
    // lose them the next time it was armed.
    const draft = emptyDraft();
    draft.agents[0]!.loopDetection = {
      enabled: false,
      knobs: {
        ...draft.agents[0]!.loopDetection.knobs,
        repeatThreshold: "64",
      },
    };
    expect(
      capabilitySetFromDraft(draft, null).agents[0]!.loopDetection,
    ).toEqual({ enabled: false, repeatThreshold: 64 });
  });

  it("writes no knob for a field left empty or half-typed", () => {
    const draft = emptyDraft();
    draft.agents[0]!.loopDetection = {
      enabled: true,
      knobs: { ...draft.agents[0]!.loopDetection.knobs, windowWords: "  " },
    };
    expect(
      capabilitySetFromDraft(draft, null).agents[0]!.loopDetection,
    ).toEqual({ enabled: true });
  });

  it("refuses a loop-detection knob that is not a whole, non-negative count", () => {
    const draft = emptyDraft();
    const knobs = draft.agents[0]!.loopDetection.knobs;
    draft.agents[0]!.loopDetection = {
      enabled: true,
      knobs: { ...knobs, windowWords: "-4" },
    };
    expect(draftSaveError(draft)).toContain("Root");
    expect(draftSaveError(draft)).toContain("Window (words)");
    draft.agents[0]!.loopDetection = {
      enabled: true,
      knobs: { ...knobs, windowWords: "12.5" },
    };
    expect(draftSaveError(draft)).not.toBeNull();
    draft.agents[0]!.loopDetection = {
      enabled: true,
      knobs: { ...knobs, windowWords: "512" },
    };
    expect(draftSaveError(draft)).toBeNull();
  });

  it("warns, without refusing, about an armed detector that could never trip", () => {
    // gg resolves this at launch by arming it as declared and warning; the console says the
    // same thing while it can still be fixed, and refuses nothing gg would accept.
    const draft = emptyDraft();
    const knobs = draft.agents[0]!.loopDetection.knobs;
    const armed = {
      enabled: true,
      knobs: { ...knobs, windowWords: "8", minOffenders: "20" },
    };
    draft.agents[0]!.loopDetection = armed;
    expect(loopDetectionWarning(armed)).toContain("could never trip");
    expect(draftSaveError(draft)).toBeNull();

    // Nothing is said about a detector nothing will read.
    expect(loopDetectionWarning({ ...armed, enabled: false })).toBeNull();
  });

  it("refuses structural agent errors", () => {
    const draft = emptyDraft();
    draft.agents.push(agentDraft(draft, "reviewer"));
    expect(draftSaveError(draft)).toBeNull();

    // Duplicate names.
    draft.agents[1]!.name = "Root";
    expect(draftSaveError(draft)).toContain("unique");
    draft.agents[1]!.name = "reviewer";

    // An empty name.
    draft.agents[1]!.name = "  ";
    expect(draftSaveError(draft)).toContain("needs a name");
    draft.agents[1]!.name = "reviewer";
    expect(draftSaveError(draft)).toBeNull();
  });

  // The root is a flag, not a name and not a position: renaming it (or handing the flag
  // to another profile) has to leave a configuration that still saves, with the root
  // written first because that is where gg reads it from.
  it("lets the root be renamed and the flag moved to another agent", () => {
    const draft = emptyDraft();
    const reviewer = agentDraft(draft, "reviewer");
    draft.agents.push(reviewer);

    draft.agents[0]!.name = "conductor";
    expect(draftSaveError(draft)).toBeNull();
    expect(
      capabilitySetFromDraft(draft, null).agents.map((a) => a.name),
    ).toEqual(["conductor", "reviewer"]);

    // Hand the flag over: the wire order follows the flag, not the list order.
    draft.rootAgentId = reviewer.id;
    expect(draftSaveError(draft)).toBeNull();
    expect(
      capabilitySetFromDraft(draft, null).agents.map((a) => a.name),
    ).toEqual(["reviewer", "conductor"]);
  });

  // Renaming an agent another agent's roster names used to write an unsavable
  // configuration (the roster still spelled the old name). References are ids now, so a
  // rename is just a rename.
  it("carries a roster reference through a rename of its target", () => {
    const draft = emptyDraft();
    const reviewer = agentDraft(draft, "reviewer");
    draft.agents.push(reviewer);
    draft.agents[0]!.subagents = [
      {
        agentId: reviewer.id,
        description: "for reviews",
        scopes: ["reviewer"],
      },
    ];
    expect(draftSaveError(draft)).toBeNull();

    reviewer.name = "critic";
    expect(draftSaveError(draft)).toBeNull();
    expect(capabilitySetFromDraft(draft, null).agents[0]!.subagents).toEqual([
      { agent: "critic", description: "for reviews", scopes: ["reviewer"] },
    ]);
  });

  it("refuses to save a configuration with no agents at all", () => {
    const draft = emptyDraft();
    draft.agents = [];
    draft.rootAgentId = "";
    expect(draftSaveError(draft)).toContain("at least one agent");
  });

  // An issue names the agent it is dispatched to, drawn from the filer's own
  // *implementers*, so a board agent whose roster lists none could never file a valid
  // one. gg refuses such a set at launch; the editor refuses it while it can still be
  // fixed.
  it("refuses an issue filer with no implementer to assign issues to", () => {
    const draft = emptyDraft();
    draft.agents[0]!.capabilities["project-management"] = {
      enabled: true,
      params: {},
    };
    // Switching a capability on grants what it offers — the pairing the editor writes, and
    // what makes this agent a filer rather than one holding a board it cannot write to.
    Object.assign(draft.agents[0]!, grantsOf(["project-management"]));
    expect(draftSaveError(draft)).toContain("no implementer");

    // A spawnable-only roster entry is not an implementer, so it does not satisfy it.
    const rootId = draft.agents[0]!.id;
    draft.agents[0]!.subagents = [
      { agentId: rootId, description: "", scopes: ["subagent"] },
    ];
    expect(draftSaveError(draft)).toContain("no implementer");

    // Read-only board access — the allowlist does not grant `create_issue` — needs no
    // roster at all.
    draft.agents[0]!.subagents = [];
    draft.agents[0]!.tools = draft.agents[0]!.tools.filter(
      (tool) => tool !== "create_epic" && tool !== "create_issue",
    );
    expect(draftSaveError(draft)).toBeNull();

    // And so does a filer with an implementer — a profile may list itself.
    draft.agents[0]!.tools = [...draft.agents[0]!.tools, "create_issue"];
    draft.agents[0]!.subagents = [
      { agentId: rootId, description: "", scopes: ["implementer"] },
    ];
    expect(draftSaveError(draft)).toBeNull();
  });
});

// A minimal agent draft for tests that push a second agent onto an existing draft, bound
// to the same model slot its root is.
function agentDraft(draft: GgConfigDraft, name: string): GgAgentDraft {
  return {
    ...blankAgentDraft(name, [], {}, draft.modelSlots[0]!.id),
    subagents: [],
  };
}

describe("gg filesystem capabilities", () => {
  it("round-trips a capped read mode and its line cap", () => {
    const configured = capSet([
      {
        id: "read-file",
        enabled: true,
        implementation: "default-cap",
        params: { lineCap: 250 },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)["read-file"]?.implementation).toBe("default-cap");
    expect(draftCaps(draft)["read-file"]?.params?.lineCap).toBe("250");
    expect(draftCaps(draft)["read-file"]?.extraParams).toEqual({});

    const back = capabilitySetFromDraft(draft, null);
    const readFile = setCaps(back).find((cap) => cap.id === "read-file");
    expect(readFile?.implementation).toBe("default-cap");
    expect(readFile?.params).toEqual({ lineCap: 250 });
  });
});

// The `responses-as-code` capability's `healing` param: a `toggles` control whose members
// each sit at their own default — two on, `drop-doubled-response` off — so only the ones
// an operator MOVES are ever written, in whichever direction they moved.
const CODE = "responses-as-code";

// The one param a code agent cannot leave out: gg drives no run in a language nobody
// named, so a stored `responses-as-code` block without one is a configuration the launch
// refuses and the form refuses to save. The fixtures below are about some *other* param,
// and carry this so they are documents that could really have been stored.
const LANG = "typescript";

function healingOf(s: GgCapabilitySet): unknown {
  return setCaps(s).find((cap) => cap.id === CODE)?.params?.healing;
}

// The program language: the catalog's one required param, and the only one whose empty
// field is an error rather than a deferral to gg.
describe("gg program language", () => {
  // A code agent the operator never touched still saves a language, because there is no
  // default behind it: what gg reads is what the configuration says, and a document that
  // says nothing is one gg refuses.
  it("seeds a fresh code agent with a language it writes down", () => {
    const draft = emptyDraft();
    draft.agents[0]!.mode = "rac";
    expect(
      setCaps(capabilitySetFromDraft(draft, null)).find(
        (cap) => cap.id === CODE,
      )?.params,
    ).toEqual({ language: LANG });
  });

  // Reachable by opening a configuration stored before the param was required, or by
  // picking the placeholder row. The form says so where it can still be fixed, rather
  // than letting the launch be the first thing that reports it.
  it("refuses to save a code agent whose language is empty", () => {
    const draft = emptyDraft();
    draft.agents[0]!.mode = "rac";
    draft.agents[0]!.capabilities[CODE] = {
      ...draft.agents[0]!.capabilities[CODE]!,
      params: { language: "" },
    };
    expect(agentSaveError(draft, draft.agents[0]!.id)).toMatch(
      /Program language has no default/,
    );
    expect(draftSaveError(draft)).toMatch(/responses-as-code params/);
  });

  // The switch decides whether it may be left out, not whether it is read: a tool-calling
  // agent writes no programs, and its off responses-as-code block is not a hole.
  it("asks no language of an agent that writes no programs", () => {
    const draft = emptyDraft();
    draft.agents[0]!.capabilities[CODE] = {
      ...draft.agents[0]!.capabilities[CODE]!,
      params: { language: "" },
    };
    expect(draftSaveError(draft)).toBeNull();
  });
});

// The `healing` toggles draft of the (single) agent, which holds the members moved off
// their default rather than a raw off-list.
function healingDraft(draft: GgConfigDraft): string | undefined {
  return draftCaps(draft)[CODE]?.params?.healing;
}

describe("gg response-healing toggles", () => {
  it("writes nothing when every strategy is left at its own default", () => {
    const draft = emptyDraft();
    draft.agents[0]!.capabilities[CODE] = {
      ...draft.agents[0]!.capabilities[CODE]!,
      enabled: true,
    };
    expect(healingOf(capabilitySetFromDraft(draft, null))).toBeUndefined();
  });

  it("round-trips the strategies a configuration switches off", () => {
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { language: LANG, healing: { "strip-prose": false } },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)[CODE]?.params?.healing).toBe("strip-prose");
    expect(draftCaps(draft)[CODE]?.extraParams).toEqual({});
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      "strip-prose": false,
    });
  });

  it("reads the `false` master switch as every strategy off", () => {
    const configured = capSet([
      { id: CODE, enabled: true, params: { language: LANG, healing: false } },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      "strip-fences": false,
      "strip-prose": false,
    });
  });

  it("arms the one strategy gg leaves off, which no subtractive rule could express", () => {
    // `drop-doubled-response` is the only repair that is off unless a configuration arms
    // it — the half it deletes is valid code under any other reading — so the draft has to
    // record a MOVE rather than an omission, and write `true` rather than nothing.
    const draft = emptyDraft();
    const cap = draft.agents[0]!.capabilities[CODE]!;
    // The param belongs to the responses-as-code agent TYPE, so the agent has to be one
    // for anything about it to be written at all.
    draft.agents[0]!.mode = "rac";
    draft.agents[0]!.capabilities[CODE] = {
      ...cap,
      enabled: true,
      params: { ...cap.params, healing: "drop-doubled-response" },
    };
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      "drop-doubled-response": true,
    });
  });

  it("round-trips an armed default-off strategy back to the same key", () => {
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { language: LANG, healing: { "drop-doubled-response": true } },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    // Moved off its default, so it is exactly what the draft records.
    expect(healingDraft(draft)).toBe("drop-doubled-response");
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      "drop-doubled-response": true,
    });
  });

  it("leaves an unmentioned default-off strategy off rather than arming it", () => {
    // A stored object names only what was moved, so every member it does not mention takes
    // its own default — which for this one is off. Resolving the off-list off the entries
    // alone would silently arm it on the next save.
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { language: LANG, healing: { "strip-fences": false } },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(healingDraft(draft)).toBe("strip-fences");
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      "strip-fences": false,
    });
  });

  it("reads the `true` shorthand as the defaults, not as every strategy on", () => {
    // The two scalar shorthands are deliberately asymmetric: `false` is the master switch
    // and means every member off, while `true` means each member at its own default — so
    // it must not arm the one that defaults off.
    const configured = capSet([
      { id: CODE, enabled: true, params: { language: LANG, healing: true } },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(healingDraft(draft)).toBe("");
    expect(healingOf(capabilitySetFromDraft(draft, null))).toBeUndefined();
  });

  it("preserves a value the control cannot represent in the passthrough", () => {
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { language: LANG, healing: { stripProse: false } },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)[CODE]?.params?.healing).toBeUndefined();
    expect(draftCaps(draft)[CODE]?.extraParams).toEqual({
      healing: { stripProse: false },
    });
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      stripProse: false,
    });
  });
});

// The `skills` capability's `builtIns` param: the second `toggles` control in the form,
// over the eleven skills gg ships for its own tool families. It reads exactly like
// `healing` — an absent key is every built-in offered, and only the withheld ones are
// written — which is the property worth pinning, because a control that recorded the ON
// members would make each saved configuration an explicit opt-in to a list gg is free to
// grow.
function builtInsOf(s: GgCapabilitySet): unknown {
  return setCaps(s).find((cap) => cap.id === "skills")?.params?.builtIns;
}

describe("gg built-in skill toggles", () => {
  it("covers one family per built-in skill gg ships", () => {
    // The ids are `read_skill` handles and the `builtIns` keys at once, so a typo here is
    // a checkbox that withholds nothing. Kept in gg's own order (`FAMILIES` in
    // `crates/gg/src/skills.builtin.rs`).
    expect(BUILT_IN_SKILL_OPTIONS.map((option) => option.value)).toEqual([
      "gg-filesystem",
      "gg-shell",
      "gg-project",
      "gg-tasks",
      "gg-memory",
      "gg-skills",
      "gg-context",
      "gg-delegation",
      "gg-views",
      "gg-programs",
      "gg-session",
    ]);
    const param = CAPABILITIES.find((cap) => cap.id === "skills")?.params?.find(
      (p) => p.key === "builtIns",
    );
    expect(param?.kind).toBe("toggles");
    expect(param?.options).toBe(BUILT_IN_SKILL_OPTIONS);
    // No seeded value: the default arm is the empty draft, as for every toggle set.
    expect(param?.defaultValue).toBeUndefined();
  });

  it("writes nothing when every built-in is left on", () => {
    const draft = emptyDraft();
    draft.agents[0]!.capabilities.skills = {
      ...draft.agents[0]!.capabilities.skills!,
      enabled: true,
    };
    expect(builtInsOf(capabilitySetFromDraft(draft, null))).toBeUndefined();
  });

  it("round-trips the built-ins a configuration switches off", () => {
    const configured = capSet([
      {
        id: "skills",
        enabled: true,
        params: { builtIns: { "gg-shell": false, "gg-session": false } },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    // Decoded in catalog order rather than the order the stored object happened to be
    // written in, so two equivalent configurations produce one draft value.
    expect(draftCaps(draft).skills?.params?.builtIns).toBe(
      "gg-shell,gg-session",
    );
    expect(draftCaps(draft).skills?.extraParams).toEqual({});
    expect(builtInsOf(capabilitySetFromDraft(draft, null))).toEqual({
      "gg-shell": false,
      "gg-session": false,
    });
  });

  it("reads the `false` master switch as every built-in withheld", () => {
    const configured = capSet([
      { id: "skills", enabled: true, params: { builtIns: false } },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(builtInsOf(capabilitySetFromDraft(draft, null))).toEqual(
      Object.fromEntries(
        BUILT_IN_SKILL_OPTIONS.map((option) => [option.value, false]),
      ),
    );
  });
});

// The `responses-as-code` capability's `docViewTypes` param: which SDK types a
// documentation lookup opens beside the function it was asked for. Three INDEPENDENT
// toggles reading exactly like `healing` above — `return` and `errors` on unless moved,
// `parameters` off unless asked for — and whose per-agent scoping is the point: a root
// that opens everything a signature names and a reviewer that opens nothing are the same
// configuration.

function docViewTypesOf(s: GgCapabilitySet): unknown {
  return setCaps(s).find((cap) => cap.id === CODE)?.params?.docViewTypes;
}

describe("gg documentation type toggles", () => {
  it("writes nothing when every type is left at its own default", () => {
    const draft = emptyDraft();
    draft.agents[0]!.capabilities[CODE] = {
      ...draft.agents[0]!.capabilities[CODE]!,
      enabled: true,
    };
    expect(docViewTypesOf(capabilitySetFromDraft(draft, null))).toBeUndefined();
  });

  it("round-trips a default-on type a configuration switches off", () => {
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { language: LANG, docViewTypes: { errors: false } },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)[CODE]?.params?.docViewTypes).toBe("errors");
    expect(draftCaps(draft)[CODE]?.extraParams).toEqual({});
    expect(docViewTypesOf(capabilitySetFromDraft(draft, null))).toEqual({
      errors: false,
    });
  });

  it("round-trips the one type gg leaves off, which no subtractive rule could express", () => {
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { language: LANG, docViewTypes: { parameters: true } },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)[CODE]?.params?.docViewTypes).toBe("parameters");
    expect(docViewTypesOf(capabilitySetFromDraft(draft, null))).toEqual({
      parameters: true,
    });
  });

  it("reads the `false` master switch as every type withheld", () => {
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { language: LANG, docViewTypes: false },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(docViewTypesOf(capabilitySetFromDraft(draft, null))).toEqual({
      return: false,
      errors: false,
    });
  });

  it("reads the `true` shorthand as the defaults, not as every type on", () => {
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { language: LANG, docViewTypes: true },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)[CODE]?.params?.docViewTypes).toBe("");
    expect(docViewTypesOf(capabilitySetFromDraft(draft, null))).toBeUndefined();
  });

  it("is per agent, so two profiles can carry different types", () => {
    const configured: GgCapabilitySet = {
      agents: [
        agent({
          name: "Root",
          capabilities: [
            {
              id: CODE,
              enabled: true,
              params: { language: LANG, docViewTypes: { parameters: true } },
            },
          ],
        }),
        agent({
          name: "Reviewer",
          capabilities: [
            {
              id: CODE,
              enabled: true,
              params: { language: LANG, docViewTypes: false },
            },
          ],
        }),
      ],
    };
    const draft = draftFromCapabilitySet(configured);
    expect(
      draft.agents.map((a) => a.capabilities[CODE]?.params?.docViewTypes),
    ).toEqual(["parameters", "return,errors"]);

    const back = capabilitySetFromDraft(draft, null);
    expect(
      back.agents.map(
        (a) => a.capabilities.find((cap) => cap.id === CODE)?.params,
      ),
    ).toEqual([
      { language: LANG, docViewTypes: { parameters: true } },
      { language: LANG, docViewTypes: { return: false, errors: false } },
    ]);
  });
});

// --- Removed capabilities ------------------------------------------------------
//
// A capability gg no longer has can still be named by a configuration an operator saved
// while it existed. Loading one must not fail — the operator has to reach the editor to
// rewrite it — and saving it must not carry the dead capability back out.

describe("gg removed capabilities", () => {
  // `completion` became an [agent-stop hook]: the same ending gate, declared once and
  // applying to every agent rather than to the profiles that remembered to enable it. A
  // stored set naming it opens (with its validation commands visible nowhere, because
  // there is no row to show them in) and re-saves without it. The commands must be
  // re-authored as an agent-stop hook.
  it("opens a configuration that still names `completion` and re-saves without it", () => {
    const stored = capSet([
      { id: "shell", enabled: true, params: {} },
      {
        id: "completion",
        enabled: true,
        implementation: "explicit-call",
        params: { validation: [{ command: "npm test", cwd: "game" }] },
      },
    ]);

    const draft = draftFromCapabilitySet(stored);
    expect(draftCaps(draft)["completion"]).toBeUndefined();
    expect(draftCaps(draft)["shell"]?.enabled).toBe(true);

    const saved = capabilitySetFromDraft(draft, null);
    expect(
      setCaps(saved).find((cap) => cap.id === "completion"),
    ).toBeUndefined();
    expect(setCaps(saved).map((cap) => cap.id)).toContain("shell");
  });
});

describe("gg capability params", () => {
  function paramsOf(s: GgCapabilitySet, id: string): Record<string, unknown> {
    return (setCaps(s).find((cap) => cap.id === id)?.params ?? {}) as Record<
      string,
      unknown
    >;
  }

  it("round-trips the numeric caps that used to need hand-edited JSON", () => {
    const configured = capSet([
      { id: "tasks", enabled: true, params: { maxTasks: 40 } },
      {
        id: "memories",
        enabled: true,
        params: { maxCount: 5, maxLenPerMemory: 1500, maxTotalLen: 6000 },
      },
      {
        id: "project-management",
        enabled: true,
        params: { maxEpics: 20, maxIssues: 80 },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft).tasks?.params?.maxTasks).toBe("40");
    expect(draftCaps(draft).tasks?.extraParams).toEqual({});
    expect(draftCaps(draft).memories?.params?.maxLenPerMemory).toBe("1500");

    const back = capabilitySetFromDraft(draft, null);
    expect(paramsOf(back, "tasks")).toEqual({ maxTasks: 40 });
    expect(paramsOf(back, "memories")).toEqual({
      maxCount: 5,
      maxLenPerMemory: 1500,
      maxTotalLen: 6000,
    });
    expect(paramsOf(back, "project-management")).toMatchObject({
      maxEpics: 20,
      maxIssues: 80,
    });
  });

  // A feature switch records only its on arm: off is the absent key, so an untouched
  // switch leaves the capability's params exactly as they were.
  it("round-trips the reviewers feature switch as a present-or-absent key", () => {
    const on = draftFromCapabilitySet(
      capSet([
        {
          id: "project-management",
          enabled: true,
          params: { reviewers: true },
        },
      ]),
    );
    expect(draftCaps(on)["project-management"]?.params?.reviewers).toBe("true");
    expect(
      paramsOf(capabilitySetFromDraft(on, null), "project-management"),
    ).toHaveProperty("reviewers", true);

    // A stored `false` means the same thing as no key, and re-saves as no key.
    const off = draftFromCapabilitySet(
      capSet([
        {
          id: "project-management",
          enabled: true,
          params: { reviewers: false },
        },
      ]),
    );
    expect(draftCaps(off)["project-management"]?.params?.reviewers).toBe("");
    expect(
      paramsOf(capabilitySetFromDraft(off, null), "project-management"),
    ).not.toHaveProperty("reviewers");
  });

  // Only two of the five module-backed capabilities still offer an `ownership` control,
  // and which two is the point of the test: the board and the thread archive can honestly
  // be held out of the prompt and reached through their tools, while the task list (always
  // owned), skills and memories cannot — for the last two the knob was a way of switching
  // the capability off while claiming it was on, and it is gone from gg entirely
  // (`MODULE_CAPABILITIES` in `crates/gg/src/modules.rs`). A control that outlived the
  // param would write a key nothing reads.
  it("offers the ownership control on the board and the archive alone", () => {
    const ownership = (id: string) =>
      CAPABILITIES.find((cap) => cap.id === id)?.params?.some(
        (p) => p.key === "ownership",
      ) ?? false;
    expect(
      ["project-management", "agent-managed-context"].map(ownership),
    ).toEqual([true, true]);
    expect(["tasks", "skills", "memories"].map(ownership)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("round-trips a string param through its text control", () => {
    const configured = capSet([
      { id: "skills", enabled: true, params: { dir: "docs/skills" } },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft).skills?.params?.dir).toBe("docs/skills");
    expect(paramsOf(capabilitySetFromDraft(draft, null), "skills")).toEqual({
      dir: "docs/skills",
    });
  });

  it("preserves a param no control covers through a round-trip", () => {
    const configured = capSet([
      { id: "tasks", enabled: true, params: { maxTasks: 10, futureKnob: 3 } },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft).tasks?.params?.maxTasks).toBe("10");
    expect(draftCaps(draft).tasks?.extraParams).toEqual({ futureKnob: 3 });
    expect(paramsOf(capabilitySetFromDraft(draft, null), "tasks")).toEqual({
      maxTasks: 10,
      futureKnob: 3,
    });
  });
});

describe("gg run limits", () => {
  it("seeds gg's documented defaults into a fresh form, and leaves turns unbounded", () => {
    expect(capabilitySetFromDraft(emptyDraft(), null).limits).toEqual({
      maxParallel: DEFAULT_MAX_PARALLEL,
      maxConsecutiveErrors: DEFAULT_MAX_CONSECUTIVE_ERRORS,
      maxErrorRate: DEFAULT_MAX_ERROR_RATE,
      errorRateWindow: DEFAULT_ERROR_RATE_WINDOW,
    });
    expect(RUN_LIMIT_SPECS.map((spec) => spec.key).sort()).toEqual(
      Object.keys(emptyDraft().limits).sort(),
    );
  });

  it("round-trips every ceiling a configuration declares", () => {
    const configured = set({
      limits: {
        maxTurns: 12,
        maxRuntimeSecs: 5400,
        maxConsecutiveErrors: 4,
        maxErrorRate: 0.75,
        errorRateWindow: 4,
        maxCost: 2.5,
      },
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.limits.maxCost).toBe("2.5");
    expect(capabilitySetFromDraft(draft, null).limits).toEqual(
      configured.limits,
    );
    expect(draftSaveError(draft)).toBeNull();
    expect(runLimitsWarning(draft.limits)).toBeNull();
  });

  it("saves half an error-rate ceiling, which gg arms over the other half's default", () => {
    const draft = emptyDraft();
    // Clear the seeded default window so only the rate is set — the half-declared case.
    // Each half has a documented default, so the written one is armed as written and the
    // absent one takes gg's; refusing the save here would make the editor stricter than
    // the contract.
    draft.limits.errorRateWindow = "";
    draft.limits.maxErrorRate = "0.5";
    expect(draftSaveError(draft)).toBeNull();
    draft.limits.maxErrorRate = "";
    draft.limits.errorRateWindow = "10";
    expect(draftSaveError(draft)).toBeNull();
  });

  it("refuses a ceiling that is not a number in its own units", () => {
    const draft = emptyDraft();
    draft.limits.maxTurns = "twelve";
    expect(draftSaveError(draft)).toContain("must be a number");
    draft.limits.maxTurns = "12.5";
    expect(draftSaveError(draft)).toContain("whole number");
    draft.limits.maxTurns = "12";
    draft.limits.maxCost = "0";
    expect(draftSaveError(draft)).toContain("greater than zero");
  });

  it("warns when the error-rate window can only fill on the last turn", () => {
    const draft = emptyDraft();
    draft.limits.maxTurns = "8";
    draft.limits.maxErrorRate = "0.5";
    draft.limits.errorRateWindow = "8";
    expect(draftSaveError(draft)).toBeNull();
    expect(runLimitsWarning(draft.limits)).toContain("(8)");
    draft.limits.errorRateWindow = "4";
    expect(runLimitsWarning(draft.limits)).toBeNull();
  });

  // The replay ceiling is the one size among the ceilings: the operator reads and writes
  // MiB, the wire carries the bytes gg reads, and neither end ever sees the other's unit.
  it("edits the replay ceiling in MiB and stores it in bytes", () => {
    const draft = draftFromCapabilitySet(
      set({ limits: { replayMaxBytes: 512 * 1024 * 1024 } }),
    );
    expect(draft.limits.replayMaxBytes).toBe("512");
    expect(capabilitySetFromDraft(draft, null).limits?.replayMaxBytes).toBe(
      512 * 1024 * 1024,
    );

    draft.limits.replayMaxBytes = "64";
    expect(draftSaveError(draft)).toBeNull();
    expect(capabilitySetFromDraft(draft, null).limits?.replayMaxBytes).toBe(
      64 * 1024 * 1024,
    );

    draft.limits.replayMaxBytes = "-1";
    expect(draftSaveError(draft)).toContain("cannot be negative");
  });

  it("does not warn about the window when the turn ceiling is unbounded", () => {
    // With no turn ceiling (the default), there is no last turn to pin the window to,
    // so any window has room to fill and nothing is said.
    const draft = emptyDraft();
    draft.limits.maxTurns = "";
    draft.limits.maxErrorRate = "0.5";
    draft.limits.errorRateWindow = "50";
    expect(runLimitsWarning(draft.limits)).toBeNull();
  });
});

// --- A capability param that names a model -------------------------------------
//
// Compaction's handoff model is the one model in a configuration that is not an agent's
// own binding, and it defers to a model slot on exactly the same terms: the launch form
// asks for the slot, binding writes the collected id into `model`, and the set a run
// records is fully pinned. These pin that whole path, because a slot that is declared but
// never asked for at launch is indistinguishable from a working one until the run starts
// compacting on the wrong model.

// The compaction capability, deferring its handoff model to `summarizer`.
function deferredCompaction(): GgCapabilityConfig {
  return {
    id: "compaction",
    enabled: true,
    implementation: "handoff-summarization",
    params: { modelSlot: "summarizer" },
  };
}

// One agent's compaction params out of a wire set.
function compactionParams(set: GgCapabilitySet): Record<string, unknown> {
  const capability = set.agents?.[0]?.capabilities?.find(
    (c) => c.id === "compaction",
  );
  return (capability?.params ?? {}) as Record<string, unknown>;
}

describe("a model slot a capability param defers to", () => {
  it("is asked for at launch even though no agent binds it", () => {
    const configured = set({
      agents: [agent({ capabilities: [deferredCompaction()] })],
      modelSlots: [{ name: "summarizer", defaultModelId: "vendor/cheap" }],
    });
    expect(launchModelSlots(configured)).toEqual([
      { name: "summarizer", defaultModelId: "vendor/cheap" },
    ]);
  });

  it("is bound at launch into the param the run actually reads", () => {
    const configured = set({
      agents: [agent({ capabilities: [deferredCompaction()] })],
      modelSlots: [{ name: "summarizer" }],
    });
    const bound = bindModelSlots(configured, { summarizer: "vendor/cheap" });
    expect(compactionParams(bound)).toEqual({ model: "vendor/cheap" });
    // What runs is fully pinned: nothing is left deferring to a slot that no longer
    // exists on the set.
    expect(bound.modelSlots).toBeUndefined();
  });

  it("binds to nothing rather than to an empty model id", () => {
    // A slot the launcher left blank is the documented "no handoff model" arm — gg
    // condenses on the agent's own model — not a model called "".
    const configured = set({
      agents: [agent({ capabilities: [deferredCompaction()] })],
      modelSlots: [{ name: "summarizer" }],
    });
    expect(compactionParams(bindModelSlots(configured, {}))).toEqual({});
  });

  it("round-trips through the draft as a slot rather than a model id", () => {
    const configured = set({
      agents: [agent({ capabilities: [deferredCompaction()] })],
      modelSlots: [{ name: "summarizer" }],
    });
    const draft = draftFromCapabilitySet(configured);
    const slotId = draft.modelSlots.find((s) => s.name === "summarizer")?.id;
    expect(slotId).toBeTruthy();
    expect(draft.agents[0]!.capabilities.compaction?.params?.modelSlot).toBe(
      slotId,
    );
    expect(compactionParams(capabilitySetFromDraft(draft, null))).toEqual({
      modelSlot: "summarizer",
    });
  });

  it("keeps the slot declared when only a param refers to it", () => {
    // `capabilitySetFromDraft` saves only the slots something references. A slot used
    // by nothing but a capability param would otherwise be dropped on the first save,
    // silently turning a deferred model into an unbindable one.
    const configured = set({
      agents: [agent({ capabilities: [deferredCompaction()] })],
      modelSlots: [{ name: "summarizer", defaultModelId: "vendor/cheap" }],
    });
    const saved = capabilitySetFromDraft(
      draftFromCapabilitySet(configured),
      null,
    );
    expect(saved.modelSlots).toEqual([
      { name: "summarizer", defaultModelId: "vendor/cheap" },
    ]);
  });

  it("survives a slot rename, which is what binding by identity buys", () => {
    const configured = set({
      agents: [agent({ capabilities: [deferredCompaction()] })],
      modelSlots: [{ name: "summarizer" }],
    });
    const draft = draftFromCapabilitySet(configured);
    const renamed: GgConfigDraft = {
      ...draft,
      modelSlots: draft.modelSlots.map((s) => ({ ...s, name: "critic" })),
    };
    expect(compactionParams(capabilitySetFromDraft(renamed, null))).toEqual({
      modelSlot: "critic",
    });
  });

  it("leaves a pinned model alone", () => {
    const configured = set({
      agents: [
        agent({
          capabilities: [
            {
              id: "compaction",
              enabled: true,
              implementation: "handoff-summarization",
              params: { model: "vendor/pinned" },
            },
          ],
        }),
      ],
    });
    expect(
      compactionParams(bindModelSlots(configured, { summarizer: "vendor/x" })),
    ).toEqual({ model: "vendor/pinned" });
  });
});

// --- Params only shown where they are read -------------------------------------
//
// A control the selected strategy does not read can only mislead, so the catalog names
// the implementations each param applies under. These pin the ones whose gating is not
// obvious from the label — and the two shell ceilings, whose defaults the form seeds.

describe("params gated on the selected implementation", () => {
  const paramOf = (capId: string, key: string) => {
    const param = CAPABILITIES.find((c) => c.id === capId)?.params?.find(
      (p) => p.key === key,
    );
    if (!param) throw new Error(`no ${capId}.${key} param in the catalog`);
    return param;
  };

  it("offers the shell ceilings under the truncating modes only", () => {
    for (const key of ["maxLines", "maxChars"]) {
      const param = paramOf("shell", key);
      expect(paramApplies(param, "")).toBe(true);
      expect(paramApplies(param, "offload")).toBe(true);
      expect(paramApplies(param, "inline")).toBe(false);
    }
  });

  it("seeds the shell ceilings to the defaults gg would apply anyway", () => {
    expect(paramOf("shell", "maxLines").defaultValue).toBe(
      String(DEFAULT_SHELL_MAX_LINES),
    );
    expect(paramOf("shell", "maxChars").defaultValue).toBe(
      String(DEFAULT_SHELL_MAX_CHARS),
    );
  });

  // gg's own defaults are `return` and `errors` on and `parameters` off, which an empty
  // toggles draft already reads as — so seeding a value would only make the default arm
  // look configured.
  it("seeds no documentation type toggles", () => {
    expect(paramOf("responses-as-code", "docViewTypes").defaultValue).toBe(
      undefined,
    );
  });

  it("offers the read-file line cap under the capped mode only", () => {
    const param = paramOf("read-file", "lineCap");
    expect(paramApplies(param, "")).toBe(false);
    expect(paramApplies(param, "default-cap")).toBe(true);
  });

  it("offers each memory limit under the strategies that read it", () => {
    // gg ignores a limit the chosen strategy does not use (`MemoryCaps::resolve`), so
    // each of these is a box that would change nothing where it is hidden.
    const applies = (key: string, strategy: string) =>
      paramApplies(paramOf("memories", key), strategy);
    expect([
      applies("maxCount", ""),
      applies("maxCount", "keyword-search"),
      applies("maxCount", "markdown"),
    ]).toEqual([true, true, false]);
    expect([
      applies("maxTotalLen", ""),
      applies("maxTotalLen", "markdown"),
    ]).toEqual([true, false]);
    expect([
      applies("maxLenIndex", "markdown"),
      applies("maxLenIndex", ""),
    ]).toEqual([true, false]);
    expect([
      applies("maxResults", "keyword-search"),
      applies("maxResults", ""),
    ]).toEqual([true, false]);
    // Two apply everywhere, and say so by naming no implementations at all.
    for (const key of ["maxLenPerMemory", "maxLenDescription"]) {
      expect(paramOf("memories", key).showWhenImplementation).toBeUndefined();
    }
  });

  it("seeds the memory limits gg really defaults to, and nothing else", () => {
    // A seeded field is a promise that leaving it alone changes nothing, so each of these
    // has to be the figure `MemoryCaps::resolve` would have applied anyway.
    expect(paramOf("memories", "maxCount").defaultValue).toBe(
      String(DEFAULT_MEMORY_MAX_COUNT),
    );
    expect(paramOf("memories", "maxLenPerMemory").defaultValue).toBe(
      String(DEFAULT_MEMORY_MAX_LEN_PER),
    );
    // The description ceiling is a real default now (it used to be unlimited), so the
    // field shows it rather than an empty box that implied there was none.
    expect(paramOf("memories", "maxLenDescription").defaultValue).toBe(
      String(DEFAULT_MEMORY_MAX_LEN_DESCRIPTION),
    );
    // And the scratchpad's aggregate budget went the other way: gg imposes none, so
    // seeding a figure would arm a ceiling nobody asked for on every configuration
    // opened in the editor.
    const total = paramOf("memories", "maxTotalLen");
    expect(total.defaultValue).toBeUndefined();
    expect(total.placeholder).toBe("unlimited");
  });

  it("keeps a hidden param's stored value through a round-trip", () => {
    // Hiding a control must not delete what it held: one capability set is swept across
    // every arm of a study, and switching strategy to look at another arm would
    // otherwise silently drop the ceilings the first arm was configured with.
    const configured = set({
      agents: [
        agent({
          capabilities: [
            {
              id: "shell",
              enabled: true,
              implementation: "inline",
              params: { maxLines: 40 },
            },
          ],
        }),
      ],
    });
    const saved = capabilitySetFromDraft(
      draftFromCapabilitySet(configured),
      null,
    );
    const shell = saved.agents?.[0]?.capabilities?.find(
      (c) => c.id === "shell",
    );
    expect(shell?.params).toEqual({ maxLines: 40 });
  });
});

// --- FSM agents -------------------------------------------------------------------
//
// A machine is the only capability param that is a *document*: an ordered list of
// states, each naming another agent profile and the edges out of it, each edge naming
// the modules it carries. Three things have to hold for it to be authorable at all —
// it must survive a round-trip through the wire format (including the name↔local-id
// translation every cross-reference in this editor goes through), a machine the form
// cannot represent must reach the verbatim passthrough rather than being rewritten
// into a lesser one, and the structural faults gg refuses at launch must be refused
// here, where they can still be fixed.

describe("a state machine", () => {
  const FSM = "fsm";

  // A two-agent configuration whose Root is a machine over the other two profiles.
  function machineSet(
    states: unknown,
    over: Partial<GgAgentConfig> = {},
  ): GgCapabilitySet {
    return {
      agents: [
        agent({
          name: "Feature",
          capabilities: [{ id: FSM, enabled: true, params: { states } }],
          ...over,
        }),
        agent({ name: "Explorer" }),
        agent({ name: "Builder" }),
      ],
    };
  }

  const LINEAR = [
    {
      name: "explore",
      agent: "Explorer",
      transitions: [
        {
          to: "build",
          transfer: ["history", "tasks"],
          description: "when you understand the change",
        },
      ],
    },
    { name: "build", agent: "Builder", transitions: [] },
  ];

  function statesOf(s: GgCapabilitySet): unknown {
    return s.agents?.[0]?.capabilities?.find((c) => c.id === FSM)?.params
      ?.states;
  }

  it("round-trips through the wire format, agent references and all", () => {
    const draft = draftFromCapabilitySet(machineSet(LINEAR));
    // The state's agent is held as a local id in the draft — that is what makes a
    // rename carry it — and resolves back to the profile's name on the way out.
    const rows = agentStates(draft.agents[0]!);
    expect(rows.map((r) => r.name)).toEqual(["explore", "build"]);
    expect(rows[0]!.agentId).toBe(draft.agents[1]!.id);
    expect(statesOf(capabilitySetFromDraft(draft, null))).toEqual(LINEAR);
  });

  it("follows a renamed agent profile rather than orphaning the state", () => {
    const draft = draftFromCapabilitySet(machineSet(LINEAR));
    const renamed: GgConfigDraft = {
      ...draft,
      agents: draft.agents.map((a) =>
        a.name === "Explorer" ? { ...a, name: "Scout" } : a,
      ),
    };
    const states = statesOf(capabilitySetFromDraft(renamed, null)) as Array<{
      agent: string;
    }>;
    expect(states[0]!.agent).toBe("Scout");
  });

  it("carries a renamed state's inbound edges with it", () => {
    const states = [
      { name: "a", agentId: "agent-x", transitions: [] },
      {
        name: "b",
        agentId: "agent-y",
        transitions: [
          { to: "a", transfer: [] as GgModuleKind[], description: "" },
        ],
      },
    ];
    const renamed = renameStateDraft(states, 0, "explore");
    expect(renamed[0]!.name).toBe("explore");
    expect(renamed[1]!.transitions[0]!.to).toBe("explore");
  });

  it("drops a transfer kind gg would not know, exactly as gg does", () => {
    const draft = draftFromCapabilitySet(
      machineSet([
        {
          name: "a",
          agent: "Explorer",
          transitions: [{ to: "a", transfer: ["history", "moon"] }],
        },
      ]),
    );
    expect(agentStates(draft.agents[0]!)[0]!.transitions[0]!.transfer).toEqual([
      "history",
    ]);
  });

  it("passes a machine the form cannot represent through verbatim", () => {
    // A state carrying a key no control covers would be silently dropped by a
    // round-trip through the rows, so the whole param goes to the passthrough instead
    // and re-saves byte-identical.
    const exotic = [{ name: "a", agent: "Explorer", retries: 3 }];
    const round = capabilitySetFromDraft(
      draftFromCapabilitySet(machineSet(exotic)),
      null,
    );
    expect(statesOf(round)).toEqual(exotic);
  });

  it("refuses the structural faults gg refuses at launch", () => {
    const machine = (states: unknown) =>
      draftSaveError(draftFromCapabilitySet(machineSet(states)));

    expect(machine([])).toMatch(/declares no states/);
    expect(machine([{ name: "", agent: "Explorer" }])).toMatch(
      /state with no name/,
    );
    expect(
      machine([
        { name: "a", agent: "Explorer" },
        { name: "a", agent: "Builder" },
      ]),
    ).toMatch(/more than once/);
    expect(machine([{ name: "a", agent: "Nobody" }])).toMatch(
      /runs no agent this configuration declares/,
    );
    expect(machine([{ name: "a", agent: "Feature" }])).toMatch(
      /itself a state machine/,
    );
    expect(
      machine([
        {
          name: "a",
          agent: "Explorer",
          transitions: [{ to: "nowhere", transfer: [] }],
        },
      ]),
    ).toMatch(/not a state it declares/);
    // …and accepts the machine that is actually well-formed.
    expect(machine(LINEAR)).toBeNull();
  });

  it("warns about what is odd rather than wrong", () => {
    const draft = draftFromCapabilitySet(
      machineSet([
        ...LINEAR,
        // Declared, correct, and unreachable — kept, because deleting an author's
        // state to make a warning go away would be worse than saying so.
        { name: "verify", agent: "Builder", transitions: [] },
      ]),
    );
    const warnings = fsmStatesWarnings(draft.agents[0]!, draft.agents);
    expect(warnings.join(" ")).toMatch(/unreachable from `explore`/);
  });

  // A shell used to be able to enable capabilities it would never read, and the editor
  // could only warn about it. An agent's [type](GgAgentMode) is chosen now, a machine
  // offers no capability controls, and none is saved for one — so what was a warning is a
  // state that cannot be reached, which is what this pins.
  it("saves no capability of its own, whatever a stored config claimed", () => {
    const draft = draftFromCapabilitySet(
      machineSet(LINEAR, {
        capabilities: [
          { id: FSM, enabled: true, params: { states: LINEAR } },
          { id: "memories", enabled: true, params: { maxCount: 4 } },
          { id: "shell", enabled: true, params: {} },
        ],
      }),
    );
    expect(draft.agents[0]!.mode).toBe("fsm");
    const shell = capabilitySetFromDraft(draft, null).agents[0]!;
    expect(
      shell.capabilities.filter((c) => c.enabled).map((c) => c.id),
    ).toEqual([FSM]);
    // …and nothing of what it claimed is carried along either.
    expect(shell.capabilities.find((c) => c.id === "memories")?.params).toEqual(
      {},
    );
  });

  // The same argument as the capabilities above, applied to the rest of a worker's
  // configuration: a machine takes no turns, so a model on it would be a binding gg
  // never calls — and a recorded run that claimed one would be describing a model that
  // answered nothing.
  it("saves no model binding, prompt or roster of its own", () => {
    const draft = draftFromCapabilitySet(
      machineSet(LINEAR, {
        modelId: "anthropic/claude-opus-4.8",
        customInstructions: "be brief",
        promptCacheTtl: "extended",
        subagents: [
          { agent: "Builder", description: "", scopes: ["subagent"] },
        ],
      }),
    );
    const shell = capabilitySetFromDraft(draft, null).agents[0]!;
    expect(shell.modelId).toBe("");
    expect(shell.modelSlot).toBeUndefined();
    expect(shell.customInstructions).toBeUndefined();
    expect(shell.systemPromptTemplate).toBeUndefined();
    expect(shell.promptCacheTtl).toBeUndefined();
    expect(shell.subagents).toBeUndefined();
  });

  // …so the save gate must not ask for one either. This is the whole point: a machine
  // with no model is a complete configuration, not an unfinished one.
  it("saves with no model at all", () => {
    const set = machineSet(LINEAR);
    set.agents![0]!.modelId = "";
    expect(draftSaveError(draftFromCapabilitySet(set))).toBeNull();
  });

  // And a slot a machine was pointed at under an earlier type feeds nothing, so the
  // launch form must not ask for a model to fill it.
  it("asks for no model slot at launch", () => {
    const set = machineSet(LINEAR);
    set.agents![0]!.modelId = "";
    set.agents![0]!.modelSlot = "director";
    set.modelSlots = [{ name: "director" }];
    const saved = capabilitySetFromDraft(draftFromCapabilitySet(set), null);
    expect(saved.modelSlots ?? []).toEqual([]);
    expect(launchModelSlots(saved)).toEqual([]);
  });

  // Committing an agent as a machine is where the worker's configuration it used to
  // carry stops being carried — the same wind-back another type's capabilities get.
  it("winds a worker's configuration back on commit", () => {
    const draft = draftFromCapabilitySet(machineSet(LINEAR));
    const committed = resetAgentForMode(draft.agents[0]!);
    expect(committed.modelId).toBe("");
    expect(committed.modelSlotId).toBe("");
    expect(committed.customInstructions).toBe("");
    expect(committed.subagents).toEqual([]);
    expect(committed.promptCacheTtl).toBe("standard");
  });

  // The [mode markers](isModeCapability) are the one entry in the catalog that names a
  // call without granting it: `fsm` declares `transition_state` so the analyze page can
  // file the call under the machine that buys it, and gg offers that call from wherever
  // an instance *stands* rather than off the shell's own allowlist. So no seeding may
  // ever put it in one.
  //
  // Guarded at [grantsOf] rather than at the two places that happen to clear it after the
  // fact — a machine's allowlists are emptied when it is committed, and a load commits —
  // because those are rules about machines, and the marker is what must not seed.
  it("seeds no allowlist from the marker that makes it a machine", () => {
    expect(FSM_CAP.tools).toEqual(["transition_state"]);
    expect(grantsOf([FSM_CAP_ID])).toEqual({ tools: [], operations: [] });

    // A fresh machine draft is born holding nothing, before anything downstream has had a
    // chance to take it back off again.
    const born = blankAgentDraft("Feature", [FSM_CAP_ID]);
    expect(born.mode).toBe("fsm");
    expect(born.tools).toEqual([]);
    expect(born.operations).toEqual([]);

    // And a marker alongside real capabilities takes nothing away from them: the filter
    // is on the marker, not on the call.
    expect(grantsOf([FSM_CAP_ID, "list-dir"])).toEqual(grantsOf(["list-dir"]));
  });
});

// --- A capability that grants nothing ----------------------------------------------
//
// The one state the allowlist can reach that nothing downstream reports: a capability
// switched on whose every call has been switched back off. It saves, it launches, and the
// run record it produces — a model that called none of it — is indistinguishable from a
// model that had the whole surface and chose not to touch it. So the editor has to say
// so, and has to say it about the vocabulary the agent will actually be conducted in.

describe("a capability that is on and grants nothing", () => {
  // `agent-managed-context` is the capability an operator can empty *by hand on the form*:
  // its two feature sliders between them name all three of its calls, so switching both
  // off leaves the capability on and the agent holding none of it.
  const MANAGED = capabilitySpec("agent-managed-context")!;

  // One agent of the given type, with `agent-managed-context` on and granted in both
  // vocabularies — what switching the capability on leaves behind.
  function armed(mode: GgAgentMode): GgAgentDraft {
    const draft = blankAgentDraft(ROOT_AGENT, [
      "agent-managed-context",
      ...(mode === "rac" ? [RESPONSES_AS_CODE_CAP_ID] : []),
    ]);
    expect(draft.mode).toBe(mode);
    return draft;
  }

  it("says nothing while the capability still grants one of its calls", () => {
    const agent = armed("tools");
    expect(capabilityGrantWarning(agent, MANAGED)).toBeNull();

    // Both sliders but the last: a capability the operator has narrowed is configured,
    // not broken, and warning here would fire on the ordinary case.
    const narrowed = {
      ...agent,
      ...setFeatureBundle(agent, MANAGED.features![1]!, false),
    };
    expect(narrowed.tools).toEqual(["evict_file_view"]);
    expect(capabilityGrantWarning(narrowed, MANAGED)).toBeNull();
  });

  it("fires once a tool-calling agent's last tool from it is switched off", () => {
    let agent = armed("tools");
    for (const bundle of MANAGED.features!) {
      agent = { ...agent, ...setFeatureBundle(agent, bundle, false) };
    }
    expect(agent.tools).toEqual([]);
    expect(capabilityGrantWarning(agent, MANAGED)).toContain(
      "All tools disabled",
    );
  });

  it("fires on the operations a code agent reads, not on the tools it does not", () => {
    const agent = armed("rac");
    // Emptied in the vocabulary this agent answers on. Its `tools` half is untouched and
    // full — it is the half a RaC run never reads, and reading it here would report an
    // agent that can call plenty as one that can call nothing.
    const empty = { ...agent, operations: [] };
    expect(empty.tools).toEqual(MANAGED.tools);
    expect(capabilityGrantWarning(empty, MANAGED)).toContain(
      "All operations disabled",
    );

    // And the mirror: the same draft with the *other* half emptied is a code agent whose
    // whole API surface is intact.
    expect(capabilityGrantWarning({ ...agent, tools: [] }, MANAGED)).toBeNull();
  });

  it("is a warning and not a save error", () => {
    const base = emptyDraft();
    const agent = base.agents[0]!;
    const draft = {
      ...base,
      agents: [
        {
          ...agent,
          capabilities: {
            ...agent.capabilities,
            [MANAGED.id]: {
              enabled: true,
              implementation: "",
              params: {},
              extraParams: {},
            },
          },
        },
      ],
    };
    // On, and granting nothing — the capability was switched on by something other than
    // the editor's own toggle, which is the shape a hand-written configuration arrives in.
    expect(capabilityGrantWarning(draft.agents[0]!, MANAGED)).toContain(
      "All tools disabled",
    );
    expect(draftSaveError(draft)).toBeNull();
  });

  it("says nothing about a capability that is switched off", () => {
    const agent = armed("tools");
    const off = {
      ...agent,
      tools: [],
      operations: [],
      capabilities: {
        ...agent.capabilities,
        [MANAGED.id]: { ...agent.capabilities[MANAGED.id]!, enabled: false },
      },
    };
    expect(capabilityGrantWarning(off, MANAGED)).toBeNull();
  });

  it("says nothing about a capability that offers no calls to begin with", () => {
    // A great many capabilities are pure settings: they change how gg runs the agent and
    // hand it no call at all, so an empty allowlist is what they are *supposed* to
    // contribute. Warning on those is how an operator learns to ignore the warning.
    const settings = CAPABILITIES.filter(
      (cap) => !cap.tools?.length && !cap.operations?.length,
    );
    expect(settings.map((cap) => cap.id)).toContain("context-window-override");
    for (const mode of ["tools", "rac"] as const) {
      const agent = {
        ...armed(mode),
        capabilities: Object.fromEntries(
          settings.map((cap) => [
            cap.id,
            { enabled: true, implementation: "", params: {}, extraParams: {} },
          ]),
        ),
      };
      for (const cap of settings) {
        expect(capabilityGrantWarning(agent, cap)).toBeNull();
      }
    }
  });

  it("says nothing about a capability whose whole surface is the other vocabulary", () => {
    // `docview-close` buys operations and no tool. It is offered to a code agent only, so
    // the tool-calling half of the question is answered by the capability not being live
    // at all — but the warning must not fire on it either way.
    const docviews = capabilitySpec("docview-close")!;
    const enable = (agent: GgAgentDraft) => ({
      ...agent,
      capabilities: {
        ...agent.capabilities,
        [docviews.id]: {
          enabled: true,
          implementation: "",
          params: {},
          extraParams: {},
        },
      },
    });
    expect(docviews.tools).toBeUndefined();
    expect(capabilityGrantWarning(enable(armed("tools")), docviews)).toBeNull();
    // On, live, and granted under the type that does read it.
    const code = {
      ...enable(armed("rac")),
      operations: [...docviews.operations!],
    };
    expect(capabilityGrantWarning(code, docviews)).toBeNull();
    expect(
      capabilityGrantWarning({ ...code, operations: [] }, docviews),
    ).toContain("All operations disabled");
  });

  it("says nothing about a machine's transition, which no allowlist grants", () => {
    // The [mode markers](isModeCapability) are the one place a declared name is not a
    // grant: `fsm` names `transition_state` for the analyze page, nothing seeds an
    // allowlist from a marker, and a committed machine's two allowlists are emptied
    // outright — so the naive question ("live, and holding none of what it offers?")
    // answers yes on every machine ever loaded, on the one agent type whose States tab
    // has nothing else to say. The advice would be unfollowable there: the type selector
    // is the marker's switch, and it has no feature slider to put the call back.
    const machine = draftFromCapabilitySet({
      agents: [
        agent({
          name: "Feature",
          capabilities: [
            {
              id: FSM_CAP_ID,
              enabled: true,
              params: {
                states: [
                  { name: "explore", agent: "Explorer", transitions: [] },
                ],
              },
            },
          ],
        }),
        agent({ name: "Explorer" }),
      ],
    }).agents[0]!;
    expect(machine.mode).toBe("fsm");
    // Exactly the shape that fires, every part of it true and none of it a fault.
    expect(capabilityActive(machine, FSM_CAP)).toBe(true);
    expect(FSM_CAP.tools).toEqual(["transition_state"]);
    expect(machine.tools).toEqual([]);
    expect(capabilityGrantWarning(machine, FSM_CAP)).toBeNull();
  });
});

// --- Agent types ------------------------------------------------------------------
//
// An agent's type is not a capability: it decides how the agent is implemented, and so
// which capabilities are even offered to it. The wire format has no field for it — it
// records the type as the two mode-marker capabilities — so the draft's job is to project
// one onto the other in both directions, and to save exactly the selected type's
// configuration and no other's.

describe("an agent's type", () => {
  const capsOf = (s: GgCapabilitySet, id: string) =>
    s.agents[0]!.capabilities.find((c) => c.id === id);

  it("is read off the mode-marker capabilities a stored config carries", () => {
    expect(draftFromCapabilitySet(capSet([])).agents[0]!.mode).toBe("tools");
    expect(
      draftFromCapabilitySet(
        capSet([{ id: "responses-as-code", enabled: true, params: {} }]),
      ).agents[0]!.mode,
    ).toBe("rac");
    expect(
      draftFromCapabilitySet(capSet([{ id: "fsm", enabled: true, params: {} }]))
        .agents[0]!.mode,
    ).toBe("fsm");
  });

  it("writes itself back out as those same two flags", () => {
    const draft = emptyDraft();
    draft.agents[0]!.mode = "rac";
    const saved = capabilitySetFromDraft(draft, null);
    expect(capsOf(saved, "responses-as-code")?.enabled).toBe(true);
    expect(capsOf(saved, "fsm")?.enabled).toBe(false);
  });

  // The rule the whole projection exists for: a saved agent carries the configuration of
  // the type it was saved under, and none of any other. Anything else would record a run
  // as having had a capability gg never read.
  it("saves only the selected type's configuration", () => {
    const draft = draftFromCapabilitySet(
      capSet([
        {
          id: "responses-as-code",
          enabled: true,
          params: { language: LANG, imageViewCap: 4 },
        },
        { id: "program-library", enabled: true, params: { keep: 5 } },
        { id: "shell", enabled: true, params: {} },
      ]),
    );
    // As a code agent, all three are its configuration.
    const asCode = capabilitySetFromDraft(draft, null);
    expect(capsOf(asCode, "program-library")?.enabled).toBe(true);
    expect(capsOf(asCode, "responses-as-code")?.params).toEqual({
      language: LANG,
      imageViewCap: 4,
    });

    // Turned into a tool-calling agent, the two that only a code agent reads are not
    // written down at all — and the one both types read is untouched.
    draft.agents[0]!.mode = "tools";
    const asTools = capabilitySetFromDraft(draft, null);
    expect(capsOf(asTools, "responses-as-code")).toEqual({
      id: "responses-as-code",
      enabled: false,
      params: {},
    });
    expect(capsOf(asTools, "program-library")).toEqual({
      id: "program-library",
      enabled: false,
      params: {},
    });
    expect(capsOf(asTools, "shell")?.enabled).toBe(true);
  });

  // Switching type inside one editing session must lose nothing…
  it("keeps another type's configuration in the draft until the agent is committed", () => {
    const draft = draftFromCapabilitySet(
      capSet([
        { id: "responses-as-code", enabled: true, params: {} },
        { id: "program-library", enabled: true, params: { keep: 5 } },
      ]),
    );
    draft.agents[0]!.mode = "tools";
    expect(draft.agents[0]!.capabilities["program-library"]).toMatchObject({
      enabled: true,
      params: { keep: "5" },
    });
  });

  // …and committing the agent is what turns that scratch space back into the defaults a
  // fresh agent of the other type would have had, so reopening it and switching back
  // never resurrects a configuration that was not saved.
  it("winds another type's configuration back to the catalog defaults on commit", () => {
    const draft = draftFromCapabilitySet(
      capSet([
        { id: "responses-as-code", enabled: true, params: {} },
        { id: "program-library", enabled: true, params: { keep: 5 } },
      ]),
    );
    const committed = resetAgentForMode({
      ...draft.agents[0]!,
      mode: "tools",
    });
    expect(committed.capabilities["program-library"]).toEqual({
      enabled: false,
      implementation: "",
      params: {},
      extraParams: {},
    });
    // A capability the catalog turns on by default comes back on, not merely blank —
    // "the defaults for that type" is what a fresh agent of it would have been.
    expect(
      resetAgentForMode({ ...draft.agents[0]!, mode: "fsm" }).capabilities[
        "shell"
      ]?.enabled,
    ).toBe(true);
  });

  // The same wind-back on the way in, so a reload and a commit agree: a stored agent
  // opens on its own type's configuration and on the defaults for every other.
  it("opens a stored agent on the defaults for the types it was not saved under", () => {
    const draft = draftFromCapabilitySet(
      capSet([{ id: "responses-as-code", enabled: true, params: {} }]),
    );
    expect(draft.agents[0]!.mode).toBe("rac");
    // `shell` is a catalog default and the stored config named it nowhere, so it loads
    // off — a stored capability list is exhaustive for the type it was saved under.
    expect(draft.agents[0]!.capabilities["shell"]?.enabled).toBe(false);
    // The machine, which this agent is not, opens on nothing authored.
    expect(agentStates(draft.agents[0]!)).toEqual([]);
  });
});

// A hook's event decides which of a configuration's two lists it belongs to: the run's
// own (the two session events) or the agent's (the other eight). The draft holds both,
// and both round-trips have to put every hook back where it came from — a hook that
// migrated between lists on a save/load cycle would silently change which agents a gate
// holds, which is exactly what the split exists to make explicit.
describe("a configuration's two hook lists", () => {
  const SESSION_HOOK = {
    event: "session-end" as const,
    action: { type: "command" as const, command: "./notify.sh" },
    name: "report",
  };
  const AGENT_HOOK = {
    event: "agent-stop" as const,
    action: { type: "command" as const, command: "npm run build" },
    name: "the build must pass",
  };

  it("saves the session events on the run and the rest on the agent", () => {
    const base = emptyDraft();
    const draft: GgConfigDraft = {
      ...base,
      hooks: [
        {
          id: "h-session",
          event: "session-end",
          kind: "command",
          name: "report",
          command: "./notify.sh",
          cwd: "",
          timeoutSecs: "",
          output: "",
          script: "",
          source: "",
        },
      ],
      agents: [
        {
          ...base.agents[0]!,
          hooks: [
            {
              id: "h-agent",
              event: "agent-stop",
              kind: "command",
              name: "the build must pass",
              command: "npm run build",
              cwd: "",
              timeoutSecs: "",
              output: "",
              script: "",
              source: "",
            },
          ],
        },
      ],
    };

    const set = capabilitySetFromDraft(draft, null);
    expect(set.hooks).toEqual([SESSION_HOOK]);
    expect(set.agents[0]!.hooks).toEqual([AGENT_HOOK]);
  });

  it("loads each list back into the place it was stored", () => {
    const stored: GgCapabilitySet = {
      agents: [
        {
          name: "Root",
          capabilities: [],
          modelId: "",
          hooks: [AGENT_HOOK],
        } as unknown as GgAgentConfig,
      ],
      hooks: [SESSION_HOOK],
    } as unknown as GgCapabilitySet;

    const draft = draftFromCapabilitySet(stored);
    expect(draft.hooks.map((hook) => hook.event)).toEqual(["session-end"]);
    expect(draft.agents[0]!.hooks.map((hook) => hook.event)).toEqual([
      "agent-stop",
    ]);
    // Every hook's row id is unique across the whole draft: the two lists are rendered in
    // one form, and a shared key would let React reuse a row between them.
    const ids = [
      ...draft.hooks.map((hook) => hook.id),
      ...draft.agents.flatMap((agent) => agent.hooks.map((hook) => hook.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops an agent's hooks when it is committed as a machine", () => {
    const base = emptyDraft();
    const machine: GgAgentDraft = {
      ...base.agents[0]!,
      mode: "fsm",
      hooks: [
        {
          id: "h-agent",
          event: "pre-write",
          kind: "command",
          name: "",
          command: "true",
          cwd: "",
          timeoutSecs: "",
          output: "",
          script: "",
          source: "",
        },
      ],
    };
    // A machine takes no turns: it never writes a file, so there is nothing for a
    // pre-write gate to fire around. Committing is where the earlier type's hooks stop
    // being held, exactly as its roster and prompt do.
    expect(resetAgentForMode(machine).hooks).toEqual([]);
  });
});
