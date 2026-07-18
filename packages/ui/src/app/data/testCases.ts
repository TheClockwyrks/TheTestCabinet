import type { AssetSheet, ModelSpec, TestType } from "@test-cabinet/run-record";
import type { AssetKind } from "../../client";

// The test-case catalog's site-facing shapes. The data itself is assembled by
// each host and injected through the gallery data source (see galleryContext):
// the static site maps the public R2 snapshot's case slice, the consoles map the
// backend catalog. The prompt, seeded specs, and reference screenshots come
// through everywhere: the backend renders the prompt at ingest and inlines the
// seeded spec bodies into the snapshot too, so the static site's Inputs tab shows
// the same prompt, specs, and references the backend-connected consoles resolve
// live (the consoles fetch spec bodies per file; the snapshot carries them
// inlined).

/** A single input seeded into a run's fresh repository, as the catalog records it. */
export interface SeededInput {
  /** Path of the file inside the seeded repository (e.g. `specification.md`). */
  path: string;
  /** Whether the file is inlined text or a binary referenced by URL. */
  kind: "text" | "image";
  /** The role the file plays — a prose `spec` (the default) or an executable
   * `script` the model edits and runs (e.g. a Blender `build.py`). Drives the tag
   * the Inputs surfaces show; presentation only. */
  role?: "spec" | "script";
  /** Inlined contents, present for `kind: "text"`. */
  text?: string;
  /** Public `/catalog/...` URL, present for `kind: "image"`. */
  url?: string;
}

/** A runtime package a case ships into every run, as the catalog records it: its
 * npm name and a UI-only description of what it provides (never seeded into a run —
 * it exists only to explain, on the Inputs surfaces, what the package is for). */
export interface PackageInput {
  /** The npm package name the case declares (e.g. `@test-cabinet/particle-runtime`). */
  name: string;
  /** The UI-only description of what the package provides. */
  description: string;
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
  /** For a sprite-sheet asset-generation case: the sheet sequence slugs this item
   * is about, surfaced as the relevant animations to play beside it. Empty when
   * the item names none. */
  sequences?: string[];
  /** For a sprite-sheet asset-generation case: the frame indices this item is
   * about, surfaced as the relevant frames beside it. Empty when none. */
  frames?: number[];
  /** Points this item is worth. Graded as a whole: a pass earns this weight, a
   * fail earns none. With sub-items: split evenly across them, so the item earns
   * the fraction that passed. A `graded` item (a game-jam category) is instead
   * worth `weight × 10` points and earns the graded tier's points times its
   * weight. */
  weight: number;
  /** Whether the item is graded on the five-level scale (a game-jam category)
   * rather than pass/fail. The verdict page and leaderboard score `weight × 10`
   * points for it and render the grade emoji when true. Absent on a host that
   * predates the field; treated as false. */
  graded?: boolean;
  /** Scoring domain (by id) this item belongs to, or null for a general item. */
  domain?: string | null;
  /** Name-only sub-items this item is graded by, each an independently scored
   * pass/fail point keyed by the composite `<item id>.<sub id>`. Empty for an
   * item graded as a whole. */
  subItems?: ReviewSubItemSummary[];
}

/** A sub-item of a {@link ReviewItemSummary}: one independently graded pass/fail
 * point. Legacy sub-items are name-only (id + title); a categories-grammar review
 * item also carries its own prose, weight, and paired reference/proof. */
export interface ReviewSubItemSummary {
  id: string;
  title: string;
  /** Optional prose for this point (categories grammar); absent for a legacy
   * name-only sub-item. */
  description?: string | null;
  /** Points this sub-item is worth; the parent category's weight is the sum of
   * its sub-items' weights. Absent is treated as 1. */
  weight?: number;
  /** Optional paired reference view / proof id for this point. */
  reference?: string | null;
  proof?: string | null;
}

/** A scoring domain a case declares. A reviewer rates each independently; a run's
 * overall rating is the worst across them. */
export interface DomainSummary {
  id: string;
  name: string;
  description: string;
}

/** One entry in a case's changelog: the version it describes and the inlined
 * Markdown body recording what changed in that version. The detail page's
 * Changelog tab lists these newest first. */
