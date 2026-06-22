import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  AdversarialResult,
  AssetSheet,
  ControllerRef,
  MatchSummary,
  RunRecord,
  RunSubject,
  TournamentRecord,
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

/** The scoring model for a run: the variant's weighted checklist items and the
 * case's scoring domains, resolved from the catalog. Both empty when the case is
 * not in the catalog this host holds. */
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
 * transport behind these: the web host hits the active worker (for runs and live
 * progress) and the backend (for reading persisted tournaments and replays); the
 * desktop host invokes the local core's Tauri commands and channels.
 */
/** A worker the arena can run matches/tournaments on. The web host has one per
 * configured worker; the desktop host has a single built-in local worker. */
export interface ArenaWorkerOption {
  /** Stable id (the local worker uses the reserved id `"local"`). */
  id: string;
  /** Display label. */
  label: string;
}

export interface ArenaApi {
  /** The workers this host can run matches on, so the arena can offer a worker to
   * pick. A run resolves a controller of kind `"run"` against the chosen worker's
   * local output dir; pushed and baseline controllers resolve the same on any. */
  listWorkers(): ArenaWorkerOption[];
  /** The controllers available to pit for a case: the committed baselines, the
   * chosen worker's produced adversarial runs (kind `"run"`), and the case's
   * pushed adversarial controllers (kind `"pushed"`). `workerId` selects which
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
  /** True when the test cases shown are design-preview samples, not the catalog. */
  testCasesUsingSamples: boolean;
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
   * An adversarial run's canonical-match result resolved for display, or null
   * when the run is not adversarial (its `validation.adversarial` is absent). The
   * replay URL is resolved via {@link assetMediaUrl}, the same per-run asset
   * plumbing asset-generation media uses.
   */
  replayResultFor(run: RunRecord): ReplayResultView | null;
  /**
   * The scoring model for a run's subject: the effective (common + variant)
   * weighted checklist items and the case's scoring domains, resolved from the
   * catalog this host holds. Items and domains are empty when the case is not in
   * the catalog. Lets the verdict page and the leaderboard score a run from its
   * review verdicts and per-domain ratings.
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
    const { writeups, reviews, proofMediaUrl, assetMediaUrl, testCases } = value;
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
          domains: testCase?.domains ?? [],
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
