import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  AdversarialResult,
  RunRecord,
  RunSubject,
} from "@test-cabinet/run-record";
import type {
  ProgressCallback,
  ProofMedia,
  RunEventStreams,
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

// The value each host builds and provides. `findReview` is derived by the
// provider from `writeups`, so hosts do not supply it.
export interface GalleryDataInput {
  /** Completed runs to display: local (unpublished) first, then published. */
  runs: RunRecord[];
  /** Ids of runs sourced locally (produced but not yet published). */
  localIds: ReadonlySet<string>;
  /**
   * Raw writeups keyed by run id — the `---\nrating: …\n---\n\n<body>` framing
   * `parseWriteup` reads. Holds both published reviews and local previews.
   */
  writeups: Readonly<Record<string, string>>;
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
   * Resolve the loadable URL for one asset-generation run's media file
   * (`regenerated.png`, `preview.png`, `target.png`, or `actions.json`), or null
   * when the host cannot serve it. Each host wires its own source the same way it
   * wires {@link proofMediaUrl}: the consoles point at the backend (published) or
   * worker (produced) asset endpoint, the static site at the snapshot asset.
   * Omitted by a host that serves no asset media.
   */
  assetMediaUrl?: (runId: string, file: string) => string | null;
}

/**
 * An asset-generation run's result, resolved for display: the regenerated image
 * (the scored output), the model's final preview, the seeded target, and the
 * recorded action log — each as a loadable URL (or null when the host cannot
 * serve it) — alongside the recorded fidelity and cheat-divergence signals.
 */
export interface AssetResultView {
  regeneratedUrl: string | null;
  previewUrl: string | null;
  targetUrl: string | null;
  actionsUrl: string | null;
  /** Similarity of the regenerated image to the target, in `0..=1`. */
  fidelity: number;
  /** Divergence of the regenerated image from the preview, or null if unmeasured. */
  cheatDivergence: number | null;
  /** How many operations the recorded log holds. */
  operationCount: number;
  /** Detail about anything that could not be evaluated, or null. */
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
export interface ReplayResultView {
  /** Loadable URL of the run's `replay.json`, or null if it cannot be served. */
  replayUrl: string | null;
  /** The baseline opponent the submission was matched against (Blue). */
  opponent: string;
  /** Which side the submission played (always `"red"` for the canonical match). */
  submissionTeam: AdversarialResult["submissionTeam"];
  /** The winning side, or null for a draw. `"red"` is the submission. */
  winner: AdversarialResult["winner"];
  /** The submission's (Red's) banked score at the end of the match. */
  redScore: number;
  /** The opponent's (Blue's) banked score at the end of the match. */
  blueScore: number;
  /** How the match ended (e.g. `"swept"`, `"timeLimit"`, `"forfeit"`). */
  ended: string;
  /** How many ticks the match ran for. */
  ticks: number;
  /** The outcome from the submission's perspective. */
  outcome: AdversarialResult["outcome"];
  /** Detail about a submission that could not be matched, or null. */
  detail: string | null;
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
    const { writeups, proofMediaUrl, assetMediaUrl, testCases } = value;
    return {
      ...value,
      findReview(runId, override) {
        const raw = override?.[runId] ?? writeups[runId];
        return raw === undefined ? undefined : parseWriteup(raw);
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
        return {
          regeneratedUrl: url("regenerated.png"),
          previewUrl: url("preview.png"),
          targetUrl: url("target.png"),
          actionsUrl: url("actions.json"),
          fidelity: asset.targetFidelity,
          cheatDivergence: asset.cheatDivergence,
          operationCount: asset.operationCount,
          detail: asset.detail,
        };
      },
      replayResultFor(run) {
        const adversarial = run.validation.adversarial;
        if (!adversarial) return null;
        return {
          replayUrl: assetMediaUrl
            ? assetMediaUrl(run.id, "replay.json")
            : null,
          opponent: adversarial.opponent,
          submissionTeam: adversarial.submissionTeam,
          winner: adversarial.winner,
          redScore: adversarial.redScore,
          blueScore: adversarial.blueScore,
          ended: adversarial.ended,
          ticks: adversarial.ticks,
          outcome: adversarial.outcome,
          detail: adversarial.detail,
        };
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
