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

  it("binds the mock model to its own provider", () => {
    const launched = bindModelSlots(
      set({ slots: [{ slot: "primary", modelId: "", modelSlot: "primary" }] }),
      { primary: "mock/scripted-builder" },
    );
    expect(launched.slots[0]).toEqual({
      slot: "primary",
      modelId: "mock/scripted-builder",
      provider: "mock",
    });
  });

  it("keeps a configuration saved before model slots existed launchable", () => {
    // The old shape: nothing bound at all, the launch form supplying the one model.
    const legacy = set({ preset: "minimal", slots: [] });
    expect(launchModelSlots(legacy)).toEqual([{ name: "primary" }]);
    expect(bindModelSlots(legacy, { primary: "openai/gpt-5.6-sol" }).slots).toEqual(
      [{ slot: "primary", modelId: "openai/gpt-5.6-sol" }],
    );
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
    draft.slots = [
      { ...draft.slots[0]!, modelSlot: "nope" },
    ];
    expect(draftSaveError(draft)).toContain("nope");
  });
});
