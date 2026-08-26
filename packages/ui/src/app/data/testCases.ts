import type {
  AssetSheet,
  MediaKind,
  ModelSpec,
  TestType,
} from "@test-cabinet/run-record";
import type {
  AssetKind,
  CaseShowcase,
  CatalogShowcase,
  Erratum,
  ReferenceSheet,
  WorkspaceFileRef,
} from "../../client";
import type { FailureCap } from "../../ratings";

export type { Erratum, ErratumSeverity } from "../../client";
/** The published reference frames of one asset-generation case variant, as the
 * catalog records them. Re-exported from the client wire shape so the catalog and
 * the transports cannot drift on it. */
export type { ReferenceSheet } from "../../client";
/** A variant's authored showcase (description + media carousel captured from the
 * reference implementation), one carousel entry, a case's catalog showcase
 * preview, and one starter-workspace file reference — as the catalog records
 * them. Re-exported from the client wire shapes (the same drift rule as
 * {@link ReferenceSheet}): the media bytes resolve through the gallery's
 * `caseShowcaseMediaUrl`, a workspace file's through its own `url`. */
export type {
  CaseShowcase,
  CatalogShowcase,
  ShowcaseMediaRef,
  WorkspaceFileRef,
} from "../../client";

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
  /** On a validator-rated version, the failure cap of a whole-item point — the
   * highest functional rating its `domains` may reach while its validator fails.
   * Absent on a legacy version and on a category (whose points carry their own). */
  failureCap?: FailureCap | null;
  /** On a validator-rated version, the scoring domain ids a failure of this
   * whole-item point lowers. Empty on a legacy version and on a category. */
  domains?: string[];
  /** Whether this item contributes to the run's score. Set false on the effective
   * checklist only when an erratum's `excludeFromScore` links its verdict id (still
   * checked and shown, just not scored). Absent/true otherwise. */
  scored?: boolean;
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
  /** On a validator-rated version, this point's failure cap — the highest
   * functional rating its `domains` may reach while its validator fails. Absent
   * on a legacy version. */
  failureCap?: FailureCap | null;
  /** On a validator-rated version, the scoring domain ids a failure of this point
   * lowers. Empty on a legacy version. */
  domains?: string[];
  /** Whether this sub-item contributes to the run's score. Set false on the
   * effective checklist only when an erratum's `excludeFromScore` links its composite
   * verdict id (or excludes its whole category). Absent/true otherwise. */
  scored?: boolean;
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

/** A case's known-issue errata for one version: the version and its errata, in
 * declared order. The detail page's Errata tab lists these grouped newest version
 * first, and a run's detail view resolves its version's entry to flag known issues
 * to reviewers. Versions with no errata are omitted. `Erratum` is re-exported from
 * the client so consumers import the whole errata vocabulary from one place. */
export interface ErrataEntry {
  /** The version the errata apply to (e.g. `v1.0.0`). */
  version: string;
  /** The known-issue entries recorded for that version, in declared order. */
  errata: Erratum[];
}

/** A reference used as a visual target for a view: a rendered mockup or static
 * image (`kind: "image"`) or a static clip (`kind: "video"`). */
export interface ReferenceScreenshot {
  /** The view the reference depicts (e.g. `title`, `game-over`). */
  view: string;
  /** Whether the media is a still image, a video, or an engine replay — the kind
   * decides how it is shown, and a replay is re-drawn onto a canvas rather than
   * loaded as a media file. Carried as the contract's own {@link MediaKind} rather
   * than a narrower copy of it, so a kind added there reaches the catalog instead
   * of failing to assign into it. */
  kind: MediaKind;
  /** Public URL of the reference media. */
  url: string;
}

/** A variant's identity alone — what a selector offers before the selected
 * coordinate is resolved in full. */
