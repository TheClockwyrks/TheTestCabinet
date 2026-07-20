import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AdversarialResult,
  AssetSheet,
  ControllerRef,
  MatchSummary,
  MediaKind,
  ModelSpec,
  NineSlice,
  RunRecord,
  RunSubject,
  TournamentRecord,
} from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import {
  parseGlb,
  parseSkinnedGlb,
  type PartMesh,
  type SkinnedMesh,
} from "@test-cabinet/voxel-runtime";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type {
  ProgressCallback,
  ProofMedia,
  RunEventStreams,
  StoredReview,
} from "../../client/types";
import { type ParsedWriteup, parseWriteup, subItemVerdictId } from "./ratings";
import { extensionFor } from "./proofMedia";
import { findModelByModelId, type ModelSummary } from "./models";
import type {
  DomainSummary,
  ReviewItemSummary,
  TestCaseSummary,
} from "./testCases";
import type { RunQuery, RunQueryResult } from "./runQuery";

/**
 * The load state of the test-case catalog. `"loading"` while the host is still
 * resolving it from its backend, `"ready"` once resolved (the catalog may still
 * be empty), and `"error"` when the host could not reach its source at all — so a
 * host with no reachable backend reads as an error rather than an empty catalog.
 * Hosts whose catalog is static (the public site) are always `"ready"`.
 */
export type CatalogStatus = "loading" | "ready" | "error";

/**
 * A run's detail payload, resolved lazily by id: the full {@link RunRecord} plus
 * every review submitted against it. A summary-first gallery no longer holds the
 * full records or the per-reviewer breakdown in memory, so the run-detail layer
 * fetches both together — the record for the tabs and the {@link StoredReview}s for
 * the Verdict/review/editor surfaces. See {@link GalleryDataInput.readRun} and
 * {@link GalleryData.fetchRun}.
 */
export interface RunDetail {
  record: RunRecord;
  reviews: StoredReview[];
}

/** The scoring model for a run: the variant's weighted checklist items and its
 * effective scoring domains (the case's common domains + the variant's own),
 * resolved from the catalog. Both empty when the case is not in the catalog this
 * host holds. */
export interface ReviewModel {
  items: ReviewItemSummary[];
  domains: DomainSummary[];
}

// The gallery's data source, injected by the host app. The same routed UI lives
// in `@test-cabinet/ui`, but its data differs per app: the static site builds
// this from the build-time public snapshot; the web/desktop consoles build it
// live from a backend (catalog + published runs) and a worker (in-progress and
// produced runs). Pages read it through the existing data hooks
// (`queryRunSummaries`/`useCaseRunSummaries`, `useTestCases`, `findReview`), which
// resolve to this context — so page logic is unchanged regardless of where the
// data comes from.

// A run currently executing on a worker. A run only gains a `RunRecord` at
// completion, so an in-progress run is represented by its launch identity and
// live state instead. It is shown ahead of the completed runs in the list. Live
// in-progress runs are tracked in the runs runtime (see runtime/runsRuntime),
// not in this data value, since they change as a session launches runs. The shape
// is the worker's active-run row, so it is defined once in the client layer.
export type { InProgressRun } from "../../client/types";

/**
 * The adversarial-arena capability, supplied only by a host that can run and read
 * head-to-head matches and tournaments — the consoles when a worker is connected.
 * The static site omits it, so the arena UI hides. Run methods (`runMatch`,
 * `runTournament`) additionally require {@link GalleryDataInput.canExecute}; the
 * read methods only need this object to be present. Each host wires its own
 * transport behind these: the web host runs matches/tournaments on the dedicated
 * `tcab-arena` service and reads persisted tournaments and replays from the backend
 * (there are no run-local controllers in the web topology — only baselines and
 * pushed controllers are resolvable there); the desktop host invokes the local
 * core's Tauri commands and channels, where a single built-in local worker can also
 * resolve a `"run"` controller from its own output dir.
 */
/** A worker the arena can run matches/tournaments on. The web host presents a single
 * fixed execution host (the arena service); the desktop host has a single built-in
 * local worker. */
export interface ArenaWorkerOption {
  /** Stable id (the local worker uses the reserved id `"local"`). */
  id: string;
  /** Display label. */
  label: string;
}

export interface ArenaApi {
  /** The workers this host can run matches on, so the arena can offer a worker to
   * pick. The desktop host resolves a controller of kind `"run"` against its local
   * worker's output dir; the web host has none of those (its single arena-service
   * host resolves only baselines and pushed controllers). Pushed and baseline
   * controllers resolve the same on any host. */
  listWorkers(): ArenaWorkerOption[];
  /** The controllers available to pit for a case: the committed baselines, the
   * chosen worker's produced adversarial runs (kind `"run"`, desktop only), and the
   * case's pushed adversarial controllers (kind `"pushed"`). `workerId` selects which
   * worker contributes its local runs (defaults to the active worker). */
  listControllers(
    slug: string,
    version: string,
    workerId?: string,
  ): Promise<ControllerRef[]>;
  /** Run one transient head-to-head match on `workerId` (defaults to the active
   * worker) and return its replay (for immediate playback) and summary. Nothing is
   * persisted. */
  runMatch(input: {
    testCase: string;
    version: string;
    red: ControllerRef;
    blue: ControllerRef;
    workerId?: string;
  }): Promise<{ replay: unknown | null; summary: MatchSummary }>;
  /** Start a tournament over the chosen field on `workerId` (defaults to the active
   * worker); resolves to its id. The field runs in the background — observe it with
   * {@link subscribeTournament}, passing the same `workerId`. */
  runTournament(input: {
    testCase: string;
    version: string;
    variant: string;
    participants: ControllerRef[];
    workerId?: string;
  }): Promise<string>;
  /** Observe a running tournament on `workerId` (the worker it was started on):
   * each completed match arrives on `onProgress`, and `onDone` fires once with the
   * finished record (or an error message). Returns an unsubscribe function. */
  subscribeTournament(
    id: string,
    handlers: {
      onProgress: (progress: {
        played: number;
        total: number;
        summary: MatchSummary;
      }) => void;
      onDone: (record: TournamentRecord | null, error?: string) => void;
      onError?: (error: unknown) => void;
    },
    workerId?: string,
  ): () => void;
  /** The tournaments this host can show, newest first. */
  listTournaments(): Promise<TournamentRecord[]>;
  /** One persisted tournament by id. */
  readTournament(id: string): Promise<TournamentRecord>;
  /** The loadable URL of one match's replay, or null when this host cannot serve
   * it (so the match's Replay control is disabled). */
  tournamentReplayUrl(tournamentId: string, matchId: string): string | null;
}

