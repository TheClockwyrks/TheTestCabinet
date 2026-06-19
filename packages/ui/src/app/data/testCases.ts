// The test-case catalog's site-facing shapes. The data itself is assembled by
// each host and injected through the gallery data source (see galleryContext):
// the static site maps the public R2 snapshot's case slice, the consoles map the
// backend catalog. The prompt and reference screenshots come through everywhere
// (the backend renders the prompt at ingest and serves it in the snapshot too).
// Spec bodies and seeded inputs resolve from the backend, not the public site, so
// `seededInputs` comes through empty on the static site and the Specifications
// tab there shows the prompt but no seeded files.

/** A single input seeded into a run's fresh repository, as the catalog records it. */
export interface SeededInput {
  /** Path of the file inside the seeded repository (e.g. `specification.md`). */
  path: string;
  /** Whether the file is inlined text or a binary referenced by URL. */
  kind: "text" | "image";
  /** Inlined contents, present for `kind: "text"`. */
  text?: string;
  /** Public `/catalog/...` URL, present for `kind: "image"`. */
  url?: string;
}

/** A reference used as a visual target for a view: a rendered mockup or static
 * image (`kind: "image"`) or a static clip (`kind: "video"`). */
export interface ReferenceScreenshot {
  /** The view the reference depicts (e.g. `title`, `game-over`). */
  view: string;
  /** Whether the media is a still image or a video. */
  kind: "image" | "video";
  /** Public URL of the reference media. */
  url: string;
}

/** One variant of a test case, as the catalog records it. */
export interface VariantSummary {
  /** The stable slug naming this variant (e.g. `base`). */
  slug: string;
  /** Human-readable display name (defaults to the humanized slug). */
  name: string;
  /** Inlined site-facing description, or null when none is declared. */
  description: string | null;
  /** The instruction handed to the harness for this variant — the case's
   * `prompt.hbs` rendered exactly as a real run receives it. It is the first
   * thing the model sees, ahead of the seeded specs. */
  prompt: string;
  /** What a run of this variant is seeded with — identical to what
   * `tcab seed --variant <slug>` materializes. */
  seededInputs: SeededInput[];
  /** Rendered reference screenshots that are visual targets for this variant. */
  referenceScreenshots: ReferenceScreenshot[];
}

/** One test case in the catalog, across all of its published versions. */
export interface TestCaseSummary {
  slug: string;
  name: string;
  /** Relative difficulty, e.g. `easy` | `medium` | `hard`. */
  difficulty: string;
  tags: string[];
  /** Short, plain-text abstract shown on the catalog card, or null. */
  summary: string | null;
  /** Inlined site-facing Markdown from the case's `description.md`, or null. */
  description: string | null;
  /** Every published version, newest first. */
  versions: string[];
  /** The newest version (first of `versions`). */
  latestVersion: string;
  /** The variants the latest version offers, in declared order (default first).
   * Each carries the inputs a run of that variant is seeded with. */
  variants: VariantSummary[];
}
