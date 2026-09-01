import { describe, expect, it } from "vitest";
import {
  comboDetail,
  comboLabel,
  comboModels,
  ggBoundModels,
  ggConfigLabel,
  isGgCombo,
} from "./comboLabels";

const OPUS = "anthropic/claude-opus-4.8";
const HAIKU = "anthropic/claude-haiku-4.5";

const harness = {
  harness: "claude",
  model: "claude-opus-4-8",
  provider: "anthropic",
};

const gg = {
  harness: "gg",
  model: OPUS,
  ggConfigId: "saved:cfg-1",
  ggConfigName: "Nightly",
  ggSlotModels: { primary: OPUS, critic: HAIKU },
};

// A harness label is load-bearing history: the matrix, the ladder board and the plan
// dashboard have all read `harness · model` since before gg was plannable, and nothing
// about adding a second shape is a reason to re-word the first.
describe("harness combinations", () => {
  it("reads as harness and model, with the provider only where two members differ by it", () => {
    expect(comboLabel(harness)).toBe("claude · claude-opus-4-8");
    expect(comboDetail(harness)).toBe("claude-opus-4-8 · anthropic");
    expect(comboDetail({ ...harness, provider: null })).toBe("claude-opus-4-8");
  });

  it("is never mistaken for a gg combination", () => {
    expect(isGgCombo(harness)).toBe(false);
    expect(comboModels(harness)).toBe("claude-opus-4-8");
  });
});

// A gg combination is identified by its configuration and by every model that
// configuration binds — two members agreeing on the root model and differing on a
// reviewer's are two arms of a study, so a label that showed only the root would name
// them both the same thing.
describe("gg combinations", () => {
  it("reads as the configuration and every model it binds", () => {
    expect(isGgCombo(gg)).toBe(true);
    expect(comboLabel(gg)).toBe(`Nightly · ${HAIKU}, ${OPUS}`);
    // Inside a group already headed "gg" the configuration is still the thing the
    // reviewer chose, so the pill keeps it.
    expect(comboDetail(gg)).toBe(comboLabel(gg));
  });

  it("orders and de-duplicates the bound models, so two maps of one binding agree", () => {
    const same = {
      ...gg,
      ggSlotModels: { critic: HAIKU, primary: OPUS, merge: OPUS },
    };
    expect(ggBoundModels(same)).toEqual([HAIKU, OPUS]);
    expect(comboLabel(same)).toBe(comboLabel(gg));
  });

  it("falls back to the root model when the configuration pins every model itself", () => {
    expect(comboLabel({ ...gg, ggSlotModels: {} })).toBe(`Nightly · ${OPUS}`);
  });

  it("stays identifiable when the configuration it names is gone", () => {
    const deleted = { ...gg, ggConfigName: null };
    expect(ggConfigLabel(deleted)).toBe("cfg-1");
    expect(comboLabel(deleted)).toBe(`cfg-1 · ${HAIKU}, ${OPUS}`);
  });

  it("is decided by the configuration it names, not by the harness slug", () => {
    // A member the console has just built has not been through the server's
    // normalization yet, and must still label as gg.
    expect(isGgCombo({ harness: "", model: "", ggConfigId: "cfg-1" })).toBe(
      true,
    );
  });
});