/**
 * The harness-authentication capability, supplied only by a host that manages
 * harness credentials for the runs it launches — today the Tauri desktop app,
 * which stands up a local cluster and must give each run's harness an API key or
 * a subscription. The web console (which enqueues against a backend an operator
 * has already credentialed) and the static site omit it, so the Authentication
 * settings section is hidden there. The desktop host wires its implementation over
 * Tauri IPC to the embedded core; see the shell's `harness_auth` commands.
 */
export type HarnessAuthMode = "auto" | "subscription" | "api-key";

/** One subscription credential file's host status (whether the user is signed in
 * with the harness CLI), for the authentication settings UI. */
export interface SubscriptionFile {
  /** Where the file is expected on the host (resolved from the environment). */
  hostPath: string;
  /** The data key this file occupies in the cluster subscription Secret. */
  secretKey: string;
  /** Whether the file exists on the host right now. */
  present: boolean;
  /** Whether the subscription requires this file (versus an optional one). */
  required: boolean;
}

/** One harness's authentication state. Never carries the API key value itself —
 * only whether one is set and where it came from. */
export interface HarnessAuth {
  /** The harness slug (for example `claude`). */
  slug: string;
  /** The human-readable harness name. */
  name: string;
  /** The host provider key variable (for example `ANTHROPIC_API_KEY`), or null for
   * a subscription-only harness with no API-key mode. */
  apiKeyEnv: string | null;
  /** Whether the harness supports API-key authentication. */
  supportsApiKey: boolean;
  /** Whether the harness supports subscription authentication. */
  supportsSubscription: boolean;
  /** The selected authentication method. */
  selectedMode: HarnessAuthMode;
  /** Whether an API key is available (override or discovered from the host). */
  apiKeySet: boolean;
  /** Where the key comes from: `override`, `dotenv:<file>`, `env`, or `none`. */
  apiKeySource: string;
  /** The subscription credential files this harness reads, with host status. */
  subscriptionFiles: SubscriptionFile[];
  /** Whether every required subscription file is present on the host. */
  subscriptionPresent: boolean;
  /** Readiness for the selected mode: `ready`, `needs-key`, `needs-sign-in`,
   * `needs-credentials`, or `unsupported`. */
  readiness: string;
}

export interface HarnessAuthApi {
  /** Every harness's current authentication state. */
  list(): Promise<HarnessAuth[]>;
  /** Lock (or reset to `auto`) a harness's method; resolves to the refreshed list. */
  setAuthMode(slug: string, mode: HarnessAuthMode): Promise<HarnessAuth[]>;
  /** Set (or clear, with `null`) a harness's API key; resolves to the refreshed
   * list. The value is sent to the host and never held in the gallery state. */
  setApiKey(slug: string, key: string | null): Promise<HarnessAuth[]>;
  /** Re-read the host's signed-in subscription files into the cluster; resolves to
   * the refreshed list. */
  refreshSubscription(slug: string): Promise<HarnessAuth[]>;
}

/**
 * One automated-validation media output resolved for display: a debug script's
 * declared output, captured twice — from the model's build (the *actual*) and from
 * the case's reference implementation (the *baseline*) — each as a loadable URL (or
 * null when it was not produced, or the host cannot serve it). The reviewer shows
 * the two side by side for the verdict unit the script backs. See {@link
 * GalleryData.validationMediaFor}.
 */
export interface ValidationMedia {
  /** The review item this output belongs to. */
  itemId: string;
  /** The sub-item this output backs when it is a per-sub-item driver, or null when the
   * whole item is validated. */
  subItemId: string | null;
  /** The verdict unit this output backs — the item's own id, or the composite
   * `<item>.<sub>` for a sub-item. The join key the reviewer groups media by, so a
   * proof pair sits beside the exact verdict (item or sub-item) it proves. */
  verdictId: string;
  /** The output id, unique within its script. */
  id: string;
  /** Human-readable display name, carried through from the declared output. */
  name: string;
  /** Whether the output is an image or a video clip. */
  kind: MediaKind;
  /** The model build's captured output (run-scoped), or null when it was not
   * produced/served. */
  actualUrl: string | null;
  /** The reference implementation's captured output — a fixed, **case-scoped**
   * property of the case version (synthesized once at publish-reference time),
   * resolved from the catalog rather than the run tree. Null when the case ships no
   * baseline for this output, or the host cannot serve case-scoped media. */
  baselineUrl: string | null;
}