export interface VariantRef {
  /** The stable slug naming the variant (e.g. `base`). */
  slug: string;
  /** Human-readable display name (defaults to the humanized slug). */
  name: string;
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
  /** Whether a run of this variant is **validator-rated**: its case version is on
   * the engine manifest format and is not a game jam, so every point above
   * carries a `failureCap` and `domains`, the functional rating and score are
   * decided by the validators the moment a run completes, and a reviewer rates
   * only the aesthetic channel. False on a legacy version, reviewed as before. */
  validatorRated: boolean;
  /** The absolute URLs of this variant's **reference implementations**, keyed by
   * the engine each was built for — the authored, in-repo, versioned static builds
   * that are the *correct* implementation of the variant, deployed out-of-band by
   * `tcab publish-reference` exactly as a published run's playable build is. Empty
   * when the variant declares no `reference_implementation`, which is the common
   * case.
   *
   * Keyed by engine because the build a reference demonstrates genuinely differs
   * under each: an engineless one carries its own runtime, an engine-backed one
   * hands the same surfaces to the runtime it vendors. The case-detail Reference
   * tab iframes one and offers a switch between the rest — the build was already
   * redacted at publish, so it is loaded inline with no caveat.
   *
   * Never a seeded input and never produced by a run; it is the case-variant
   * analogue of a run's `links.playableBuild`. Carried by every host: the backend
   * catalog populates it from the `case_reference_build` table, the static snapshot
   * from `CaseVariantOut.referenceBuilds`. */
  referenceBuilds: Record<string, string>;
  /** The published **reference frames** of this variant of an asset-generation
   * case — the other shape a reference implementation takes. An asset case builds
   * no site, so its reference is data rather than a page: `tcab publish-reference`
   * runs the variant's authored drawing script and uploads each declared frame's
   * rendered image and the action log it was drawn from to the public snapshot
   * bucket. Only the published indices travel here; the objects are addressed by
   * the deterministic keys defined in `crates/core/src/asset_reference.rs` and
   * resolved through the host's `referenceMediaUrl`. `null` when the variant has no
   * published asset reference, which is the common case — and always null for an
   * end-to-end/full-stack variant, whose reference is a {@link referenceBuilds}
   * instead. The two are mutually exclusive in practice: a case is one test type. */
  referenceSheet: ReferenceSheet | null;
  /** The variant's authored **showcase**, when it declares one: the description
   * plus the 2–10-entry media carousel captured from the reference
   * implementation, committed with the version. Drives the detail page's Play
   * tab (and, at the listing level, the catalog's preview stage — see
   * {@link TestCaseSummary.showcase}). The media bytes resolve through the
   * host's `caseShowcaseMediaUrl`; a host that omits the resolver degrades
   * exactly like the run showcase ("not available here"). `null` when the
   * variant declares none, and absent on a host that predates the field —
   * either way the Play surfaces show no showcase. */
  showcase?: CaseShowcase | null;
  /** The variant's **effective** starter-workspace files (its own override when
   * it declares one, else the case's common workspace) for the engine this
   * summary was rendered for — the starter project a run is seeded with, newly
   * surfaced on the Inputs tab's file tree. Each entry carries the
   * run-root-relative path and a lazily-fetched URL (the consoles point at the
   * backend's version artifacts route, the static site at the snapshot's
   * published objects). Empty when the case seeds no starter file for the
   * engine, and absent on a host that predates the field. */
  workspace?: WorkspaceFileRef[];
}

