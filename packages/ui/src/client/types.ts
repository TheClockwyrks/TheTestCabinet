// Shared data shapes for the runner/reporter console, independent of transport.
// The HTTP transport (apps/web) and the Tauri transport (apps/desktop, a later
// item) both produce and consume these. Fields are camelCase to match both the
// backend HTTP API and the run-record contract.
import type {
  AssetKind,
  AssetSheet,
  HarnessFamily,
  MediaKind,
  ModelSpec,
  RunRecord,
  TestType,
} from "@test-cabinet/run-record";

// Re-exported so console code can keep importing the asset-kind type from the
// client layer alongside the shapes it discriminates.
export type { AssetKind };
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import type { HarnessEvent } from "@test-cabinet/run-record/event";
import type {
  DomainRating,
  Rating,
  ReviewVerdict,
  VerdictStatus,
} from "../ratings";

export type { DomainRating, Rating, ReviewVerdict, VerdictStatus };
export type { HarnessFamily, MediaKind, TestType };
// The normalized harness event shape is generated from the Rust `HarnessEvent`
// contract (crates/core/src/event.rs) — the live monitor and the published
// Events tab both render it. Re-exported here so consumers keep importing it
// from the shared client types.
export type { HarnessEvent };

// --- Model catalog (served by the backend `GET /models`) ---

/** A comparable per-token price triple, USD; each member null when unknown. */
export interface ModelPrices {
  uncachedInput: number | null;
  cachedInput: number | null;
  output: number | null;
}

/** One observation in a model's price history. */
export interface PriceObservation {
  observedAt: string;
  prices: ModelPrices;
}

/** One canonical model id a catalog entry claims, tagged with the harness family
 * it is usable with. Mirrors the backend `AliasOut`. A Claude Code slug
 * (`claude-opus-4-8`) and an OpenRouter slug (`anthropic/claude-opus-4.8`) for the
 * same model are two entries under different families, so a run form can offer a
 * harness only the slugs it can actually launch. */
export interface ModelAlias {
  slug: string;
  harnessFamily: HarnessFamily;
}

/** One catalog entry: a curated model merged with its runs + price history, or a
 * model derived from runs alone (`curated: false`). Mirrors the backend `ModelOut`. */
export interface Model {
  slug: string;
  name: string;
  provider: string;
  /** Whether this entry has curated config, versus being derived from runs. */
  curated: boolean;
  /** `https://openrouter.ai/<slug>` when on OpenRouter, else null. */
  openrouterUrl: string | null;
  /** Curated description markdown, or null. */
  description: string | null;
  /** The curated, sanitized provider-logo SVG, or null. */
  logoSvg: string | null;
  /** The raw run-record `modelId`s this entry absorbs (what a run matches on). */
  coveredModelIds: string[];
  /** The canonical model ids this entry claims, each tagged with the harness
   * family it is usable with. */
  aliases: ModelAlias[];
  /** The latest observed comparable price, or null. */
  price: ModelPrices | null;
  /** The observed price history, ascending, consecutive-equal deduped. */
  priceHistory: PriceObservation[];
  /** The latest observed context window in tokens, or null. */
  contextLength: number | null;
  /** The latest observed release date (RFC 3339), or null. */
  releasedAt: string | null;
}

/** The `POST /models` / `PUT /models/{slug}` request body. Each alias pairs a slug
 * with the harness family it is usable with. Mirrors the backend `ModelConfigInput`
 * (whose `AliasInput` has the same `{ slug, harnessFamily }` shape as `ModelAlias`). */
export interface ModelInput {
  slug: string;
  name: string;
  provider: string;
  aliases: ModelAlias[];
  openrouterSlug: string | null;
  description: string | null;
  logoSvg: string | null;
  providerLogoUrl: string | null;
}

/** A blank-form seed derived from a run of an unknown model (`GET /models/seed`).
 * Its aliases are tagged with the family of the harness the seed run used. */