// The value each host builds and provides. `findReview` is derived by the
// provider from `writeups`, so hosts do not supply it.
export interface GalleryDataInput {
  /**
   * The summary cards for runs sourced locally (produced but not yet published) —
   * the console's worker worklist, derived into cards (see `toRunSummary`). The
   * published set is never held whole: pages fetch it a page at a time through
   * {@link queryRunSummaries}. These local cards are exposed separately so a paged
   * page can PIN them (they never appear in the backend's numbered
   * `queryRunSummaries` window) to the first page ahead of the queried published
   * rows. Empty on the static site (which has no produced runs, except dev-only
   * on-disk ones) and whenever the host holds none. Full records are fetched lazily
   * by id via {@link readRun}/{@link GalleryData.fetchRun} only when a detail view
   * needs one.
   */
  producedSummaries: RunSummary[];
  /** Ids of runs sourced locally (produced but not yet published). */
  localIds: ReadonlySet<string>;
  /**
   * Raw writeups keyed by run id — the `---\nrating: …\n---\n\n<body>` framing
   * `parseWriteup` reads. Holds both published reviews and local previews. A run
   * carrying more than one review is framed into an *aggregate* writeup here (the
   * worst rating any reviewer gave each domain, the strictest checklist verdict,
   * and the writeups concatenated) so the cards, leaderboard, and badges show the
   * aggregate verdict. The individual reviews are carried separately in
   * {@link reviews} for the run-detail page.
   */
  writeups: Readonly<Record<string, string>>;
  /**
   * The submitted reviews keyed by run id, each attributed to its author. Drives
   * the run-detail page's per-reviewer breakdown and the aggregate rating/score.
   * A pushed-but-unreviewed run (or one with no reviews) has none. Hosts that
   * carry only the framed {@link writeups} (none today) may leave this empty.
   */
  reviews: Readonly<Record<string, StoredReview[]>>;
  /** True while the run list is still loading. */
  runsLoading: boolean;
  /** The test-case catalog. */
  testCases: TestCaseSummary[];
  /** The catalog's load state, so the UI can tell loading and an unreachable
   * backend apart from a genuinely empty catalog. See {@link CatalogStatus}. */
  testCasesStatus: CatalogStatus;
  /** The model catalog: curated configs merged with the models recorded runs
   * reference, each with its price history. The console fetches it from the
   * backend; the static site reads it from the snapshot. */
  models: ModelSummary[];
  /** The model catalog's load state (see {@link CatalogStatus}). */
  modelsStatus: CatalogStatus;
  /**
   * Whether this UI can launch, monitor, review, and publish runs. False on the
   * static gallery site; true in the web and desktop consoles. Gates the
   * run-execution UI (new-run button, live monitor, editable review, the
   * connections drawer).
   */
  canExecute: boolean;
  /**
   * Answer one page of a filtered/sorted summary query — the host-agnostic paged
   * listing the run-log pages drive. The console forwards it to the backend's
   * offset endpoint (`GET /runs?fields=summary&offset=…`), which filters, sorts,
   * and windows server-side and returns the matching `total`; the static site has
   * no backend, so it answers from its in-memory summary index with the same
   * semantics (see `runSummaryPage`). Both resolve the sorted window plus the count
   * of all matching rows, so a numbered pager sizes identically on either host.
   * Only published runs are queryable this way — a console pins its
   * {@link producedSummaries} separately.
   */
  queryRunSummaries: (query: RunQuery) => Promise<RunQueryResult>;
  /**
   * Fetch a finished run's recorded event streams for the run-detail Events tab.
   * Each host sources these its own way (the static site from a published asset,
   * the consoles from their worker/backend clients). Resolves `null` when the
   * host cannot provide events for the run at all (vs. an empty `events` array,
   * which means the run recorded none). Omitted by a host that supports no
   * events at all. `onProgress`, when supplied, reports transfer progress as a
   * (possibly large) stream downloads, for the tab's progress bar; a host that
   * can't observe the transfer simply never calls it.
   */
  fetchRunEvents?: (
    runId: string,
    onProgress?: ProgressCallback,
  ) => Promise<RunEventStreams | null>;
  /**
   * Resolve one run's full record by id, directly from the host's store. The
   * gallery no longer holds full records in memory — pages fetch summary cards a
   * page at a time — so a detail view fetches the whole record lazily through this: the
   * console reads the run store's `GET /runs/{id}` (worker for a local run, backend
   * otherwise); the static site fetches the per-run record asset the snapshot
   * emitted. Resolves `null` when no run with that id is available. Omitted by a
   * host that cannot serve a run by id.
   *
   * Resolves the run's {@link RunDetail} — the record *and* every review submitted
   * against it — so the detail layer reads reviews from here rather than the
   * console's global {@link reviews} map (which now carries only local runs).
   */
  readRun?: (runId: string) => Promise<RunDetail | null>;
  /**
   * Resolve the loadable URL for one run's proof media file (`<proof-id>.<ext>`),
   * or null when the host cannot serve it (so the UI shows presence only). Each
   * host wires its own source: the consoles point at the backend (published) or
   * worker (produced) proof endpoint, the static site at the snapshot asset.
   * Omitted by a host that serves no proof media.
   */
  proofMediaUrl?: (runId: string, file: string) => string | null;
  /**
   * Resolve the loadable URL for one asset-generation run's media file — a single
   * sprite's `regenerated.png`/`preview.png`/`target.png`/`actions.json`, or a
   * sprite sheet's per-frame `regenerated-<index>.png` (etc.) — or null when the
   * host cannot serve it. Each host wires its own source the same way it
   * wires {@link proofMediaUrl}: the consoles point at the backend (published) or
   * worker (produced) asset endpoint, the static site at the snapshot asset.
   * Omitted by a host that serves no asset media.
   */
  assetMediaUrl?: (runId: string, file: string) => string | null;
  /**
   * Resolve the loadable URL for one run's **actual** automated-validation media
   * file — a debug script's synthesized `<item>__<output>.<ext>`, captured from the
   * model's build — or null when the host cannot serve it. Run-scoped, wired the
   * same way {@link proofMediaUrl} and {@link assetMediaUrl} are: the consoles point
   * at the backend (published) or worker (produced) validation endpoint, the static
   * site at the snapshot asset. Omitted by a host that serves no validation media.
   */
  validationMediaUrl?: (runId: string, file: string) => string | null;
  /**
   * Resolve the loadable URL for one case variant's **baseline** validation media
   * file — the `<item>__<output>.<ext>` a debug script produced from the reference
   * implementation. Unlike {@link validationMediaUrl} this is **case-scoped**: the
   * baseline is a fixed property of the case version (synthesized once at
   * publish-reference time and committed under the version folder), so it is keyed by
   * the run's {@link RunSubject} (slug/version/variant) rather than the run id, and
   * served by the backend's `/test-cases/.../validation-baseline/...` route — the way
   * {@link TestCaseSummary.referenceScreenshots} are resolved. Null / omitted when
   * the host cannot serve case-scoped media.
   */
  validationBaselineUrl?: (subject: RunSubject, file: string) => string | null;
  /**
   * The adversarial-arena capability, present only on a host that can run and read
   * matches and tournaments (the consoles with a worker). Omitted by the static
   * site, which hides the arena UI entirely. See {@link ArenaApi}.
   */
  arena?: ArenaApi;
  /**
   * The harness-authentication capability, present only on a host that manages
   * harness credentials for the runs it launches (the Tauri desktop app). Omitted
   * by the web console and the static site, which hide the Authentication settings
   * section. See {@link HarnessAuthApi}.
   */
  harnessAuth?: HarnessAuthApi;
}

/**
 * One frame of an asset-generation run, resolved for display: the regenerated
 * image (reviewed against the brief), the model's final preview, and the recorded
 * action log — each as a loadable URL (or null when the host cannot serve it) —
 * alongside the recorded cheat-divergence signal.
 */
export interface AssetFrameView {
  /** The frame index: `0` for a single sprite, the declared index for a sheet. */
  index: number;
  regeneratedUrl: string | null;
  previewUrl: string | null;
  actionsUrl: string | null;
  /** Divergence of the regenerated image from the preview, or null if unmeasured. */
  cheatDivergence: number | null;
  /** How many operations the recorded log holds. */
  operationCount: number;
  /** Detail about anything that could not be evaluated, or null. */
  detail: string | null;
}

/**
 * An asset-generation run's result, resolved for display: one frame for a single
 * sprite, one per declared frame for a sprite sheet (each a separate image,
 * reviewed against the brief).
 */
export interface AssetResultView {
  /** The per-frame results, in declared order. */
  frames: AssetFrameView[];
  /** Detail about anything that could not be evaluated at the run level, or null. */
  detail: string | null;
  /**
   * The sprite-sheet frame dimensions and named sequences, present only when the
   * case draws a sprite sheet. The UI plays the named animations from the
   * per-frame images; absent for a single-sprite run.
   */
  sheet: AssetSheet | null;
}

