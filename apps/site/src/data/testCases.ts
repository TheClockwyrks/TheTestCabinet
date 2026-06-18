import { testCases as snapshotTestCases } from "virtual:tcab-snapshot";

// The published test-case catalog dataset. It is the site-facing slice of each
// test-case version carried in the backend's public R2 snapshot (see
// design/v0.2.0-contracts.md §3), fetched at build time by `vite-plugin-snapshot`
// and inlined into the bundle. The public snapshot deliberately omits spec
// bodies, prompts, and seeded inputs — those resolve from the backend at run
// time, not on the public site — so `prompt`/`seededInputs` come through empty
// and the Specifications tab shows only what the snapshot carries. `useTestCases`
// falls back to `sampleTestCases` when this dataset is empty so the UI has
// content before any run is published.

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

/** A rendered reference screenshot used as a visual target for a view. */
export interface ReferenceScreenshot {
  /** The view the screenshot depicts (e.g. `title`, `game-over`). */
  view: string;
  /** Public `/catalog/...` URL of the rendered image. */
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

export const testCases: TestCaseSummary[] = snapshotTestCases;
