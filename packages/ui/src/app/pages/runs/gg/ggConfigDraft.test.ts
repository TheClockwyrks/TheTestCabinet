import { describe, expect, it } from "vitest";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import {
  bindModelSlots,
  capabilitySetFromDraft,
  draftFromCapabilitySet,
  draftSaveError,
  emptyDraft,
  launchModelSlots,
} from "./ggConfigDraft";

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
      modelSlots: [{ name: "critic", provider: "openrouter" }],
      slots: [
        { slot: "primary", modelId: "", modelSlot: "primary" },
        { slot: "reviewer", modelId: "", modelSlot: "critic" },
        { slot: "judge", modelId: "openai/o-fixed", provider: "openrouter" },
      ],
    });
    const launched = bindModelSlots(configured, {
      primary: "anthropic/claude-opus-4.8",
      critic: "anthropic/claude-haiku-4.5",
    });
    // Two roles share the `critic` slot only in intent here, but the shape is the
    // point: what runs is fully pinned, the slot's provider rides along, and the
    // internally pinned `judge` is untouched.
    expect(launched.slots).toEqual([
      { slot: "primary", modelId: "anthropic/claude-opus-4.8" },
      {
        slot: "reviewer",
        modelId: "anthropic/claude-haiku-4.5",
        provider: "openrouter",
      },
      { slot: "judge", modelId: "openai/o-fixed", provider: "openrouter" },
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
    expect(draft.modelSlots).toEqual([
      { name: "primary", defaultModelId: "", provider: "" },
    ]);
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
        { slot: "reviewer", modelId: "openai/o-fixed", provider: "openrouter" },
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
      { slot: "reviewer", modelId: "openai/o-fixed", provider: "openrouter" },
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
    // A dedicated param control holds text; the JSON escape hatch stays empty.
    expect(draft.capabilities["read-file"]?.params?.lineCap).toBe("250");
    expect(draft.capabilities["read-file"]?.paramsText).toBe("");

    const back = capabilitySetFromDraft(draft, null);
    const readFile = back.capabilities.find((cap) => cap.id === "read-file");
    expect(readFile?.implementation).toBe("hard-cap");
    expect(readFile?.params).toEqual({ lineCap: 250 });
  });
});
