import { describe, expect, it } from "vitest";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import {
  bindModelSlots,
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  launchModelSlots,
  runLimitsWarning,
} from "./ggConfigDraft";
import { DEFAULT_MAX_TURNS, RUN_LIMIT_SPECS } from "./ggCatalog";

// A capability set as the wire carries it, with only the fields these assertions
// care about (the capability list is irrelevant to slot resolution).
function set(partial: Partial<GgCapabilitySet>): GgCapabilitySet {
  return { capabilities: [], slots: [], ...partial };
}

describe("gg model slots", () => {
  it("asks only for the slots a role actually defers to", () => {
    const configured = set({
      modelSlots: [
        { name: "primary" },
        { name: "critic", defaultModelId: "anthropic/claude-haiku-4.5" },
        // Declared but consumed by nothing — asking for it would change nothing.
        { name: "orphan" },
      ],
      slots: [
        { slot: "primary", modelId: "", modelSlot: "primary" },
        { slot: "reviewer", modelId: "", modelSlot: "critic" },
        { slot: "judge", modelId: "openai/o-fixed" },
      ],
    });
    expect(launchModelSlots(configured)).toEqual([
      { name: "primary" },
      { name: "critic", defaultModelId: "anthropic/claude-haiku-4.5" },
    ]);
  });

  it("resolves every deferred role and drops the declarations", () => {
    const configured = set({
      preset: "critic-sweep",
      modelSlots: [{ name: "critic" }],
      slots: [
        { slot: "primary", modelId: "", modelSlot: "primary" },
        { slot: "reviewer", modelId: "", modelSlot: "critic" },
        { slot: "judge", modelId: "openai/o-fixed" },
      ],
    });
    const launched = bindModelSlots(configured, {
      primary: "anthropic/claude-opus-4.8",
      critic: "anthropic/claude-haiku-4.5",
    });
    // Two roles share the `critic` slot only in intent here, but the shape is the
    // point: what runs is fully pinned, and the internally pinned `judge` is
    // untouched.
    expect(launched.slots).toEqual([
      { slot: "primary", modelId: "anthropic/claude-opus-4.8" },
      {
        slot: "reviewer",
        modelId: "anthropic/claude-haiku-4.5",
      },
      { slot: "judge", modelId: "openai/o-fixed" },
    ]);
    expect(launched.modelSlots).toBeUndefined();
    expect(launched.preset).toBe("critic-sweep");
  });

  it("keeps a configuration saved before model slots existed launchable", () => {
    // The old shape: nothing bound at all, the launch form supplying the one model.
    const legacy = set({ preset: "minimal", slots: [] });
    expect(launchModelSlots(legacy)).toEqual([{ name: "primary" }]);
    expect(
      bindModelSlots(legacy, { primary: "openai/gpt-5.6-sol" }).slots,
    ).toEqual([{ slot: "primary", modelId: "openai/gpt-5.6-sol" }]);
    // Opening it in the editor reads as the new shape rather than a broken binding.
    const draft = draftFromCapabilitySet(legacy);
    expect(draft.modelSlots).toEqual([{ name: "primary", defaultModelId: "" }]);
    expect(draft.slots[0]).toMatchObject({
      slot: "primary",
      source: "model-slot",
      modelSlot: "primary",
    });
  });

  it("round-trips a declared slot through the editor draft", () => {
    const configured = set({
      modelSlots: [{ name: "critic", defaultModelId: "anthropic/haiku" }],
      slots: [
        { slot: "primary", modelId: "", modelSlot: "critic" },
        { slot: "reviewer", modelId: "openai/o-fixed" },
      ],
    });
    const back = capabilitySetFromDraft(
      draftFromCapabilitySet(configured),
      null,
    );
    expect(back.modelSlots).toEqual([
      { name: "critic", defaultModelId: "anthropic/haiku" },
    ]);
    expect(back.slots).toEqual([
      { slot: "primary", modelId: "", modelSlot: "critic" },
      { slot: "reviewer", modelId: "openai/o-fixed" },
    ]);
  });

  it("refuses to save a role bound to a slot that was never declared", () => {
    const draft = emptyDraft();
    expect(draftSaveError(draft)).toBeNull();
    draft.slots = [{ ...draft.slots[0]!, modelSlot: "nope" }];
    expect(draftSaveError(draft)).toContain("nope");
  });
});

