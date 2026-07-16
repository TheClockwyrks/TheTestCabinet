import { describe, expect, it } from "vitest";
import type { Model, ModelAlias } from "../../client/types";
import { FAMILIES, familyName, familyOf, modelForHarness } from "./families";

// A minimal catalog model carrying only the fields the family logic reads.
function model(name: string, aliases: ModelAlias[]): Model {
  return {
    slug: name,
    name,
    provider: "",
    curated: true,
    openrouterUrl: null,
    description: null,
    logoSvg: null,
    coveredModelIds: [],
    aliases,
    price: null,
    priceHistory: [],
    contextLength: null,
    releasedAt: null,
  };
}

describe("familyOf", () => {
  it("maps the native harnesses to their own families", () => {
    expect(familyOf("claude")).toBe("claude");
    expect(familyOf("codex")).toBe("codex");
    expect(familyOf("antigravity")).toBe("antigravity");
  });

  it("collapses every OpenRouter-routed harness (and unknowns) into openrouter", () => {
    for (const slug of ["cline", "goose", "kilo", "opencode", "pi"]) {
      expect(familyOf(slug)).toBe("openrouter");
    }
    expect(familyOf("some-future-harness")).toBe("openrouter");
  });

  it("covers every family with a display label", () => {
    // Guards against a family gaining a value with no label.
    for (const f of FAMILIES) {
      expect(familyName(f.id)).toBe(f.displayName);
    }
    expect(familyName("openrouter")).toBe("Others (OpenRouter)");
  });
});

describe("modelForHarness", () => {
  // Opus is registered under both a Claude Code slug and an OpenRouter slug.
  const opus = model("Claude Opus 4.8", [
    { slug: "claude-opus-4-8", harnessFamily: "claude" },
    { slug: "anthropic/claude-opus-4.8", harnessFamily: "openrouter" },
  ]);
  // DeepSeek exists only under OpenRouter.
  const deepseek = model("DeepSeek V4", [
    { slug: "deepseek/deepseek-v4", harnessFamily: "openrouter" },
  ]);
  const catalog = [opus, deepseek];

  it("leaves an id already valid for the new family unchanged", () => {
    expect(modelForHarness(catalog, "claude-opus-4-8", "claude")).toBe(
      "claude-opus-4-8",
    );
  });

  it("remaps a known model to the new family's slug", () => {
    // Claude Code → OpenCode: the OpenRouter slug for the same model.
    expect(modelForHarness(catalog, "claude-opus-4-8", "opencode")).toBe(
      "anthropic/claude-opus-4.8",
    );
    // OpenCode → Claude Code: back to the native slug.
    expect(modelForHarness(catalog, "anthropic/claude-opus-4.8", "claude")).toBe(
      "claude-opus-4-8",
    );
  });

  it("clears a known model that has no slug for the new family", () => {
    // DeepSeek can't run under Claude Code — the operator must pick again.
    expect(modelForHarness(catalog, "deepseek/deepseek-v4", "claude")).toBe("");
  });

  it("leaves an unknown, hand-typed id alone", () => {
    expect(modelForHarness(catalog, "my/custom-model", "claude")).toBe(
      "my/custom-model",
    );
  });

  it("keeps an empty selection empty", () => {
    expect(modelForHarness(catalog, "", "opencode")).toBe("");
  });
});
