import { describe, expect, it } from "vitest";
import type {
  GgAgentConfig,
  GgCapabilityConfig,
  GgCapabilitySet,
} from "@test-cabinet/run-record/gg";
import { DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE } from "@test-cabinet/run-record/gg-system-prompt";
import {
  bindModelSlots,
  blankAgentDraft,
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  launchModelSlots,
  runLimitsWarning,
  type GgAgentDraft,
  type GgConfigDraft,
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
    expect(draftSaveError(draft)).toContain("no implementer");

    // A spawnable-only roster entry is not an implementer, so it does not satisfy it.
    const rootId = draft.agents[0]!.id;
    draft.agents[0]!.subagents = [
      { agentId: rootId, description: "", scopes: ["subagent"] },
    ];
    expect(draftSaveError(draft)).toContain("no implementer");

    // Read-only board access (no `create_issue`) needs no roster at all.
    draft.agents[0]!.subagents = [];
    draft.agents[0]!.disabledTools = ["create_epic", "create_issue"];
    expect(draftSaveError(draft)).toBeNull();

    // And so does a filer with an implementer — a profile may list itself.
    draft.agents[0]!.disabledTools = [];
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

// --- Completion ------------------------------------------------------------------

const COMPLETION = "completion";

function completionCap(s: GgCapabilitySet): GgCapabilityConfig | undefined {
  return setCaps(s).find((cap) => cap.id === COMPLETION);
}

describe("gg completion", () => {
  it("round-trips the completion signal", () => {
    const configured = capSet([
      {
        id: COMPLETION,
        enabled: true,
        implementation: "explicit-call",
        params: {},
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)[COMPLETION]?.implementation).toBe("explicit-call");
    expect(
      completionCap(capabilitySetFromDraft(draft, null))?.implementation,
    ).toBe("explicit-call");
  });

  // A code-mode agent can only ever end through its program's `finish`, so gg ignores a
  // plain-text signal on one. The editor writes the signal gg will actually use rather
  // than the stale selection, so a stored configuration is never a lie about the run.
  it("fixes the signal to the explicit call on a responses-as-code agent", () => {
    const configured = capSet([
      { id: CODE, enabled: true, params: {} },
      {
        id: COMPLETION,
        enabled: true,
        implementation: "plain-text",
        params: {},
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(
      completionCap(capabilitySetFromDraft(draft, null))?.implementation,
    ).toBe("explicit-call");

    // Switching code mode off hands the choice back — the operator's own selection was
    // kept in the draft throughout, so nothing was lost to the lock.
    draft.agents[0]!.capabilities[CODE] = {
      ...draft.agents[0]!.capabilities[CODE]!,
      enabled: false,
    };
    expect(
      completionCap(capabilitySetFromDraft(draft, null))?.implementation,
    ).toBe("plain-text");
  });

  it("round-trips validation commands, including a bare-string shorthand", () => {
    const configured = capSet([
      {
        id: COMPLETION,
        enabled: true,
        params: {
          validation: [
            "npm run build",
            { command: "npm test", cwd: "game", timeoutSecs: 900 },
          ],
        },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(
      JSON.parse(draftCaps(draft)[COMPLETION]?.params?.validation ?? "[]"),
    ).toEqual([
      { command: "npm run build", cwd: "", timeoutSecs: "" },
      { command: "npm test", cwd: "game", timeoutSecs: "900" },
    ]);
    // The shorthand normalizes to the object form on the way out; gg reads both.
    expect(completionCap(capabilitySetFromDraft(draft, null))?.params).toEqual({
      validation: [
        { command: "npm run build" },
        { command: "npm test", cwd: "game", timeoutSecs: 900 },
      ],
    });
  });

  it("drops a half-typed command row rather than writing an empty gate", () => {
    const draft = emptyDraft();
    draft.agents[0]!.capabilities[COMPLETION] = {
      enabled: true,
      implementation: "",
      params: {
        validation: JSON.stringify([
          { command: "  ", cwd: "game", timeoutSecs: "" },
        ]),
      },
      extraParams: {},
    };
    expect(completionCap(capabilitySetFromDraft(draft, null))?.params).toEqual(
      {},
    );
  });

  it("preserves a validation entry the rows cannot represent", () => {
    const configured = capSet([
      {
        id: COMPLETION,
        enabled: true,
        params: { validation: [{ command: "npm test", futureKnob: 3 }] },
      },
    ]);
    const draft = draftFromCapabilitySet(configured);
    expect(draftCaps(draft)[COMPLETION]?.params?.validation).toBeUndefined();
    expect(completionCap(capabilitySetFromDraft(draft, null))?.params).toEqual({
      validation: [{ command: "npm test", futureKnob: 3 }],
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