describe("gg filesystem capabilities", () => {
  it("expands a legacy `filesystem` capability into the per-tool ones", () => {
    const legacy = set({
      capabilities: [
        { id: "shell", enabled: true, params: {} },
        { id: "filesystem", enabled: true, params: {} },
      ],
    });
    const draft = draftFromCapabilitySet(legacy);

    for (const id of ["read-file", "write-file", "edit-file", "list-dir"]) {
      expect(draft.capabilities[id]?.enabled, id).toBe(true);
    }
    // The expansion carries no per-tool configuration: an umbrella configured none,
    // so `read_file` keeps its default (unlimited) read mode.
    expect(draft.capabilities["read-file"]?.implementation).toBe("");

    // Saving the reopened configuration writes the modern ids and drops the umbrella.
    const saved = capabilitySetFromDraft(draft, null);
    const ids = saved.capabilities.map((cap) => cap.id);
    expect(ids).toContain("read-file");
    expect(ids).not.toContain("filesystem");
  });

  it("carries a disabled legacy capability through as four off rows", () => {
    const legacy = set({
      capabilities: [{ id: "filesystem", enabled: false, params: {} }],
    });
    const draft = draftFromCapabilitySet(legacy);
    for (const id of ["read-file", "write-file", "edit-file", "list-dir"]) {
      expect(draft.capabilities[id]?.enabled, id).toBe(false);
    }
  });

  it("lets an explicit per-tool capability override the legacy umbrella", () => {
    const mixed = set({
      capabilities: [
        { id: "filesystem", enabled: true, params: {} },
        { id: "edit-file", enabled: false, params: {} },
      ],
    });
    const draft = draftFromCapabilitySet(mixed);
    expect(draft.capabilities["edit-file"]?.enabled).toBe(false);
    expect(draft.capabilities["read-file"]?.enabled).toBe(true);
  });

  it("round-trips a capped read mode and its line cap", () => {
    const configured = set({
      capabilities: [
        {
          id: "read-file",
          enabled: true,
          implementation: "hard-cap",
          params: { lineCap: 250 },
        },
      ],
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.capabilities["read-file"]?.implementation).toBe("hard-cap");
    // A dedicated param control holds text; nothing spills into the passthrough.
    expect(draft.capabilities["read-file"]?.params?.lineCap).toBe("250");
    expect(draft.capabilities["read-file"]?.extraParams).toEqual({});

    const back = capabilitySetFromDraft(draft, null);
    const readFile = back.capabilities.find((cap) => cap.id === "read-file");
    expect(readFile?.implementation).toBe("hard-cap");
    expect(readFile?.params).toEqual({ lineCap: 250 });
  });
});

// The `responses-as-code` capability's `healing` param: a `toggles` control whose
// members are on unless switched off, so only the off ones are ever written.
const CODE = "responses-as-code";

function healingOf(set: GgCapabilitySet): unknown {
  return set.capabilities.find((cap) => cap.id === CODE)?.params?.healing;
}

describe("gg response-healing toggles", () => {
  it("writes nothing when every strategy is left on", () => {
    const draft = emptyDraft();
    draft.capabilities[CODE] = {
      ...draft.capabilities[CODE]!,
      enabled: true,
    };
    // The default arm of the ablation is an absent key, not five explicit `true`s.
    expect(healingOf(capabilitySetFromDraft(draft, null))).toBeUndefined();
  });

  it("round-trips the strategies a configuration switches off", () => {
    const configured = set({
      capabilities: [
        {
          id: CODE,
          enabled: true,
          params: { healing: { "strip-prose": false } },
        },
      ],
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.capabilities[CODE]?.params?.healing).toBe("strip-prose");
    // Nothing spills into the passthrough, which is what would make the toggles and
    // a stray raw param fight over the same key on the way back.
    expect(draft.capabilities[CODE]?.extraParams).toEqual({});
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      "strip-prose": false,
    });
  });

  it("reads the `false` master switch as every strategy off", () => {
    const configured = set({
      capabilities: [{ id: CODE, enabled: true, params: { healing: false } }],
    });
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
    // gg reports `stripProse` as an unknown healing key and runs every strategy;
    // silently rewriting it as "strip-prose off" would run the other arm of the
    // ablation under this configuration's name.
    const configured = set({
      capabilities: [
        {
          id: CODE,
          enabled: true,
          params: { healing: { stripProse: false } },
        },
      ],
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.capabilities[CODE]?.params?.healing).toBeUndefined();
    expect(draft.capabilities[CODE]?.extraParams).toEqual({
      healing: { stripProse: false },
    });
    expect(healingOf(capabilitySetFromDraft(draft, null))).toEqual({
      stripProse: false,
    });
  });
});

// Every param gg reads now has a dedicated control (no raw-JSON field), so a stored
// value routes to its control on the way in and is written back typed — and a param
// no control covers is preserved verbatim rather than dropped.
describe("gg capability params", () => {
  function paramsOf(s: GgCapabilitySet, id: string): Record<string, unknown> {
    return (s.capabilities.find((cap) => cap.id === id)?.params ??
      {}) as Record<string, unknown>;
  }

  it("round-trips the numeric caps that used to need hand-edited JSON", () => {
    const configured = set({
      capabilities: [
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
      ],
    });
    const draft = draftFromCapabilitySet(configured);
    // Each stored value lands in its dedicated control (as text) with an empty
    // passthrough — nothing is left reachable only through raw JSON.
    expect(draft.capabilities.tasks?.params?.maxTasks).toBe("40");
    expect(draft.capabilities.tasks?.extraParams).toEqual({});
    expect(draft.capabilities.memories?.params?.maxLenPerMemory).toBe("1500");

    const back = capabilitySetFromDraft(draft, null);
    expect(paramsOf(back, "tasks")).toEqual({ maxTasks: 40 });
    expect(paramsOf(back, "memories")).toEqual({
      maxCount: 5,
      maxLenPerMemory: 1500,
      maxTotalLen: 6000,
    });
    expect(paramsOf(back, "project-management")).toEqual({
      maxEpics: 20,
      maxIssues: 80,
    });
  });

  it("round-trips a string param through its text control", () => {
    const configured = set({
      capabilities: [
        { id: "skills", enabled: true, params: { dir: "docs/skills" } },
      ],
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.capabilities.skills?.params?.dir).toBe("docs/skills");
    expect(paramsOf(capabilitySetFromDraft(draft, null), "skills")).toEqual({
      dir: "docs/skills",
    });
  });

  it("preserves a param no control covers through a round-trip", () => {
    // A key a newer client wrote (or a legacy one) has no dedicated control here.
    // Dropping it on resave would silently change what the configuration means, so
    // it is carried verbatim in the passthrough and re-emitted untouched.
    const configured = set({
      capabilities: [
        { id: "tasks", enabled: true, params: { maxTasks: 10, futureKnob: 3 } },
      ],
    });
    const draft = draftFromCapabilitySet(configured);
    expect(draft.capabilities.tasks?.params?.maxTasks).toBe("10");
    expect(draft.capabilities.tasks?.extraParams).toEqual({ futureKnob: 3 });
    expect(paramsOf(capabilitySetFromDraft(draft, null), "tasks")).toEqual({
      maxTasks: 10,
      futureKnob: 3,
    });
  });
});

describe("gg run limits", () => {
  it("seeds gg's default turn ceiling into a fresh form, and no other ceiling", () => {
    // A fresh configuration now shows gg's real defaults rather than empty boxes, so
    // the one ceiling that has a default — the turn ceiling — is emitted at it, while
    // every other ceiling stays off until set. (Seeding 50 documents the default; gg
    // uses it anyway, so no measurement changes.)
    expect(capabilitySetFromDraft(emptyDraft(), null).limits).toEqual({
      maxTurns: DEFAULT_MAX_TURNS,
    });
    // And every declared ceiling has a control, so none of them can only be set by
    // hand-editing the stored JSON.
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
    // Legal, and saved as written — it just cannot stop a run any earlier than the
    // turn ceiling already would.
    expect(draftSaveError(draft)).toBeNull();
    expect(runLimitsWarning(draft.limits)).toContain("(8)");
    draft.limits.errorRateWindow = "4";
    expect(runLimitsWarning(draft.limits)).toBeNull();
  });

  it("measures the window against gg's default when no turn ceiling is set", () => {
    const draft = emptyDraft();
    draft.limits.maxErrorRate = "0.5";
    draft.limits.errorRateWindow = "50";
    expect(runLimitsWarning(draft.limits)).toContain("(50)");
  });
});
