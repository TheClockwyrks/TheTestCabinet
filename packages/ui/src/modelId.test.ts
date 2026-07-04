import { describe, expect, it } from "vitest";
import { canonicalModelId } from "./modelId";

describe("canonicalModelId", () => {
  it("strips the OpenCode / Kilo Code `openrouter/` routing prefix", () => {
    expect(canonicalModelId("openrouter/anthropic/claude-opus-4.8")).toBe(
      "anthropic/claude-opus-4.8",
    );
  });

  it("leaves a bare OpenRouter slug unchanged", () => {
    expect(canonicalModelId("anthropic/claude-opus-4.8")).toBe(
      "anthropic/claude-opus-4.8",
    );
  });

  it("leaves a provider-native id (Claude Code's dashed form) unchanged", () => {
    expect(canonicalModelId("claude-opus-4-8")).toBe("claude-opus-4-8");
  });

  it("collapses the prefixed and bare forms onto the same canonical id", () => {
    expect(canonicalModelId("openrouter/anthropic/claude-opus-4.8")).toBe(
      canonicalModelId("anthropic/claude-opus-4.8"),
    );
  });

  it("only strips a leading prefix, not an `openrouter/` appearing later", () => {
    expect(canonicalModelId("anthropic/openrouter/thing")).toBe(
      "anthropic/openrouter/thing",
    );
  });
});
