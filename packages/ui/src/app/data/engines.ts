// The engines a run can select — the runtime the produced game is built on. An
// engine is a run dimension chosen alongside the test case, variant, harness, and
// model, and a case declares only which engines it supports, so the picker's
// options are the intersection of this catalog and the resolved case version's
// `engines` list.
//
// The catalog is closed: it mirrors core's built-in engines (`engines/<slug>/`) in
// catalog order, leading with the default, so the console never offers a slug a
// run would be rejected for naming.

/** The default engine: no runtime, so the build supplies every surface itself. */
export const DEFAULT_ENGINE_SLUG = "none";

/** One engine as the console names it. */
export interface EngineOption {
  /** The slug a run records and a case's `engines` list names. */
  slug: string;
  /** The display name, as `engines/<slug>/engine.toml` gives it. */
  name: string;
}

/**
 * The catalog, in the order core enumerates it, leading with the default. It
 * mirrors `engines/<slug>/engine.toml`, so a surface that has only slugs in hand —
 * the reference-build switch on a case's Reference tab, say — can label them
 * without asking a host that may not carry the catalog at all.
 */
export const ENGINES: readonly EngineOption[] = [
  { slug: DEFAULT_ENGINE_SLUG, name: "None" },
  { slug: "simple-2d", name: "Simple 2D" },
];

/**
 * The display name for `slug`, falling back to the slug itself.
 *
 * The fallback is what keeps a console built before an engine landed from showing
 * an empty label for it: an unknown slug reads as itself, which is still the thing
 * the run recorded.
 */
export function engineName(slug: string): string {
  return ENGINES.find((engine) => engine.slug === slug)?.name ?? slug;
}

/**
 * `slugs` in catalog order, with any the catalog does not know appended in the
 * order given. Used to order the engines a variant published a reference build
 * for, so the switch reads the same way everywhere.
 */
export function orderEngines(slugs: readonly string[]): string[] {
  const known = ENGINES.map((engine) => engine.slug).filter((slug) =>
    slugs.includes(slug),
  );
  return [...known, ...slugs.filter((slug) => !known.includes(slug))];
}
