import { describe, expect, it } from "vitest";
import { armLabel, type ArmDraft } from "./armDraft";

function draft(overrides: Partial<ArmDraft> = {}): ArmDraft {
  return {
    id: "arm-1",
    kind: "harness",
    label: "",
    harness: "pi",
    modelId: "",
    ggConfig: "",
    slotModels: {},
    runIds: [],
    ...overrides,
  };
}

const ggName = (key: string) =>
  key === "builtin:default" ? "Default" : "Config A";

describe("armLabel", () => {
  it("names a harness arm by its harness display name and model", () => {
    expect(
      armLabel(draft({ harness: "pi", modelId: "claude-opus-4-8" }), ggName),
    ).toBe("Pi · claude-opus-4-8");
  });

  it("falls back to the harness alone before a model is picked", () => {
    expect(armLabel(draft({ harness: "pi" }), ggName)).toBe("Pi");
  });

  it("names a gg arm by its configuration and its primary slot's model", () => {
    expect(
      armLabel(
        draft({
          kind: "gg",
          ggConfig: "saved:1",
          slotModels: {
            primary: "anthropic/claude-opus-4.8",
            reviewer: "openai/gpt-5",
          },
        }),
        ggName,
      ),
    ).toBe("Config A · anthropic/claude-opus-4.8");
  });

  it("falls back to the first bound slot when the configuration has no primary", () => {
    expect(
      armLabel(
        draft({
          kind: "gg",
          ggConfig: "builtin:default",
          slotModels: { reviewer: "openai/gpt-5" },
        }),
        ggName,
      ),
    ).toBe("Default · openai/gpt-5");
  });

  it("distinguishes two arms that share a harness but differ in model", () => {
    const a = armLabel(draft({ modelId: "claude-opus-4-8" }), ggName);
    const b = armLabel(draft({ id: "arm-2", modelId: "gpt-5" }), ggName);
    expect(a).not.toBe(b);
  });
});