/**
 * One part of a voxel asset-generation run, resolved for display: the
 * `PartMesh`-shaped per-part `.glb` the 3D viewer poses, the model's own isometric
 * preview PNG (reviewed against the brief and used as the WebGL/reduced-motion
 * fallback), and the recorded operation log — each as a loadable URL (or null when
 * the host cannot serve it). Cheat detection is retired for the voxel family, so —
 * unlike the sprite {@link AssetFrameView} — a voxel part carries no regenerated
 * image and no cheat divergence. The 3D analog of {@link AssetFrameView}.
 */
export interface VoxelPartView {
  /** The part name: `model` for a static model, the declared part for animation. */
  name: string;
  /** The per-part `.glb` for this part (the `PartMesh` geometry fed to the 3D viewer). */
  meshUrl: string | null;
  /** The model's own isometric preview PNG (also the WebGL/reduced-motion fallback). */
  previewUrl: string | null;
  /** The recorded operation log for this part. */
  actionsUrl: string | null;
  /** How many operations the recorded log holds. */
  operationCount: number;
  /** How many occupied voxels the regenerated part contains. */
  voxelCount: number;
  /** Detail about anything that could not be evaluated, or null. */
  detail: string | null;
}

/**
 * A voxel asset-generation run's result, resolved for display: one part for a
 * static model, one per declared part for an animated (rigged) model. The rig
 * structure travels inline in the run record (the {@link ModelSpec}), so the
 * viewer poses it directly; only each part's `.glb` is fetched (see
 * {@link GalleryData} `useVoxelArtifacts`). The 3D analog of {@link AssetResultView}.
 */
export interface VoxelResultView {
  /** Whether this is an animated (rigged) model versus a static single model. */
  animated: boolean;
  /**
   * Whether this is a **skinned** run (`mc-skinned`/`sn-skinned`/`dc-skinned`): one
   * continuous mesh bound to the rig and deformed by linear-blend skinning, rather
   * than the rigid per-part posing of the other voxel-family kinds. When set, the
   * viewer decodes the single skinned mesh (see {@link skinnedMeshUrl}) and drives it
   * through the runtime's skinning API instead of posing per-part meshes.
   */
  skinned: boolean;
  /**
   * Whether this is a **Blender** run (`blender-character`/`blender-prop`/
   * `blender-mechanism`): the emitted mesh is a self-contained native glTF whose rig and
   * animations (if any) are baked into the file. The viewer loads its glTF with a native
   * glTF player (skeleton and/or baked clips) rather than posing the mesh from an inline
   * `rig.json`. A character is additionally `skinned`; a static prop and a rigid
   * mechanism are not. `false` for every non-Blender run.
   */
  blender: boolean;
  /**
   * The single `.glb` the native/skinned viewer loads whole (the first — and only —
   * part's mesh), or null otherwise (or when the host cannot serve it). For a skinned
   * run it is decoded with `parseSkinnedGlb` into the {@link SkinnedMesh} the skinned
   * viewer poses; for ANY Blender run (character/prop/mechanism) it is the emitted native
   * glTF (`character.glb` or `model.glb`), loaded whole by the native glTF player.
   */
  skinnedMeshUrl: string | null;
  /**
   * The full rig the model produced (`rig.json` — the required parts/joints plus
   * any the model added), which the viewer poses and a game drives. Null for a
   * static model (the caller synthesizes a trivial single-part rig).
   */
  rig: ModelSpec | null;
  /**
   * The required rig the case declared (the game-facing joint interface reviewers
   * score against). Null for a static model.
   */
  model: ModelSpec | null;
  /** The per-part results, in declared order (exactly one for a static model). */
  parts: VoxelPartView[];
  /** Detail about anything that could not be evaluated at the run level, or null. */
  detail: string | null;
}

/**
 * A UI element resolved for display: its emitted flattened PNG (reviewed against the
 * brief), decoded dimensions, and any authored nine-slice (whose stretchable region
 * the review UI previews).
 */
export interface UiElementView {
  /** The element name (`canvas` for a single-image case, else the kit element). */
  name: string;
  /** Loadable URL of the emitted flattened RGBA PNG, or null if unservable. */
  imageUrl: string | null;
  /** Decoded pixel width. */
  width: number;
  /** Decoded pixel height. */
  height: number;
  /** The authored nine-slice insets, or null when the element has none. */
  nineSlice: NineSlice | null;
  /** Detail about anything that could not be evaluated for this element, or null. */
  detail: string | null;
}

/** A `ui` run's result resolved for display: one element for a single-image case,
 * one per declared element for a kit. */
export interface UiResultView {
  elements: UiElementView[];
  detail: string | null;
}

/** One PBR map channel resolved for display. */
export interface MaterialMapView {
  /** The channel name (`base-color`, `normal`, `roughness`, …). */
  name: string;
  /** Loadable URL of the emitted map PNG, or null if unservable. */
  imageUrl: string | null;
  /** The color space the map is tagged with (`srgb` / `linear`). */
  colorSpace: string;
  /** Detail about anything that could not be evaluated for this map, or null. */
  detail: string | null;
}

/** A `material` run's result resolved for display: its per-map images, the map
 * resolution, and the base-color image (surfaced for the 2×2 tiling + lit preview). */
export interface MaterialResultView {
  maps: MaterialMapView[];
  /** The maps' square resolution in pixels. */
  size: number;
  /** The suggested world-space tiling scale, or null when the material declares none. */
  tiling: number | null;
  /** Loadable URL of the `base-color` map — the albedo the 2×2 tiling and the lit
   * 3D preview lead with — or null when absent/unservable. */
  baseColorUrl: string | null;
  detail: string | null;
}

/** A particle run's result resolved for display: the emitted `system.json` (simulated
 * live in the review UI) and the rendered preview GIF fallback. */
export interface ParticleResultView {
  /** Loadable URL of the emitted `system.json`, or null if unservable. */
  systemUrl: string | null;
  /** Loadable URL of the rendered preview animation (`effect.gif`), or null. */
  previewUrl: string | null;
  /** How many emitters the authored system declares. */
  emitterCount: number;
  detail: string | null;
}

/** An audio run's result resolved for display: the emitted clip (played with an
 * `<audio>` element), the optional MIDI score, and the rendered preview PNG. */