export interface ChangelogEntry {
  /** The version the entry describes (e.g. `v1.0.1`). */
  version: string;
  /** The version's `changelog.md` body, rendered as Markdown. */
  body: string;
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
  /** The Test Cabinet runtime packages a run of this variant ships (case-level, so
   * the same set on every variant), each with a UI-only description. Empty when the
   * case declares none. Shown on the Inputs surfaces alongside the seeded files. */
  packages: PackageInput[];
  /** Rendered reference screenshots that are visual targets for this variant. */
  referenceScreenshots: ReferenceScreenshot[];
  /** The reviewer checklist items for this variant (common + the variant's own),
   * carrying the point weights that produce a run's score. Empty when the host
   * could not resolve them. */
  reviewItems: ReviewItemSummary[];
  /** The scoring domains a run of this variant is rated against — the effective
   * set (the case's common domains + this variant's own additive ones). A
   * reviewer rates each independently; a run's overall rating is the worst across
   * them. Empty when the host could not resolve them. */
  domains: DomainSummary[];
  /** The absolute URL of this variant's **reference implementation** — the
   * authored, in-repo, versioned static build that is the *correct* implementation
   * of the variant, deployed out-of-band by `tcab publish-reference` exactly as a
   * published run's playable build is. `null` when the variant declares no
   * `reference_implementation`, which is the common case. It is never a seeded
   * input and never produced by a run; it is the case-variant analogue of a run's
   * `links.playableBuild`, and the case-detail Reference tab (shown only for an
   * end-to-end case whose selected variant carries one) iframes it as-is — the
   * build was already redacted at publish, so it is loaded inline with no caveat.
   * Carried by every host: the backend catalog populates it from the
   * `case_reference_build` table, the static snapshot from `CaseVariantOut.referenceBuild`. */
  referenceBuild: string | null;
}

/** One test case in the catalog, across all of its published versions. */
export interface TestCaseSummary {
  slug: string;
  name: string;
  /** The case's test type — drives type-specific affordances such as the
   * adversarial Arena tab. */
  testType: TestType;
  /** For an asset-generation case, the asset shape it produces — the catalog
   * partitions its 2D / 3D / Particle / Audio asset-family tabs on this. Carried
   * by every host, including the static snapshot (see the backend's
   * `CaseMetadata`); null only for a non-asset case or a snapshot old enough to
   * predate the field. */
  assetKind?: AssetKind | null;
  /** Relative difficulty, e.g. `easy` | `medium` | `hard`. */
  difficulty: string;
  tags: string[];
  /** Short, plain-text abstract shown on the catalog card, or null. */
  summary: string | null;
  /** Inlined site-facing Markdown from the case's `description.md`, or null. */
  description: string | null;
  /** The case's changelog, one entry per version that declares a `changelog.md`,
   * ordered newest version first. Empty when no version carries one. */
  changelog: ChangelogEntry[];
  /** Every published version, newest first. */
  versions: string[];
  /** The newest version (first of `versions`). */
  latestVersion: string;
  /** The variants the latest version offers, in declared order (default first).
   * Each carries the inputs a run of that variant is seeded with. */
  variants: VariantSummary[];
  /** The case's COMMON scoring domains (every variant is rated on these; a
   * variant may add its own — see VariantSummary.domains). A reviewer rates each
   * domain independently; a run's overall rating is the worst across them. At
   * least one is present when the host could resolve the catalog. */
  domains: DomainSummary[];
  /** The sprite-sheet frame grid and named sequences a sprite-sheet
   * asset-generation case declares; null for a single sprite or any non-asset
   * case (and absent on hosts that don't carry it, e.g. the static snapshot).
   * Lets the live monitor show one stable slot per declared frame, named from
   * the sequences. */
  sheet?: AssetSheet | null;
  /** The rig (parts + joints) a voxel-animation asset-generation case declares;
   * null for a static voxel model, a 2D sprite/sheet, or any non-asset case (and
   * absent on hosts that don't carry it, e.g. the static snapshot). Lets the live
   * monitor show one stable slot per declared part, named from the parts, before
   * the model has sculpted anything — the 3D analog of {@link sheet}. */
  model?: ModelSpec | null;
}
