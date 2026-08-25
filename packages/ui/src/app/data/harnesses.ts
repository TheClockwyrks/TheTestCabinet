// The agent harnesses the application can drive. This is a fixed, code-defined
// catalog — the set of supported harnesses is part of the product, not something
// the backend serves or that depends on which container images happen to be
// published. It mirrors the core's canonical `HarnessSlug` list (and the desktop
// shell's `HarnessSlug::ALL`), in the same order, so the gallery never drifts
// from it. The runner resolves each harness's container image from its own
// registry configuration (see docs/components/core/execution.md); the backend
// plays no part in container distribution.

/** One supported agent harness. */
export interface HarnessSummary {
  /** The stable slug, matching run records and the core `HarnessSlug`. */
  slug: string;
  /** The human-facing name shown in the run-configuration picker. */
  displayName: string;
}

/** Every supported harness, in catalog order. */
export const harnesses: HarnessSummary[] = [
  { slug: "claude", displayName: "Anthropic Claude Code" },
  { slug: "codex", displayName: "OpenAI Codex" },
  { slug: "cline", displayName: "Cline" },
  { slug: "antigravity", displayName: "Google Antigravity" },
  { slug: "goose", displayName: "Goose" },
  { slug: "kilo", displayName: "Kilo Code" },
  { slug: "opencode", displayName: "OpenCode" },
  { slug: "pi", displayName: "Pi" },
];

/**
 * The first-party gg run mode's identity in run records. gg is deliberately
 * **not** in {@link harnesses} — the core excludes it from `HarnessSlug::ALL`
 * for the same reason: it is not a third-party CLI a launch surface offers as a
 * harness row, it is chosen as a run mode and configured through a gg
 * configuration. But every run it conducts records `harnessSlug: "gg"`, so the
 * surfaces that read or filter *recorded* runs must know it.
 */
export const GG_HARNESS: HarnessSummary = { slug: "gg", displayName: "gg" };

/**
 * Every harness a recorded run can name — the launchable CLI catalog plus the
 * first-party gg run mode. Filter controls over recorded runs offer this list;
 * launch and planning pickers keep using {@link harnesses}, since a gg run is
 * launched through its configuration rather than as a bare harness.
 */
export const recordedHarnesses: HarnessSummary[] = [...harnesses, GG_HARNESS];