export interface AudioResultView {
  /** Loadable URL of the emitted PCM `clip.wav`, or null if unservable. */
  clipUrl: string | null;
  /** Loadable URL of the portable `clip.mid` score (`music` runs), or null. */
  midiUrl: string | null;
  /** Loadable URL of the rendered waveform/spectrogram (+ piano-roll) preview PNG. */
  previewUrl: string | null;
  /** The decoded sample rate in Hz. */
  sampleRate: number;
  /** The decoded channel count (1 = mono, 2 = stereo). */
  channels: number;
  /** The decoded clip length in milliseconds. */
  durationMs: number;
  detail: string | null;
}

/**
 * An adversarial run's canonical-match result, resolved for display: the
 * loadable URL of the published, browser-playable replay (or null when the host
 * cannot serve it) alongside the recorded match record (opponent, sides, winner,
 * scores, how/when it ended, and the outcome from the submission's perspective).
 *
 * The replay PLAYER itself ships with the bundle (the foray-core wasm renderer
 * and sprite sheet are one set, not per run), so only the run-specific
 * `replay.json` is resolved here.
 */
/** One opponent's proof match resolved for display: its record plus the loadable
 * replay URL. */
export interface ReplayMatchView {
  /** The opponent the submission was matched against (Blue). */
  opponent: string;
  /** Loadable URL of this match's replay JSON, or null if it cannot be served. */
  replayUrl: string | null;
  /** The winning side, or null for a draw. `"red"` is the submission. */
  winner: AdversarialResult["winner"];
  /** The submission's (Red's) banked score at the end of the match. */
  redScore: number;
  /** The opponent's (Blue's) banked score at the end of the match. */
  blueScore: number;
  /** How the match ended (e.g. `"swept"`, `"time_limit"`, `"forfeit"`). */
  ended: string;
  /** How many ticks the match ran for. */
  ticks: number;
  /** The outcome from the submission's perspective. */
  outcome: AdversarialResult["outcome"];
  /** Whether this match's outcome counts as recorded evidence (`false` for an
   * exhibition opponent like `random`). */
  scored: boolean;
  /** Detail about a forfeit, or null. */
  detail: string | null;
}

export interface ReplayResultView {
  /** Which side the submission played (always `"red"`). */
  submissionTeam: AdversarialResult["submissionTeam"];
  /**
   * One proof match per reference opponent the submission was replayed against,
   * canonical (`border-soldier`) first. For a forfeit run that never played a
   * match this holds a single synthesized record whose `replayUrl` is null.
   */
  replays: ReplayMatchView[];
}

/** One scored case resolved for playback: what to load, and what to check it against. */
export interface PerformanceScenarioView {
  /** The case's position in the manifest, which its scenario is addressed by. */
  caseIndex: number;
  /** The case-relative input path, so a viewer can tell the scenarios apart. */
  input: string;
  /** Loadable URL of the scored scenario, or null if it cannot be served. */
  scenarioUrl: string | null;
  /** The fuel the engine burned on this case. */
  fuel: number | null;
}

/** A performance run's playable scenarios. */
export interface PerformancePlaybackView {
  /** Whether the run passed every scored case. */
  correct: boolean;
  /** One entry per case the engine got right; empty when none did. */
  scenarios: PerformanceScenarioView[];
}

export interface GalleryData extends GalleryDataInput {
  /**
   * Resolve a run's review. A caller-supplied `override` map (a run's local
   * writeups) takes precedence over the provided `writeups`. Returns undefined
   * when the run has no writeup at all.
   */
  findReview(
    runId: string,
    override?: Readonly<Record<string, string>>,
  ): ParsedWriteup | undefined;
  /**
   * Resolve one run's full record by id — a summary-first page fetches the whole
   * record lazily only when a detail view needs it. Delegates to the host's
   * {@link GalleryDataInput.readRun}, resolving the run's {@link RunDetail} —
   * record + reviews — so the detail layer frames the review from these rather than
   * the global map. Resolves `null` when the host supplies no `readRun` or no run
   * with that id is available.
   */
  fetchRun(runId: string): Promise<RunDetail | null>;
  /**
   * The individual reviews submitted against a run, in submission order. Empty
   * when the run has none (or the host carries only framed writeups). The
   * run-detail page renders each reviewer's verdict and computes the aggregate
   * rating ({@link aggregateRating}) and score ({@link aggregateScore}) from
   * these.
   */
  reviewsFor(runId: string): StoredReview[];
  /**
   * The run's submitted proof-of-implementation media, derived from its recorded
   * `validation.proofs` and resolved to loadable URLs via {@link proofMediaUrl}.
   * Each entry carries the recorded presence; `url` is null when the media cannot
   * be served. Empty when the run declares no proofs.
   */
  proofMediaFor(run: RunRecord): ProofMedia[];
  /**
   * The run's automated-validation media, one entry per debug-script output,
   * carrying the item it backs and the actual/baseline URLs resolved via
   * {@link validationMediaUrl}. Each URL is null when the side was not produced or
   * the media cannot be served here. Empty when the run declares no debug scripts.
   */
  validationMediaFor(run: RunRecord): ValidationMedia[];
  /**
   * An asset-generation run's result resolved for display, or null when the run
   * is not asset-generation (its `validation.asset` is absent). Media URLs are
   * resolved via {@link assetMediaUrl}.
   */
  assetResultFor(run: RunRecord): AssetResultView | null;
  /**
   * A voxel asset-generation run's result resolved for display, or null when the
   * run is not a voxel run (its `validation.voxel` is absent). Media URLs (the
   * per-part `.glb` and isometric PNGs) are resolved via
   * {@link assetMediaUrl}; the rig structure travels inline in the run record.
   */
  voxelResultFor(run: RunRecord): VoxelResultView | null;
  /**
   * A `ui` asset-generation run's result resolved for display, or null when the run
   * is not a `ui` run (its `validation.ui` is absent). Element image URLs are
   * resolved via {@link assetMediaUrl}.
   */
  uiResultFor(run: RunRecord): UiResultView | null;
  /**
   * A `material` asset-generation run's result resolved for display, or null when
   * the run is not a `material` run (its `validation.material` is absent). Map image
   * URLs are resolved via {@link assetMediaUrl}.
   */
  materialResultFor(run: RunRecord): MaterialResultView | null;
  /**
   * A particle asset-generation run's result resolved for display, or null when the
   * run is not a particle run (its `validation.particle` is absent). The
   * `system.json` and preview URLs are resolved via {@link assetMediaUrl}.
   */
  particleResultFor(run: RunRecord): ParticleResultView | null;
  /**
   * An audio asset-generation run's result resolved for display, or null when the
   * run is not an audio run (its `validation.audio` is absent). The clip, MIDI, and
   * preview URLs are resolved via {@link assetMediaUrl}.
   */
  audioResultFor(run: RunRecord): AudioResultView | null;
  /**
   * An adversarial run's canonical-match result resolved for display, or null
   * when the run is not adversarial (its `validation.adversarial` is absent). The
   * replay URL is resolved via {@link assetMediaUrl}, the same per-run asset
   * plumbing asset-generation media uses.
   */
  replayResultFor(run: RunRecord): ReplayResultView | null;
  /**
   * Resolve a performance run's playable scenarios — one per case its engine got
   * right, each with the loadable scenario URL browser playback re-simulates.
   * Null when the run is not a performance run; an empty list when no case passed. Scenario URLs are resolved
   * via {@link assetMediaUrl}, the same per-run asset plumbing an adversarial
   * replay uses.
   */
  performancePlaybackFor(run: RunRecord): PerformancePlaybackView | null;
  /**
   * The scoring model for a run's subject: the effective (common + variant)
   * weighted checklist items and the effective (common + variant) scoring
   * domains, resolved from the catalog this host holds. Items and domains are
   * empty when the case is not in the catalog. Lets the verdict page and the
   * leaderboard score a run from its review verdicts and per-domain ratings.
   */
  reviewModelFor(subject: RunSubject): ReviewModel;
  /**
   * Resolve a run's `modelId` (optionally with its harness slug, for harness-aware
   * canonicalization) to its catalog entry, over the loaded model catalog. Returns
   * undefined for an id the catalog does not cover.
   */
  modelForId(modelId: string, harnessSlug?: string): ModelSummary | undefined;
  /**
   * Resolve a Models-section URL parameter — a curated slug or any covered/alias
   * id — to its catalog entry. Returns undefined when nothing matches.
   */
  modelForSlug(slug: string): ModelSummary | undefined;
}

