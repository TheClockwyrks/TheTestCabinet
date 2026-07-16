// Harness families: the model-slug namespaces harnesses draw from. A model slug
// is only meaningful to the harnesses that speak its namespace — a Claude Code
// slug (`claude-opus-4-8`) means nothing to Codex, and an OpenRouter slug
// (`anthropic/claude-opus-4.8`) only resolves through the OpenRouter-routed
// harnesses. A curated model's slugs are each tagged with a family (see
// `ModelAlias`), which lets the run and coverage forms offer a harness only the
// slugs it can actually launch.
//
// This is the display-side mirror of the authoritative Rust logic in
// `crates/core/src/run_record.rs` (`HarnessSlug::family`, `HarnessFamily`); a
// drift test there keeps the OpenRouter arm in step with the routing predicate.
// The `HarnessFamily` union itself is generated from Rust into
// `@test-cabinet/run-record`.

import type { HarnessFamily } from "@test-cabinet/run-record";
import type { Model } from "../../client/types";

export type { HarnessFamily };

/** The harness family a harness slug belongs to — the namespace of model slugs it
 * can launch. Mirrors `HarnessSlug::family`: the three provider-native harnesses
 * are each their own family; every OpenRouter-routed harness (Cline, Goose, Kilo,
 * OpenCode, Pi) collapses into the single `openrouter` family, which is also the
 * fallback for an unrecognized slug (the broadest namespace). */
export function familyOf(harnessSlug: string): HarnessFamily {
  switch (harnessSlug) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "antigravity":
      return "antigravity";
    default:
      return "openrouter";
  }
}

/** One selectable harness family for the model-config form's slug rows. */
export interface FamilyOption {
  /** The stable value stored on an alias (`ModelAlias.harnessFamily`). */
  id: HarnessFamily;
  /** The human-facing label shown in the family dropdown. */
  displayName: string;
}

/** Every family a slug can be tagged with, in catalog order. The label names the
 * representative harness(es) so an operator recognizes which slug form belongs
 * where. */
export const FAMILIES: FamilyOption[] = [
  { id: "claude", displayName: "Claude Code" },
  { id: "codex", displayName: "Codex" },
  { id: "antigravity", displayName: "Antigravity" },
  { id: "openrouter", displayName: "Others (OpenRouter)" },
];

/** The human-facing label for a family, falling back to the raw value. */
export function familyName(family: HarnessFamily): string {
  return FAMILIES.find((f) => f.id === family)?.displayName ?? family;
}

/**
 * Reconcile a combination's model id when its harness changes to `newHarness`.
 *
 * A slug is family-specific, so switching from Claude Code to OpenCode would leave
 * a `claude-opus-4-8` id that OpenCode cannot launch. This maps the current id to
 * the equivalent slug in the new harness's family when the id names a known
 * catalog model, and returns:
 * - the id unchanged when it is already a slug in the new family;
 * - the same model's slug in the new family when the model has one;
 * - `""` (cleared) when the model has no slug for the new family — that harness
 *   cannot run it, so the operator must pick again;
 * - the id unchanged when it is free text not in the catalog (respecting a
 *   hand-typed id).
 */
export function modelForHarness(
  models: Model[],
  modelId: string,
  newHarness: string,
): string {
  if (!modelId) return modelId;
  const family = familyOf(newHarness);
  const inFamily = (m: Model) =>
    m.aliases.find((a) => a.harnessFamily === family)?.slug;
  // Already a valid slug for the new family.
  if (models.some((m) => inFamily(m) === modelId)) return modelId;
  // A known model reached under another family: remap to this family's slug.
  const owner = models.find((m) => m.aliases.some((a) => a.slug === modelId));
  if (owner) return inFamily(owner) ?? "";
  // An id the catalog doesn't know: leave the operator's text alone.
  return modelId;
}
