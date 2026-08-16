// The share index: what the gallery build publishes so a short link can be
// resolved and previewed without reading the snapshot.
//
// A short link has to answer two questions at request time — *which run is this*
// and *what does it look like in a preview card* — and neither is worth a walk
// through `index.json` → `runs.json` → a content-addressed run document on every
// request. The gallery build already visits every published run to emit its
// per-run assets, so it emits this alongside them: one small file, served from the
// gallery's own origin, always describing exactly the runs that deployment knows
// about.
//
// That the index is same-origin with the gallery is deliberate. A short link only
// ever resolves to the gallery, so pinning the resolver's data to the gallery
// deployment means the two cannot disagree: a link never resolves to a run the
// site it lands on has never heard of.

/** Which of a run's two shareable pages a link points at. */
export type ShareTarget = "verdict" | "play";

/** Where the gallery build writes the index, relative to the site root. */
export const SHARE_INDEX_PATH = "share-index.json";

/** The contract version of the emitted file, bumped when its shape changes. */
export const SHARE_INDEX_VERSION = 1;

/**
 * One published run, reduced to what a short link needs: enough to redirect, and
 * enough to render a preview card, with nothing else carried.
 */
export interface ShareEntry {
  /** The run's canonical short code (see `shortCodeFor`). */
  code: string;
  /** The full run id the code resolves to. */
  runId: string;
  /** The test case's display name, e.g. "Carom". */
  caseName: string;
  /** The case's variant slug, shown when it is not the default. */
  variant: string;
  /** The model id the run was produced by. */
  model: string;
  /** The agent harness slug that drove the run. */
  harness: string;
  /** The run's aggregate overall rating, or null when it carries none. */
  rating: string | null;
  /** The run's aggregate score, or null when it is unscored (a failure tier). */
  score: { earned: number; total: number } | null;
  /** How many reviews the run carries. */
  reviews: number;
  /** The run's terminal state. */
  state: string;
  /** Whether the run released a playable build — false for a failure tier that
   * releases none, in which case a `play` link has nothing to show and the
   * resolver sends the visitor to the verdict page instead. */
  hasPlayableBuild: boolean;
  /** An absolute URL to the run's proof image, used as the preview card's image.
   * Null when the run published no image proof. */
  image: string | null;
}

/** The emitted file: every published run keyed by its short code. */
export interface ShareIndex {
  version: number;
  /** The gallery origin these entries' links resolve against, e.g.
   * `https://testcabinet.ai`. Recorded so a resolver hosted elsewhere builds
   * canonical URLs without being configured separately. */
  origin: string;
  /** When the snapshot this was built from was generated, for debugging a stale
   * deployment. Null on a gallery built with no published dataset at all. */
  generatedAt: string | null;
  /** Entries keyed by short code. */
  entries: Record<string, ShareEntry>;
}
