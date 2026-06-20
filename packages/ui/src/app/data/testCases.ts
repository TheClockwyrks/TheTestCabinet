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

/** A reviewer checklist item a case declares for a variant, with the point weight
 * that contributes to a run's score and the optional scoring domain it rolls up
 * to. Carried on every host so the verdict page and the leaderboard can score
 * runs without a live backend. */
export interface ReviewItemSummary {
  id: string;
  title: string;
  text: string;
  reference?: string | null;
  proof?: string | null;
  /** Points this item is worth: a pass earns this weight, a fail earns none. */
  weight: number;
  /** Scoring domain (by id) this item belongs to, or null for a general item. */
  domain?: string | null;
}

/** A scoring domain a case declares. A reviewer rates each independently; a run's
 * overall rating is the worst across them. */
export interface DomainSummary {
  id: string;
  name: string;
  description: string;
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
  /** The reviewer checklist items for this variant (common + the variant's own),
   * carrying the point weights that produce a run's score. Empty when the host
   * could not resolve them. */
  reviewItems: ReviewItemSummary[];
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
  /** The case's scoring domains (case-level). A reviewer rates each domain
   * independently; a run's overall rating is the worst across them. At least one
   * is present when the host could resolve the catalog. */
  domains: DomainSummary[];
}