export interface ModelSeed {
  slug: string;
  name: string;
  provider: string;
  aliases: ModelAlias[];
  openrouterSlug: string | null;
}

/** The `POST /models/logo` result: the fetched, sanitized SVG. */
export interface LogoFetchResult {
  logoSvg: string;
}

export interface TestCase {
  slug: string;
  versions: string[];
}

// A reference for a view, resolved to an absolute media URL. A rendered mockup or
// static image is `kind: "image"`; a static reference clip is `kind: "video"`.
export interface ReferenceShot {
  view: string;
  kind: MediaKind;
  url: string;
}

// A run's submitted proof-of-implementation media for a declared proof, resolved
// to an absolute media URL. `present` mirrors the run's validation result; `url`
// is set only when the media is available to load.
export interface ProofMedia {
  id: string;
  name: string;
  kind: MediaKind;
  present: boolean;
  url: string | null;
}

export interface VariantInfo {
  slug: string;
  name: string;
  description: string | null;
  // The instruction handed to the harness (prompt.hbs rendered as a real run
  // receives it). The backend renders it for every variant.
  prompt: string;
  // Rendered reference screenshots for this variant (common first, then the
  // variant's own), resolved to loadable URLs. Empty when none are served.
  references: ReferenceShot[];
  // The reviewer checklist items for this variant (common first, then the
  // variant's own), carrying their point weights. Used to score runs.
  reviewItems: ReviewItem[];
  // The scoring domains a reviewer rates a run of this variant against (common
  // first, then the variant's own). This is the variant's EFFECTIVE set — the
  // case's common domains plus this variant's own additive ones — so a run is
  // always rated on exactly the domains that apply to its selected variant.
  domains: Domain[];
  // The absolute URL of this variant's reference implementation — the correct,
  // authored static build the backend records in `case_reference_build` and serves
  // on the resolved version (camelCase `referenceBuild`). Null when the variant
  // declares no `reference_implementation`, and absent on a backend that predates
  // the field.
  referenceBuild?: string | null;
}

// The 3D voxel-family asset kinds — the two cube kinds, the six surface-meshed
// kinds, and the three skinned kinds. Everything else (the two flat `sprite*`
// kinds and the `ui`/`material` paint kinds, plus particle and audio) is not
// voxel-family. Mirrors `AssetKind::is_voxel` on the Rust side — including the
// skinned kinds, which are voxel-family (one whole-body field) and render in 3D.
const VOXEL_ASSET_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>([
  "voxel-model",
  "voxel-animation",
  "mc-model",
  "mc-animation",
  "sn-model",
  "sn-animation",
  "dc-model",
  "dc-animation",
  "mc-skinned",
  "sn-skinned",
  "dc-skinned",
]);

/** Whether an asset kind is one of the 3D voxel-family kinds (voxel/mesh/skinned)
 * — as opposed to a 2D sprite or paint kind, a particle system, or audio. An
 * absent kind is treated as the default `sprite` (2D), so it reads as false. */
export function isVoxelAssetKind(kind: AssetKind | null | undefined): boolean {
  return kind != null && VOXEL_ASSET_KINDS.has(kind);
}

// The particle-system asset kinds. Mirrors `AssetKind::is_particle` on the Rust
// side.
const PARTICLE_ASSET_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>([
  "particle-2d",
  "particle-3d",
]);

/** Whether an asset kind is a particle system (`particle-2d`/`particle-3d`). An
 * absent kind reads as false. */
export function isParticleAssetKind(
  kind: AssetKind | null | undefined,
): boolean {
  return kind != null && PARTICLE_ASSET_KINDS.has(kind);
}

// The audio asset kinds. Mirrors `AssetKind::is_audio` on the Rust side.
const AUDIO_ASSET_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>([
  "sfx-synth",
  "sfx-sample",
  "music",
]);

/** Whether an asset kind is an audio clip (`sfx-synth`/`sfx-sample`/`music`). An
 * absent kind reads as false. */
