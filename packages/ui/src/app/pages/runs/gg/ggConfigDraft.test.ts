import { describe, expect, it } from "vitest";
import type {
  GgAgentConfig,
  GgCapabilityConfig,
  GgCapabilitySet,
} from "@test-cabinet/run-record/gg";
import { DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE } from "@test-cabinet/run-record/gg-system-prompt";
import {
  bindModelSlots,
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  launchModelSlots,
  runLimitsWarning,
} from "./ggConfigDraft";
import {
  DEFAULT_ERROR_RATE_WINDOW,
  DEFAULT_MAX_CONSECUTIVE_ERRORS,
  DEFAULT_MAX_ERROR_RATE,
  RUN_LIMIT_SPECS,
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
    draft.agents[0]!.modelSlot = "nope";
    expect(draftSaveError(draft)).toContain("nope");
  });
});

describe("gg agents", () => {
  it("round-trips a multi-agent configuration with a subagent allowlist", () => {
    const configured = set({
      modelSlots: [{ name: "primary" }],
      agents: [
        agent({
          modelSlot: "primary",
          subagents: [{ agent: "reviewer", description: "for hard reviews" }],
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
      { agent: "reviewer", description: "for hard reviews" },
    ]);
  });

  it("round-trips a custom prompt and a full template override", () => {
    const configured = set({
      agents: [
        agent({
          modelSlot: "primary",
          customInstructions: "Prefer TDD.",
          systemPromptTemplate: "You are a custom agent. {{customInstructions}}",
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
    draft.agents[0]!.systemPromptTemplate = DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE + "\nextra";
    expect(
      capabilitySetFromDraft(draft, null).agents[0]!.systemPromptTemplate,
    ).toContain("extra");
  });

  it("refuses structural agent errors", () => {
    const draft = emptyDraft();
    draft.agents.push(agentDraft("reviewer"));
    expect(draftSaveError(draft)).toBeNull();

    // Duplicate names.
    draft.agents[1]!.name = "Root";
    expect(draftSaveError(draft)).toContain("unique");
    draft.agents[1]!.name = "reviewer";

    // A subagent pointing at an agent that does not exist.
    draft.agents[0]!.subagents = [{ agent: "ghost", description: "" }];
    expect(draftSaveError(draft)).toContain("ghost");
    draft.agents[0]!.subagents = [{ agent: "reviewer", description: "" }];
    expect(draftSaveError(draft)).toBeNull();

    // The first agent must be the Root.
    draft.agents[0]!.name = "notroot";
    expect(draftSaveError(draft)).toContain("Root");
  });

  // An issue names the agent it is dispatched to, drawn from the filer's own subagents,
  // so a board agent that spawns nothing could never file a valid one. gg refuses such a
  // set at launch; the editor refuses it while it can still be fixed.
  it("refuses an issue filer with nobody to assign issues to", () => {
    const draft = emptyDraft();
    draft.agents[0]!.capabilities["project-management"] = {
      enabled: true,
      params: {},
    };
    expect(draftSaveError(draft)).toContain("no subagents");

    // Read-only board access (no `create_issue`) needs no subagents at all.
    draft.agents[0]!.disabledTools = ["create_epic", "create_issue"];
    expect(draftSaveError(draft)).toBeNull();

    // And so does a filer that can spawn something — a profile may list itself.
    draft.agents[0]!.disabledTools = [];
    draft.agents[0]!.subagents = [{ agent: "Root", description: "" }];
    expect(draftSaveError(draft)).toBeNull();
  });
});

// A minimal agent draft for tests that push a second agent onto an existing draft.
function agentDraft(name: string) {
  const base = emptyDraft().agents[0]!;
  return { ...base, name, subagents: [] };
}

describe("gg filesystem capabilities", () => {
  it("expands a legacy `filesystem` capability into the per-tool ones", () => {
    const legacy = capSet([
      { id: "shell", enabled: true, params: {} },
      { id: "filesystem", enabled: true, params: {} },
    ]);
    const draft = draftFromCapabilitySet(legacy);

    for (const id of ["read-file", "write-file", "edit-file", "list-dir"]) {
      expect(draftCaps(draft)[id]?.enabled, id).toBe(true);
    }
    expect(draftCaps(draft)["read-file"]?.implementation).toBe("");

    const saved = capabilitySetFromDraft(draft, null);
    const ids = setCaps(saved).map((cap) => cap.id);
    expect(ids).toContain("read-file");
    expect(ids).not.toContain("filesystem");
  });

  it("carries a disabled legacy capability through as four off rows", () => {
    const legacy = capSet([{ id: "filesystem", enabled: false, params: {} }]);
    const draft = draftFromCapabilitySet(legacy);
    for (const id of ["read-file", "write-file", "edit-file", "list-dir"]) {
      expect(draftCaps(draft)[id]?.enabled, id).toBe(false);
    }
  });

  it("lets an explicit per-tool capability override the legacy umbrella", () => {
    const mixed = capSet([
      { id: "filesystem", enabled: true, params: {} },
      { id: "edit-file", enabled: false, params: {} },
    ]);
    const draft = draftFromCapabilitySet(mixed);
    expect(draftCaps(draft)["edit-file"]?.enabled).toBe(false);
    expect(draftCaps(draft)["read-file"]?.enabled).toBe(true);
  });

  it("round-trips a capped read mode and its line cap", () => {
    const configured = capSet([
      {
        id: "read-file",
        enabled: true,
        implementation: "hard-cap",
        params: { lineCap: 250 },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)["read-file"]?.implementation).toBe("hard-cap");
    expect(draftCaps(draft)["read-file"]?.params?.lineCap).toBe("250");
    expect(draftCaps(draft)["read-file"]?.extraParams).toEqual({});

    const back = capabilitySetFromDraft(draft, null);
    const readFile = setCaps(back).find((cap) => cap.id === "read-file");
    expect(readFile?.implementation).toBe("hard-cap");
    expect(readFile?.params).toEqual({ lineCap: 250 });
  });
});

// The `responses-as-code` capability's `healing` param: a `toggles` control whose
// members are on unless switched off, so only the off ones are ever written.
const CODE = "responses-as-code";

function healingOf(s: GgCapabilitySet): unknown {
  return setCaps(s).find((cap) => cap.id === CODE)?.params?.healing;
}

describe("gg response-healing toggles", () => {
  it("writes nothing when every strategy is left on", () => {
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
        params: { healing: { "strip-prose": false } },
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
      { id: CODE, enabled: true, params: { healing: false } },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      "strip-fences": false,
      "strip-prose": false,
      "drop-duplicate-program": false,
      "drop-imports": false,
      "unwrap-async": false,
      "strip-comment-only": false,
    });
  });

  it("preserves a value the control cannot represent in the passthrough", () => {
    const configured = capSet([
      {
        id: CODE,
        enabled: true,
        params: { healing: { stripProse: false } },
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
        { id: "project-management", enabled: true, params: { reviewers: true } },
      ]),
    );
    expect(draftCaps(on)["project-management"]?.params?.reviewers).toBe("true");
    expect(paramsOf(capabilitySetFromDraft(on, null), "project-management"))
      .toHaveProperty("reviewers", true);

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
  it("seeds gg's default error ceilings into a fresh form, and leaves turns unbounded", () => {
    expect(capabilitySetFromDraft(emptyDraft(), null).limits).toEqual({
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

  it("refuses to save half an error-rate ceiling", () => {
    const draft = emptyDraft();
    // Clear the seeded default window so only the rate is set — the half-declared case.
    draft.limits.errorRateWindow = "";
    draft.limits.maxErrorRate = "0.5";
    expect(draftSaveError(draft)).toContain("both a rate and a window");
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
