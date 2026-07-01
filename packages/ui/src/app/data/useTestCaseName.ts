import { formatSlug } from "../format";
import { useTestCases } from "./useTestCases";

// Test cases that were renamed on disk from their original inspired-by slug to
// match their Test Cabinet name (e.g. `pong` -> `carom`). A run recorded under
// the OLD slug — a historical or already-published run — can no longer be found
// in the catalog by that slug, so `resolveTestCaseName` falls back to this map to
// still show the current Test Cabinet name instead of a title-cased old slug.
const RENAMED_SLUG_NAMES: Readonly<Record<string, string>> = {
  "adversarial-pacman": "Foray",
  "desktop-td": "Meltdown",
  galaga: "Spectra",
  klondike: "Cascade",
  pacman: "Fathom",
  "performance-factorio": "Lattice",
  pong: "Carom",
  snake: "Coil",
};

// Resolve a test case's Test Cabinet display name from its slug. The catalog is
// the source of truth: it carries the case's real `name` (e.g. `foray-jelly` ->
// "Foray Royal Jelly"), which a title-cased slug cannot reproduce for abbreviated
// multi-word names. Renamed old slugs fall back to `RENAMED_SLUG_NAMES`; anything
// else (a slug the host does not know) falls back to a title-cased slug.
export function resolveTestCaseName(
  slug: string,
  testCases: readonly { slug: string; name: string }[],
): string {
  const fromCatalog = testCases.find((c) => c.slug === slug)?.name;
  if (fromCatalog) {
    return fromCatalog;
  }
  return RENAMED_SLUG_NAMES[slug] ?? formatSlug(slug);
}

// A resolver bound to the host's current catalog. Every surface that has only a
// run's `testCaseSlug` (the home gallery, run log, tournaments) uses this so it
// shows the Test Cabinet name rather than the on-disk slug.
export function useTestCaseName(): (slug: string) => string {
  const { testCases } = useTestCases();
  return (slug) => resolveTestCaseName(slug, testCases);
}