export function isAudioAssetKind(kind: AssetKind | null | undefined): boolean {
  return kind != null && AUDIO_ASSET_KINDS.has(kind);
}

// The Blender asset kinds. Mirrors `AssetKind::is_blender` on the Rust side: the
// skinned character, the static prop, and the rigidly-articulated mechanism — all
// authored by driving headless Blender and emitted as a self-contained native glTF.
const BLENDER_ASSET_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>([
  "blender-character",
  "blender-prop",
  "blender-mechanism",
]);

/** Whether an asset kind is a **Blender** kind (`blender-character`/`blender-prop`/
 * `blender-mechanism`) — authored by driving headless Blender and emitted as a
 * self-contained native glTF. Its own catalog family: not a voxel-family kind (it is a
 * real mesh, not a voxel field) even though it, too, renders in 3D. An absent kind reads
 * as false. */
export function isBlenderAssetKind(
  kind: AssetKind | null | undefined,
): boolean {
  return kind != null && BLENDER_ASSET_KINDS.has(kind);
}

export interface VersionInfo {
  slug: string;
  version: string;
  name: string;
  difficulty: string;
  tags: string[];
  summary: string | null;
  // The case's test type. Drives type-specific UI affordances — notably the
  // run-launch orchestrator selector, which is offered only for "end-to-end".
  testType: TestType;
  // For an asset-generation case, which asset shape it produces — the finer
  // discriminator the catalog partitions its 2D / 3D / Particle / Audio tabs on.
  // Carried by every host, including the static snapshot; null only for a
  // non-asset case or a snapshot that predates the field.
  assetKind?: AssetKind | null;
  // The site-facing Markdown description, when the source carries it.
  description?: string | null;
  // This version's own changelog entry (its `changelog.md` body). Required — every
  // version declares a changelog — so always present from the backend. The console
  // aggregates every version's entry into the case's changelog tab (newest first).
  changelog: string;
  variants: VariantInfo[];
  // The case's COMMON domains (every variant is rated on these; a variant may add
  // its own — see VariantInfo.domains). A reviewer rates each independently; a
  // run's overall rating is the worst across them.
  domains: Domain[];
  // The sprite-sheet frame grid and named sequences a sprite-sheet
  // asset-generation case declares; absent (null) for a single sprite or any
  // non-asset case. Carried so the live monitor can show one stable slot per
  // declared frame as the model draws, named from the sequences.
  sheet?: AssetSheet | null;
  // The rig (parts + joints) a voxel-animation asset-generation case declares;
  // absent (null) for a static voxel model, a 2D sprite/sheet, or any non-asset
  // case. The 3D analog of `sheet`: carried so the live monitor can show one
  // stable slot per declared part as the model sculpts, named from the parts.
  model?: ModelSpec | null;
  maxRuntimeSeconds: number;
  // The Test Cabinet runtime packages this case ships into every run, each with a
  // UI-only description. Empty for a case that declares none. Case-level (shared by
  // every variant), surfaced on the Inputs tab.
  packages: PackageInfo[];
  // Known-issue errata recorded for this version after it shipped — a way to
  // acknowledge a problem without cutting a new version (which would evict the
  // version's runs from its metrics). Empty when the version has none, and absent
  // on a backend/snapshot that predates the field. Surfaced on the case's Errata
  // tab and, where relevant, to reviewers scoring a run of the version.
  errata?: Erratum[];
}

// How serious a known-issue erratum is. Mirrors `ErratumSeverity` on the Rust side.
export type ErratumSeverity = "info" | "minor" | "major";