const GalleryDataContext = createContext<GalleryData | null>(null);

export function GalleryDataProvider({
  value,
  children,
}: {
  value: GalleryDataInput;
  children: ReactNode;
}) {
  const full = useMemo<GalleryData>(() => {
    const {
      writeups,
      reviews,
      proofMediaUrl,
      assetMediaUrl,
      validationMediaUrl,
      validationBaselineUrl,
      testCases,
      models,
    } = value;
    return {
      ...value,
      findReview(runId, override) {
        const raw = override?.[runId] ?? writeups[runId];
        return raw === undefined ? undefined : parseWriteup(raw);
      },
      fetchRun(runId) {
        // The gallery holds no full records in memory anymore — only summary
        // cards — so a detail view resolves the whole record lazily through the
        // host's single-run fetcher (the console reads `GET /runs/{id}`, the static
        // site fetches the emitted per-run record asset). A host that supplies none
        // resolves to null.
        return value.readRun ? value.readRun(runId) : Promise.resolve(null);
      },
      modelForId(modelId, harnessSlug) {
        return findModelByModelId(models, modelId, harnessSlug);
      },
      modelForSlug(slug) {
        return models.find(
          (model) =>
            model.slug === slug ||
            model.modelIds.includes(slug) ||
            model.aliases.some((a) => a.slug === slug),
        );
      },
      reviewsFor(runId) {
        return reviews[runId] ?? [];
      },
      reviewModelFor(subject) {
        const testCase = testCases.find((c) => c.slug === subject.testCaseSlug);
        const variant = testCase?.variants.find(
          (v) => v.slug === subject.variant,
        );
        return {
          items: variant?.reviewItems ?? [],
          // The variant's effective scoring domains (common + its own). Falls back
          // to the case's common domains when the variant can't be resolved.
          domains: variant?.domains ?? testCase?.domains ?? [],
        };
      },
      proofMediaFor(run) {
        return run.validation.proofs.map((proof) => ({
          id: proof.id,
          name: proof.name,
          kind: proof.kind,
          present: proof.present,
          url:
            proof.present && proofMediaUrl
              ? proofMediaUrl(run.id, `${proof.id}.${extensionFor(proof.dest)}`)
              : null,
        }));
      },
      validationMediaFor(run) {
        const media: ValidationMedia[] = [];
        // Each debug script's outputs share one flat name, `<verdict>__<outputId>.<ext>`,
        // with the extension fixed by the output's kind — `png` for a still, `webm`
        // for a clip. The verdict id is the item's own id, or the composite
        // `<item>.<sub>` for a per-sub-item driver, so a sub-item's proof is addressed
        // (and grouped) separately from its siblings'. The *actual* media is run-scoped
        // (served like proof media, keyed by run id); the *baseline* media is
        // case-scoped (a fixed property of the case version, keyed by the run's subject
        // slug/version/variant), so the two resolve through different endpoints from the
        // same flat name.
        for (const script of run.validation.debugScripts ?? []) {
          const verdictId = script.subItemId
            ? subItemVerdictId(script.itemId, script.subItemId)
            : script.itemId;
          for (const output of script.outputs) {
            const ext = output.kind === "video" ? "webm" : "png";
            const file = `${verdictId}__${output.id}.${ext}`;
            media.push({
              itemId: script.itemId,
              subItemId: script.subItemId ?? null,
              verdictId,
              id: output.id,
              name: output.name,
              kind: output.kind,
              actualUrl:
                output.actualPresent && validationMediaUrl
                  ? validationMediaUrl(run.id, file)
                  : null,
              // The baseline is invariant per case version and always present when
              // the case ships one, so it is resolved case-scoped from the subject
              // rather than gated on any per-run presence flag.
              baselineUrl: validationBaselineUrl
                ? validationBaselineUrl(run.subject, file)
                : null,
            });
          }
        }
        return media;
      },
      assetResultFor(run) {
        const asset = run.validation.asset;
        if (!asset) return null;
        const url = (file: string) =>
          assetMediaUrl ? assetMediaUrl(run.id, file) : null;
        // A single sprite serves under bare names (its one frame); a sheet
        // suffixes each frame with `-<index>`, matching the published layout.
        const isSheet = !!asset.sheet;
        const frames: AssetFrameView[] = asset.frames.map((frame) => {
          const suffix = isSheet ? `-${frame.index}` : "";
          return {
            index: frame.index,
            regeneratedUrl: url(`regenerated${suffix}.png`),
            previewUrl: url(`preview${suffix}.png`),
            actionsUrl: url(`actions${suffix}.json`),
            cheatDivergence: frame.cheatDivergence,
            operationCount: frame.operationCount,
            detail: frame.detail,
          };
        });
        return {
          frames,
          detail: asset.detail,
          sheet: asset.sheet ?? null,
        };
      },
      voxelResultFor(run) {
        const voxel = run.validation.voxel;
        if (!voxel) return null;
        // Parts are addressed by the same flat served names the backend serves and
        // the snapshot publishes (see `playable::serve_asset_file`): a static model
        // under bare names (its one part), an animated model suffixing each part
        // with its `-<index>` in declared order. The recorded per-part paths are
        // the produced *tree* paths (which carry slashes) — not what the
        // one-segment `/asset/{file}` endpoint accepts — so they are resolved here
        // into the flat logical names instead.
        const animated = !!voxel.model || !!voxel.rig;
        const url = (path: string) =>
          assetMediaUrl ? assetMediaUrl(run.id, path) : null;
        const parts: VoxelPartView[] = voxel.parts.map((part, index) => {
          const suffix = animated ? `-${index}` : "";
          return {
            name: part.name,
            meshUrl: url(`mesh${suffix}.glb`),
            previewUrl: url(`preview${suffix}.png`),
            actionsUrl: url(`actions${suffix}.json`),
            operationCount: part.operationCount,
            voxelCount: part.voxelCount,
            detail: part.detail,
          };
        });
        // A skinned run (`mc-skinned`/`sn-skinned`/`dc-skinned`) carries the marker
        // in `validation.voxel.skinned`. It emits one continuous skinned mesh — the
        // single part's `.glb` — the viewer decodes and drives by linear-blend
        // skinning rather than posing per-part meshes.
        const skinned = voxel.skinned ?? false;
        // A Blender run (`blender-character`/`blender-prop`/`blender-mechanism`) carries
        // its rig/animations baked into the emitted native glTF, so the viewer loads it
        // whole with a native glTF player. A character is additionally `skinned`; a prop
        // (static) and mechanism (rigid) are not.
        const blender = voxel.blender ?? false;
        return {
          // A static model declares neither the required nor the produced rig; an
          // animated one carries both. The produced rig drives the viewer.
          animated,
          skinned,
          blender,
          // The single emitted `.glb` the native/skinned viewer loads whole: a skinned
          // run's continuous mesh, or ANY Blender run's native glTF (character/prop/
          // mechanism), which is not flagged `skinned` for a prop/mechanism.
          skinnedMeshUrl:
            skinned || blender ? (parts[0]?.meshUrl ?? null) : null,
          rig: voxel.rig ?? null,
          model: voxel.model ?? null,
          parts,
          detail: voxel.detail,
        };
      },
      uiResultFor(run) {
        const ui = run.validation.ui;
        if (!ui) return null;
        const url = (file: string) =>
          assetMediaUrl ? assetMediaUrl(run.id, file) : null;
        // Elements are addressed the flat way parts/frames are: a single-image case
        // serves its one element under a bare name, a kit suffixes each with its
        // `-<index>` in declared order.
        const kit = ui.elements.length > 1;
        const elements: UiElementView[] = ui.elements.map((element, index) => ({
          name: element.name,
          imageUrl: url(`element${kit ? `-${index}` : ""}.png`),
          width: element.width,
          height: element.height,
          nineSlice: element.nineSlice ?? null,
          detail: element.detail,
        }));
        return { elements, detail: ui.detail };
      },
      materialResultFor(run) {
        const material = run.validation.material;
        if (!material) return null;
        const url = (file: string) =>
          assetMediaUrl ? assetMediaUrl(run.id, file) : null;
        // Maps are addressed by their declared index, flat like a sheet's frames.
        const maps: MaterialMapView[] = material.maps.map((map, index) => ({
          name: map.name,
          imageUrl: url(`map-${index}.png`),
          colorSpace: map.colorSpace,
          detail: map.detail,
        }));
        const baseColorIndex = material.maps.findIndex(
          (m) => m.name === "base-color",
        );
        return {
          maps,
          size: material.size,
          tiling: material.tiling ?? null,
          baseColorUrl:
            baseColorIndex >= 0 ? url(`map-${baseColorIndex}.png`) : null,
          detail: material.detail,
        };
      },
      particleResultFor(run) {
        const particle = run.validation.particle;
        if (!particle) return null;
        const url = (file: string) =>
          assetMediaUrl ? assetMediaUrl(run.id, file) : null;
        return {
          systemUrl: url("system.json"),
          previewUrl: particle.preview ? url("preview.gif") : null,
          emitterCount: particle.emitterCount,
          detail: particle.detail,
        };
      },
      audioResultFor(run) {
        const audio = run.validation.audio;
        if (!audio) return null;
        const url = (file: string) =>
          assetMediaUrl ? assetMediaUrl(run.id, file) : null;
        return {
          clipUrl: url("clip.wav"),
          midiUrl: audio.midi ? url("score.mid") : null,
          previewUrl: audio.preview ? url("preview.png") : null,
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          durationMs: audio.durationMs,
          detail: audio.detail,
        };
      },
      replayResultFor(run) {
        const adversarial = run.validation.adversarial;
        if (!adversarial) return null;
        // One view per recorded opponent replay (canonical first). A forfeit run
        // records no replays, so synthesize a single record from the top-level
        // fields with no playable URL — the section still shows the forfeit.
        const replays: ReplayMatchView[] =
          adversarial.replays.length > 0
            ? adversarial.replays.map((entry) => ({
                opponent: entry.opponent,
                replayUrl: assetMediaUrl
                  ? assetMediaUrl(run.id, entry.replayJson)
                  : null,
                winner: entry.winner,
                redScore: entry.redScore,
                blueScore: entry.blueScore,
                ended: entry.ended,
                ticks: entry.ticks,
                outcome: entry.outcome,
                scored: entry.scored,
                detail: null,
              }))
            : [
                {
                  opponent: adversarial.opponent,
                  replayUrl: null,
                  winner: adversarial.winner,
                  redScore: adversarial.redScore,
                  blueScore: adversarial.blueScore,
                  ended: adversarial.ended,
                  ticks: adversarial.ticks,
                  outcome: adversarial.outcome,
                  scored: true,
                  detail: adversarial.detail,
                },
              ];
        return { submissionTeam: adversarial.submissionTeam, replays };
      },
      performancePlaybackFor(run) {
        const performance = run.validation.performance;
        if (!performance) return null;
        // One playable scenario per case the engine got RIGHT — a failing case
        // records none, because playback is offered only for a passing run. The
        // recorded name is already the flat, index-addressed served name
        // (`scenario.json`, `scenario-1.json`), so it needs no flattening here.
        const scenarios: PerformanceScenarioView[] = performance.cases.flatMap(
          (scored, index) =>
            scored.scenarioJson
              ? [
                  {
                    caseIndex: index,
                    input: scored.input,
                    scenarioUrl: assetMediaUrl
                      ? assetMediaUrl(run.id, scored.scenarioJson)
                      : null,
                    fuel: scored.fuel,
                  },
                ]
              : [],
        );
        return { correct: performance.correct, scenarios };
      },
    };
  }, [value]);
  return (
    <GalleryDataContext.Provider value={full}>
      {children}
    </GalleryDataContext.Provider>
  );
}

