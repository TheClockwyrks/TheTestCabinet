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
  ModelSpec,
  RunRecord,
  RunSubject,
  TournamentRecord,
  VoxelsFile,
} from "@test-cabinet/run-record";
import type {
  ProgressCallback,
  ProofMedia,
  RunEventStreams,
  StoredReview,
} from "../../client/types";
import { type ParsedWriteup, parseWriteup } from "./ratings";
import { extensionFor } from "./proofMedia";
import type {
  DomainSummary,
  ReviewItemSummary,
  TestCaseSummary,
} from "./testCases";

/**
 * The load state of the test-case catalog. `"loading"` while the host is still
 * resolving it from its backend, `"ready"` once resolved (the catalog may still
 * be empty), and `"error"` when the host could not reach its source at all — so a
 * host with no reachable backend reads as an error rather than an empty catalog.
 * Hosts whose catalog is static (the public site) are always `"ready"`.
 */
export type CatalogStatus = "loading" | "ready" | "error";

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
// produced runs). Pages read it through the existing data hooks (`useRuns`,
// `useTestCases`, `findReview`), which now resolve to this context — so page
// logic is unchanged regardless of where the data comes from.

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

// The value each host builds and provides. `findReview` is derived by the
// provider from `writeups`, so hosts do not supply it.
export interface GalleryDataInput {
  /** Completed runs to display: local (unpublished) first, then published. */
  runs: RunRecord[];
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
  /**
   * Whether this UI can launch, monitor, review, and publish runs. False on the
   * static gallery site; true in the web and desktop consoles. Gates the
   * run-execution UI (new-run button, live monitor, editable review, the
   * connections drawer).
   */
  canExecute: boolean;
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
   * Resolve one run's record by id, directly from the host's store, for a run
   * reached by a direct link that the loaded list does not carry. The run-detail
   * page resolves a run from the in-memory list first and falls back to this when
   * it misses — so a run that appears in no worklist (an infrastructure failure,
   * retained for inspection but never publishable) or simply isn't on the current
   * page stays openable by its id. Resolves `null` when no run with that id is
   * stored. Omitted by a host that can only serve the runs it already listed (the
   * static gallery site).
   */
  readRun?: (runId: string) => Promise<RunRecord | null>;
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
 * One part of a voxel asset-generation run, resolved for display: the regenerated
 * voxel data the 3D viewer poses, the isometric PNGs (regenerated vs the model's
 * own preview) reviewed against the brief, and the recorded operation log — each
 * as a loadable URL (or null when the host cannot serve it) — alongside the
 * recorded cheat-divergence signal. The 3D analog of {@link AssetFrameView}.
 */
export interface VoxelPartView {
  /** The part name: `model` for a static model, the declared part for animation. */
  name: string;
  /** The regenerated `voxels.json` for this part (fed to the 3D viewer). */
  voxelsUrl: string | null;
  /** The regenerated isometric PNG (the WebGL/reduced-motion fallback). */
  regeneratedUrl: string | null;
  /** The model's own on-disk isometric preview PNG. */
  previewUrl: string | null;
  /** The recorded operation log for this part. */
  actionsUrl: string | null;
  /** Divergence of the regenerated image from the preview, or null if unmeasured. */
  cheatDivergence: number | null;
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
 * viewer poses it directly; only each part's `voxels.json` is fetched (see
 * {@link GalleryData} `useVoxelArtifacts`). The 3D analog of {@link AssetResultView}.
 */
export interface VoxelResultView {
  /** Whether this is an animated (rigged) model versus a static single model. */
  animated: boolean;
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
   * An asset-generation run's result resolved for display, or null when the run
   * is not asset-generation (its `validation.asset` is absent). Media URLs are
   * resolved via {@link assetMediaUrl}.
   */
  assetResultFor(run: RunRecord): AssetResultView | null;
  /**
   * A voxel asset-generation run's result resolved for display, or null when the
   * run is not a voxel run (its `validation.voxel` is absent). Media URLs (the
   * per-part `voxels.json` and isometric PNGs) are resolved via
   * {@link assetMediaUrl}; the rig structure travels inline in the run record.
   */
  voxelResultFor(run: RunRecord): VoxelResultView | null;
  /**
   * An adversarial run's canonical-match result resolved for display, or null
   * when the run is not adversarial (its `validation.adversarial` is absent). The
   * replay URL is resolved via {@link assetMediaUrl}, the same per-run asset
   * plumbing asset-generation media uses.
   */
  replayResultFor(run: RunRecord): ReplayResultView | null;
  /**
   * The scoring model for a run's subject: the effective (common + variant)
   * weighted checklist items and the effective (common + variant) scoring
   * domains, resolved from the catalog this host holds. Items and domains are
   * empty when the case is not in the catalog. Lets the verdict page and the
   * leaderboard score a run from its review verdicts and per-domain ratings.
   */
  reviewModelFor(subject: RunSubject): ReviewModel;
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
    const { writeups, reviews, proofMediaUrl, assetMediaUrl, testCases } =
      value;
    return {
      ...value,
      findReview(runId, override) {
        const raw = override?.[runId] ?? writeups[runId];
        return raw === undefined ? undefined : parseWriteup(raw);
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
            voxelsUrl: url(`voxels${suffix}.json`),
            regeneratedUrl: url(`regenerated${suffix}.png`),
            previewUrl: url(`preview${suffix}.png`),
            actionsUrl: url(`actions${suffix}.json`),
            cheatDivergence: part.cheatDivergence,
            operationCount: part.operationCount,
            voxelCount: part.voxelCount,
            detail: part.detail,
          };
        });
        return {
          // A static model declares neither the required nor the produced rig; an
          // animated one carries both. The produced rig drives the viewer.
          animated,
          rig: voxel.rig ?? null,
          model: voxel.model ?? null,
          parts,
          detail: voxel.detail,
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

// A process-wide cache of fetched `voxels.json` files, keyed by their resolved
// URL. Voxel data is immutable per published/produced run, so a file fetched once
// (for the viewer, its fallback, or a re-mount) is reused rather than re-fetched.
const voxelFileCache = new Map<string, VoxelsFile>();

/** The load state of a set of voxel artifacts (see {@link useVoxelArtifacts}). */
export interface VoxelArtifacts {
  /**
   * The fetched voxel data keyed by part name, or null while any part is still
   * loading (so the viewer waits for a complete set before building its meshes).
   */
  voxelsByPart: Record<string, VoxelsFile> | null;
  /** True while any requested part is still being fetched. */
  loading: boolean;
  /** A message when a part could not be fetched or parsed, else null. */
  error: string | null;
}

/**
 * Fetch (and cache) the `voxels.json` data the 3D voxel viewer needs for a run's
 * parts. Pass the run's {@link VoxelResultView} parts (name + resolved
 * `voxelsUrl`); the hook fetches each unservable-null URL is skipped, resolves the
 * lot into a `{ [partName]: VoxelsFile }` map, and reuses the module cache across
 * mounts. `voxelsByPart` stays null until every servable part has resolved, so the
 * viewer builds one complete rig rather than flickering part-by-part.
 */
export function useVoxelArtifacts(
  parts: readonly { name: string; voxelsUrl: string | null }[],
): VoxelArtifacts {
  // A stable dependency key: the ordered name→url pairs as one string.
  const key = parts.map((p) => `${p.name}=${p.voxelsUrl ?? ""}`).join("|");
  const [state, setState] = useState<VoxelArtifacts>({
    voxelsByPart: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const servable = parts.filter((p) => p.voxelsUrl);
    if (servable.length === 0) {
      setState({ voxelsByPart: {}, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ voxelsByPart: null, loading: true, error: null });

    Promise.all(
      servable.map(async (part) => {
        const url = part.voxelsUrl!;
        const cached = voxelFileCache.get(url);
        if (cached) return [part.name, cached] as const;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`${part.name}: ${response.status}`);
        }
        const file = (await response.json()) as VoxelsFile;
        voxelFileCache.set(url, file);
        return [part.name, file] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setState({
          voxelsByPart: Object.fromEntries(entries),
          loading: false,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          voxelsByPart: null,
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