// A known-issue erratum for a test-case version (see VersionInfo.errata). Records
// a problem discovered after the version shipped so it can be acknowledged without
// a version bump.
export interface Erratum {
  id: string;
  // A short one-line heading for the issue.
  title: string;
  // The date (`YYYY-MM-DD`) the issue was recorded, when declared.
  date: string | null;
  // How serious the issue is (badge only — no automatic score effect).
  severity: ErratumSeverity;
  // Whether the issue can affect a run's score. Signals that the eventual fix
  // would otherwise warrant a version bump, and that reviewers should weigh it.
  affectsScoring: boolean;
  // The issue description, as Markdown.
  body: string;
  // The version the issue is (or will be) addressed in, when declared. Null while
  // the issue is outstanding with no fix version recorded yet.
  resolvedIn: string | null;
  // The variant slug the issue is scoped to, or null when it applies to every
  // variant.
  variant: string | null;
  // The review verdict id the issue concerns (a review item id or a composite
  // `<item id>.<sub-item id>`), or null when it is not tied to a specific point.
  review: string | null;
}

// A runtime package a case ships into its runs: its npm name and the UI-only
// description of what it provides (never seeded into a run — it exists only to
// explain, in the Inputs UI, what the package is for).
export interface PackageInfo {
  name: string;
  description: string;
}

// The role a seeded file plays, so the Inputs UI can tag an executable starter
// ("script") distinctly from a prose spec ("spec"). Presentation only.
export type SpecRole = "spec" | "script";

export interface SpecDocument {
  dest: string;
  body: string;
  // The seeded file's role, carried so the Inputs tab can tag it. Absent on a
  // backend that predates the field; treated as "spec".
  kind?: SpecRole;
}

export interface Specification {
  slug: string;
  version: string;
  variant: string;
  description: string | null;
  specs: SpecDocument[];
}

// --- Reviews ---

// A reviewer checklist item a test case declares (its stable id, a short title,
// and the prose a reviewer reads). Surfaced so the reviewer works through every
// major item. The UI prefixes a synthesized number to the title at display time.
export interface ReviewItem {
  id: string;
  title: string;
  text: string;
  // Optional paired reference view shown as the "expected" target, and proof id
  // whose submitted media is shown as "submitted", for this item. Null when the
  // item declares no pairing.
  reference?: string | null;
  proof?: string | null;
  // For a sprite-sheet asset-generation case: the sheet sequence slugs and frame
  // indices this item is about, so the reviewer UI can surface exactly those
  // animations/frames beside the item. Empty/undefined when the item names none
  // (it applies to the asset as a whole).
  sequences?: string[];
  frames?: number[];
  // Points this item is worth toward the run's score. Graded as a whole (no
  // sub-items): a pass earns this weight, a fail earns none. With sub-items: the
  // weight is split evenly across them and the item earns the fraction that
  // passed. A `graded` item (a game-jam category) is instead worth `weight × 10`
  // points and earns the graded tier's points times its weight.
  weight: number;
  // Whether the item is graded on the five-level scale (a game-jam category) rather
  // than pass/fail. The reviewer and verdict UIs render the emoji grade control and
  // score `weight × 10` points for it when true. Absent on a host that predates the
  // field; treated as false (a binary pass/fail item).
  graded?: boolean;
  // Optional scoring domain (by id) this item belongs to, or null/undefined for a
  // general item that belongs to no single domain.
  domain?: string | null;
  // Optional name-only sub-items breaking this item into independently graded
  // pass/fail points (an academic question's "2a", "2b"). When present, the
  // reviewer records a verdict per sub-item instead of one for the item; each
  // sub-item's verdict is keyed by the composite `<item id>.<sub id>` (see
  // `subItemVerdictId`). Empty/undefined for an item graded as a whole.
  subItems?: ReviewSubItem[];
}