export function useGalleryData(): GalleryData {
  const ctx = useContext(GalleryDataContext);
  if (!ctx) {
    throw new Error("useGalleryData must be used within a GalleryDataProvider");
  }
  return ctx;
}

// A process-wide cache of fetched per-part `.glb` files, keyed by their resolved URL.
// Mesh geometry is immutable per published/produced run, so a file fetched once
// (for the viewer, its fallback, or a re-mount) is reused rather than re-fetched.
const meshFileCache = new Map<string, PartMesh>();

/** The load state of a set of voxel artifacts (see {@link useVoxelArtifacts}). */
export interface VoxelArtifacts {
  /**
   * The fetched per-part meshes keyed by part name, or null while any part is still
   * loading (so the viewer waits for a complete set before building its rig).
   */
  meshesByPart: Record<string, PartMesh> | null;
  /** True while any requested part is still being fetched. */
  loading: boolean;
  /** A message when a part could not be fetched or parsed, else null. */
  error: string | null;
}

/**
 * Fetch (and cache) each servable part's `.glb`, resolving to a
 * `{ [partName]: PartMesh }` map (parts with no `meshUrl` are skipped). The module
 * cache is keyed by resolved URL and shared with {@link useVoxelArtifacts}, so the
 * 3D viewer and any one-off consumer (e.g. the GIF export, which builds an
 * offscreen rig outside React) fetch each immutable file at most once. Rejects if
 * any servable part fails to fetch or parse.
 */