/**
 * One test case as a *listing* knows it: the fields a catalog card renders, plus
 * the version list. This is the whole of what the catalog and every other list
 * surface needs, and it is what a host resolves for every case up front.
 *
 * Everything heavier — the description, the variants (with their prompts, seeded
 * specs, references, and checklists), the changelog, and the errata — lives on
 * {@link TestCaseDetail}, fetched per slug only for a case a visitor opens. The
 * split is deliberate: folding those into the listing meant resolving every
 * version of every case (and every variant's spec bodies) before the catalog grid
 * could paint, which cost hundreds of requests for a page that shows a name, a
 * difficulty, a summary, and some tags.
 */
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
  /** Every published version, newest first. */
  versions: string[];
  /** The newest version (first of `versions`). */
  latestVersion: string;
  /** The case's catalog **showcase preview** — the latest version's first
   * variant (manifest order) that declares a showcase, with the media list the
   * catalog's preview stage loops (only the addressing rides here; the
   * description lives on the resolved variant — see
   * {@link VariantSummary.showcase}). The media bytes resolve through the
   * host's `caseShowcaseMediaUrl`. `null` when no variant of the latest version
   * declares one, and absent on a host that predates the field — either way the
   * catalog renders its placeholder stage. */
  showcase?: CatalogShowcase | null;
}

/**
 * One repo-defined test-case group — a global, ordered set of related test-case
 * slugs the home page renders a leaderboard per (NOT the per-account coverage
 * "case group"). The wire's `TestCaseGroupOut` shape, host-agnostic: the console
 * fetches groups from `GET /test-case-groups`, the static site reads them from
 * the snapshot's `test-case-groups.json`; both arrive already in display order
 * (rank ascending then name, resolved at ingest — rank never rides the wire).
 */
export interface TestCaseGroupSummary {
  /** The group's stable slug. */
  slug: string;
  /** Display name, heading the group's home-page leaderboard. */
  name: string;
  /** Optional one-line description, or null. */
  summary: string | null;
  /** The ordered member test-case/game-jam slugs, by manifest-declared identity
   * (the slug run records carry). */
  cases: string[];
}

/**
 * One test case in full, across all of its published versions — what a *detail*
 * surface needs. Resolved per slug through the gallery's `fetchTestCase` (see
 * `useTestCase`) rather than held for the whole catalog, because assembling it
 * costs one request per version plus one per variant's seeded specs.
 */
export interface TestCaseDetail extends TestCaseSummary {
  /** Inlined site-facing Markdown from the case's `description.md`, or null. */
  description: string | null;
  /** The case's changelog, one entry per version that declares a `changelog.md`,
   * ordered newest version first. Empty when no version carries one. */
  changelog: ChangelogEntry[];
  /** The case's known-issue errata, one entry per version that records any,
   * ordered newest version first. Empty when no version carries errata. Drives the
   * detail page's Errata tab and the run detail view's "known errata" callout
   * (resolved by the run's version). */
  errata: ErrataEntry[];
  /** The variants the latest version offers, in declared order (default first).
   * Each carries the inputs a run of that variant is seeded with. */
  variants: VariantSummary[];
  /** Each published version's variants — identity only, in declared order
   * (default first), keyed by version and covering every version including the
   * latest. This is the frame the detail header's variant selector is built
   * from, so picking a version offers exactly the variants that version
   * declares; the selected coordinate's full {@link VariantSummary} is resolved
   * separately through the gallery's `fetchCaseVariant`. */
  variantsByVersion: Record<string, VariantRef[]>;
  /** The engine slugs each published version supports, keyed by version — the set
   * a run of that version may select, and therefore the set of renderings its
   * inputs exist in. Never empty for a version this host carries.
   *
   * A case's `prompt.hbs` and its `.hbs` specs branch on the selected engine, so a
   * version that supports more than one has more than one set of inputs, and the
   * Inputs tab needs the list to offer them. It is keyed by version because the
   * supported set is a property of a version: an engine added to a case appears in
   * the version that added it and not in the ones before.
   *
   * Each host fills it from what it can actually render: the consoles from the
   * version's declared `engines`, the static site from the renderings its snapshot
   * carries. */
  enginesByVersion: Record<string, string[]>;
  /** The case's COMMON scoring domains (every variant is rated on these; a
   * variant may add its own — see VariantSummary.domains). A reviewer rates each
   * domain independently; a run's overall rating is the worst across them. At
   * least one is present when the host could resolve the case. */
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