// A sub-item of a review item: one independently graded pass/fail point. In the
// legacy grammar it is name-only (id + title); in the categories grammar it is the
// scored leaf — a review item under a category — carrying its own prose, weight,
// and paired reference/proof. Its verdict is keyed by the composite
// `<category id>.<item id>` (see `subItemVerdictId`).
export interface ReviewSubItem {
  id: string;
  title: string;
  // Optional prose the reviewer reads for this point (categories grammar). Absent
  // for a legacy name-only sub-item, whose parent item's `text` is the context.
  description?: string | null;
  // Points this sub-item is worth. The parent category's weight is the sum of its
  // sub-items' weights. Absent/undefined is treated as 1.
  weight?: number;
  // Optional paired reference view / proof id for this point (categories grammar
  // puts the pairing on the item rather than the category). Null when unpaired.
  reference?: string | null;
  proof?: string | null;
}

// A scoring domain a test case declares; a reviewer rates each independently and
// the run's overall rating is the worst across them.
export interface Domain {
  id: string;
  name: string;
  description: string;
}

export interface ReviewDocument {
  // The reviewer's rating for each of the case's scoring domains. The run's
  // overall rating is the worst across them.
  ratings: DomainRating[];
  writeup: string;
  checklist: ReviewVerdict[];
}

// One submitted review on a stored run, attributed to the account that wrote it.
// A run may carry more than one (one per account); the run's aggregate rating is
// the worst any reviewer gave any domain and its aggregate score the mean earned.
// Mirrors the per-review object the backend/worker `GET /runs/{id}` returns and
// the snapshot's `reviews[]` entries.
export interface StoredReview extends ReviewDocument {
  // The reviewing account's stable id.
  reviewerId: string;
  // The reviewer's display name, for attribution in the UI.
  reviewer: string;
  // The reviewer's username (login handle). Absent on the public snapshot, which
  // exposes only the display name.
  username?: string | null;
  // When the review was submitted (ISO-8601), when reported.
  reviewedAt?: string | null;
}

// A finished run held by a runner (a worker, or the local core in Tauri),
// awaiting review and/or publishing. Also the shape the backend serves for a
// *published* run (`GET /runs/{id}`): its record (links populated), every review
// submitted against it, and whether it has been published.
export interface StoredRun {
  id: string;
  record: RunRecord;
  // Every review submitted against the run (attributed to its author). Empty for
  // a pushed-but-unreviewed run.
  reviews: StoredReview[];
  // Whether the run has cleared the publish gate (a published run is publicly
  // visible). Worker-produced runs default to false until published.
  published: boolean;
}

// --- Accounts & auth ---

// A user account, as the auth service returns it (the worker proxies the call).
export interface Account {
  id: string;
  username: string;
  displayName: string;
}

// The auth service's register/login result: a bearer token plus the account it
// belongs to. Clients store the token and send `Authorization: Bearer <token>`
// on every mutating call (push/review/publish). Mirrors the worker's
// `POST /auth/{register,login}` response.
export interface AuthResult {
  token: string;
  account: Account;
}

// One page of published runs from the backend (`GET /runs`), newest first.
// `nextCursor` is the `before` value to pass for the following page, or null
// when there are no more.
export interface RunPage {
  runs: StoredRun[];
  nextCursor: string | null;
}

// --- Run execution (driven against a worker) ---

export interface LaunchConfig {
  testCase: string;
  version: string;
  variant: string;
  harness: string;
  modelId: string;
  // The built-in orchestrator slug that conducts the harness sessions. Defaults
  // to "one-shot" (a single session); a non-default orchestrator is accepted
  // only for the end-to-end test type.
  orchestrator: string;
  maxRuntimeOverride: number | null;
  // How many times the backend automatically retries this run after a terminal
  // infrastructure error or catastrophic (won't-load) build. Omit (undefined) to
  // accept the backend default of 1; a timeout or completed run is never retried.
  retryCount?: number;
}

// The terminal outcome of a publish. Publishing is **asynchronous**: the backend
// enqueues a per-publish job and the gh/wrangler release runs in a `tcab-publisher`
// Job, observed over a live stream that ends with this result. `published` is true
// when the release succeeded (the run is now public); `sourceRepo`/`playableBuild`
// carry the links the release produced (null when none — e.g. asset generation). On
// failure the transport rejects with the publisher's reason rather than resolving.
// The backend refuses (422) to enqueue a publish for a run carrying zero reviews —
// the editor gates the action on that.
export interface PublishResult {
  published: boolean;
  sourceRepo: string | null;
  playableBuild: string | null;
}