export async function fetchMeshesByPart(
  parts: readonly { name: string; meshUrl: string | null }[],
): Promise<Record<string, PartMesh>> {
  const servable = parts.filter((p) => p.meshUrl);
  const entries = await Promise.all(
    servable.map(async (part) => {
      const url = part.meshUrl!;
      const cached = meshFileCache.get(url);
      if (cached) return [part.name, cached] as const;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${part.name}: ${response.status}`);
      }
      const file = parseGlb(await response.arrayBuffer());
      meshFileCache.set(url, file);
      return [part.name, file] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Fetch (and cache) the `.glb` geometry the 3D voxel viewer needs for a run's
 * parts. Pass the run's {@link VoxelResultView} parts (name + resolved `meshUrl`);
 * the hook fetches each (an unservable-null URL is skipped), resolves the lot into
 * a `{ [partName]: PartMesh }` map, and reuses the module cache across mounts.
 * `meshesByPart` stays null until every servable part has resolved, so the viewer
 * builds one complete rig rather than flickering part-by-part.
 */
export function useVoxelArtifacts(
  parts: readonly { name: string; meshUrl: string | null }[],
): VoxelArtifacts {
  // A stable dependency key: the ordered name→url pairs as one string.
  const key = parts.map((p) => `${p.name}=${p.meshUrl ?? ""}`).join("|");
  const [state, setState] = useState<VoxelArtifacts>({
    meshesByPart: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const servable = parts.filter((p) => p.meshUrl);
    if (servable.length === 0) {
      setState({ meshesByPart: {}, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ meshesByPart: null, loading: true, error: null });

    fetchMeshesByPart(servable)
      .then((meshesByPart) => {
        if (cancelled) return;
        setState({ meshesByPart, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          meshesByPart: null,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => {
      cancelled = true;
    };
    // `key` captures the parts' names and URLs; `parts` itself may be a fresh
    // array each render, so we key the effect on the derived string instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

// A process-wide cache of fetched `system.json` definitions, keyed by resolved URL.
// A published/produced run's system is immutable, so it is fetched at most once and
// reused by the live viewer across mounts.
const particleSystemCache = new Map<string, ParticleSystem>();

/** Fetch (and cache) a particle run's emitted `system.json` — the authored
 * emitter/force/curve definition the viewer simulates live. Rejects on a failed
 * fetch or malformed JSON. */
export async function fetchParticleSystem(
  url: string,
): Promise<ParticleSystem> {
  const cached = particleSystemCache.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`system.json: ${response.status}`);
  const system = (await response.json()) as ParticleSystem;
  particleSystemCache.set(url, system);
  return system;
}

/** The load state of a fetched particle `system.json`. */
export interface ParticleSystemState {
  system: ParticleSystem | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch (and cache) a particle run's `system.json` for the live viewer. Pass the
 * resolved `systemUrl` (or null to fetch nothing — e.g. an unservable run, or before
 * the WebGL guard promotes). `system` stays null until the fetch resolves.
 */
export function useParticleSystem(url: string | null): ParticleSystemState {
  const [state, setState] = useState<ParticleSystemState>({
    system: null,
    loading: url !== null,
    error: null,
  });

  useEffect(() => {
    if (url === null) {
      setState({ system: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ system: null, loading: true, error: null });
    fetchParticleSystem(url)
      .then((system) => {
        if (!cancelled) setState({ system, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          system: null,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

// A process-wide cache of decoded skinned meshes, keyed by resolved `.glb` URL. Like
// {@link meshFileCache}, mesh geometry is immutable per run, so each file is decoded
// at most once.
const skinnedMeshCache = new Map<string, SkinnedMesh>();

/** Fetch (and cache) a skinned run's single `mesh.glb` and decode it into a
 * {@link SkinnedMesh} with `parseSkinnedGlb`. Rejects on a failed fetch or decode. */
export async function fetchSkinnedMesh(url: string): Promise<SkinnedMesh> {
  const cached = skinnedMeshCache.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`mesh.glb: ${response.status}`);
  const mesh = parseSkinnedGlb(await response.arrayBuffer());
  skinnedMeshCache.set(url, mesh);
  return mesh;
}

/** The load state of a decoded skinned mesh. */
export interface SkinnedMeshState {
  mesh: SkinnedMesh | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch (and cache) a skinned run's single `mesh.glb`, decoded into the
 * {@link SkinnedMesh} the skinned 3D viewer poses. Pass the resolved
 * `skinnedMeshUrl` (or null to fetch nothing). `mesh` stays null until it resolves.
 */
export function useSkinnedMesh(url: string | null): SkinnedMeshState {
  const [state, setState] = useState<SkinnedMeshState>({
    mesh: null,
    loading: url !== null,
    error: null,
  });

  useEffect(() => {
    if (url === null) {
      setState({ mesh: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ mesh: null, loading: true, error: null });
    fetchSkinnedMesh(url)
      .then((mesh) => {
        if (!cancelled) setState({ mesh, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          mesh: null,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