// A human-readable progress line streamed while a publish runs, surfaced so a
// console can show "Publishing…" advance (creating repo → pushing → deploying)
// rather than a frozen spinner. Mirrors the Rust `PublishProgress`
// (crates/core/src/publish_job_api.rs).
export interface PublishProgress {
  message: string;
}

// A live asset-generation preview frame, streamed as the model draws (mirrors the
// Rust `AssetPreview`, crates/core/src/preview.rs). It travels out of band from
// the recorded event feed — as the worker's `asset_preview` line on the event
// stream, or the desktop's `run://<id>/preview` channel — and is never persisted;
// a viewer renders `image` to watch the sprite take shape. Not part of the
// run-record contract.
export interface AssetPreview {
  // The frame this preview belongs to. A single sprite is always frame 0; a sprite
  // sheet uses the `draw-sheet --frame` index.
  frame: number;
  // Operations in the frame's log after this one — the frame's progress.
  operationCount: number;
  // The operation that produced this frame (e.g. `fill_rect`), when reported.
  operation?: string | null;
  // The frame's PNG, base64-encoded (no `data:` prefix; the viewer builds the URL).
  image: string;
  // The frame's current surface mesh, for a voxel run — the `PartMesh`-shaped
  // `mesh.json` the 3D viewer renders, so the live view can rebuild the part in 3D
  // and assemble the scene. Absent (null/undefined) for a 2D sprite run.
  mesh?: PartMesh | null;
  // The frame's current authored `system.json`, for a particle run — so the live
  // view can simulate the effect as it is authored, rather than show only the
  // rendered still. Arbitrary JSON on the wire (the receiver validates only that it
  // parses); the particle viewer treats it as a `ParticleSystem`. Absent for every
  // other kind.
  system?: unknown;
  // The frame's current whole-body `.glb`, for a skinned run (`mc-skin`/`sn-skin`/
  // `dc-skin`), base64-encoded (no `data:` prefix) — kept raw so its
  // `JOINTS_0`/`WEIGHTS_0` and skin survive, so the live view can deform it by
  // linear-blend skinning rather than show the undeformed rest mesh. Paired with
  // `rig`; absent for every other kind (a plain voxel run uses `mesh` instead).
  skinnedGlb?: string | null;
  // The frame's current `rig.json`, for a skinned run — the bones/joints/animations
  // the live view poses `skinnedGlb` with. Arbitrary JSON on the wire (the live view
  // maps it to the viewer's rig `ModelSpec`); absent for every other kind.
  rig?: unknown;
  // The frame's current clip `.wav`, for an audio run, base64-encoded (no `data:`
  // prefix; the viewer builds the URL) — so a watcher can play the clip as it is
  // built, the streamed PNG being the model's own waveform/spectrogram preview.
  // Absent for every other kind.
  audio?: string | null;
}

// One line of raw harness output, as recorded in a run's `raw.jsonl`. Mirrors
// the Rust `RawOutputLine` (crates/core/src/execution.rs). This is UI-only — it
// is not part of the run-record contract — and feeds the Events tab's raw view.
export interface RawOutputLine {
  stream: "stdout" | "stderr";
  line: string;
}

// A finished run's recorded event streams, for the run-detail Events tab. `events`
// is the normalized (TTC) stream the live feed renders. `raw` is the raw harness
// output it was mapped from, present only where a host can supply it (the runner
// hosts) and `null` where it isn't (the public site, which publishes TTC events
// only) — the tab hides the raw toggle whenever it is null.
export interface RunEventStreams {
  events: HarnessEvent[];
  raw: RawOutputLine[] | null;
}

// Transfer progress for a streamed download, reported as a recorded run's events
// load. `received` is the number of bytes read so far; `total` is the expected
// size from the response's `Content-Length`, or `null` when the server sends
// none (so the bar shows indeterminate progress rather than a false percentage).
export interface LoadProgress {
  received: number;
  total: number | null;
}

// A sink for {@link LoadProgress} ticks, passed into a streamed read so the
// caller can drive a progress bar. A transport that can't observe the transfer
// (e.g. Tauri IPC, which buffers the whole payload) simply never calls it.
export type ProgressCallback = (progress: LoadProgress) => void;

export type RunOutcome =
  | { kind: "completed"; record: RunRecord }
  | { kind: "failed"; message: string }
  // The run was killed by an operator before it finished (`POST /jobs/{id}/cancel`
  // moved it to the terminal `canceled` state). Distinct from `failed` so the
  // monitor reports an intentional stop rather than a fault.
  | { kind: "canceled"; message: string };

// The live state of a submitted run job.
export interface RunJob {
  runId: string;
  state: "running" | "completed" | "failed";
  record: RunRecord | null;
  message: string | null;
}

// A run a worker is currently executing, as `listActiveRuns` returns it (the web
// worker's `GET /runs/active`, the desktop `list_active_runs` command). A run only
// gains a RunRecord at completion, so an in-progress run is described by its launch
// identity instead. `state` is "running" off the wire; the console widens it to
// "failed" for a run it has locally observed fail before it dropped out of the
// list. This is the canonical shape; the gallery re-exports it as `InProgressRun`.
export interface InProgressRun {
  runId: string;
  testCaseSlug: string;
  testCaseVersion: string;
  variant: string;
  harnessSlug: string;
  modelId: string;
  // The run's live phase, mapped from the backend's fine-grained job state: still
  // waiting for a dispatcher slot ("queued"), deliberately held back because its
  // harness is at its parallelism cap ("pending"), spinning up the driver +
  // container ("starting"), executing ("running"), or locally observed to have
  // failed before it dropped out of the active list ("failed").
  state: "queued" | "pending" | "starting" | "running" | "failed";
}

// One harness's operator-tunable configuration, as `GET /harness-config` reports it
// (`slug`, display `name`, and the current knobs). Today the only knob is the
// maximum number of runs of the harness the Test Cabinet drives at once
// (`maxParallelism`, null = no limit). Edited from the Harnesses settings section.
export interface HarnessConfigEntry {
  slug: string;
  name: string;
  maxParallelism: number | null;
}

// A worker-wide run-completion notification, pushed to the console without
// polling (SSE over `GET /notifications` on web; a global Tauri event on desktop).
// Mirrors the worker's `WorkerNotification` / desktop `RunNotification` field for
// field, so both transports deserialize into this one type. `recordId` (the run to
// open) is present when `outcome` is "completed"; `message` (the reason) when
// "failed".
export interface RunNotification {
  kind: "run-completed";
  jobId: string;
  testCaseSlug: string;
  variant: string;
  harnessSlug: string;
  modelId: string;
  outcome: "completed" | "failed";
  recordId?: string | null;
  message?: string | null;
}

// --- Service identity (for the backend-consistency check) ---

// The backend a UI is pointed at, from `GET /healthz`. `id` identifies the
// backend instance so workers can be checked against it; it falls back to the
// normalized URL when the service reports none.
export interface BackendIdentity {
  id: string;
  url: string;
  version: string | null;
  storeReady: boolean;
}

// A worker's identity, including the backend it resolves definitions from and
// publishes to. Best-effort: the worker exposes no info endpoint yet, so this is
// often unavailable and the UI treats the worker's backend as unverified.
export interface WorkerIdentity {
  url: string;
  version: string | null;
  backendId: string | null;
}

// Whether a worker is bound to the same backend the UI is pointed at.
export type BackendMatch = "match" | "mismatch" | "unverified";
