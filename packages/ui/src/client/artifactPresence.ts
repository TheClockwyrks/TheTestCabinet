import type { RunSummary } from "@clockwyrks/run-record/snapshot";

// Whether a run's artifact tree is stored, as a console knows it.
//
// A run is released from the tree its driver uploaded to the artifact service, so
// a run whose tree is not stored can never be published. The backend reports the
// runs it knows this about beside the cards of every response that returns them
// (a summary page, a plan's runs, an account's reviews), as a list of ids
// (`artifactsNotStored`), because the card itself is the shape the public
// snapshot ships and says nothing about it.
//
// The wording says what is known, which is that the artifact service holds no
// tree. Why is not known: an upload that failed and a run pushed from a machine
// that never uploads one read the same.
//
// A tree the backend removed on purpose is a different fact. Its reclamation
// sweep deletes the tree of a failed or canceled run once the run's retention has
// passed, and of a published run once its release is confirmed, and records when
// and why. The backend names those runs in a second list (`artifactsReclaimed`),
// never in the first: such a run has no stored tree either, but nothing was lost
// and nothing is wrong, so a console says so in plain words and not as a fault.
//
// The transport folds both lists back onto the cards it hands out, and everything
// downstream asks `artifactsNotStored(summary)` or `artifactsReclaimed(summary)`.
// Both halves live here so the fields a console adds to a card are written and
// read in one place. A card from any other source (the static gallery's snapshot,
// a worker's produced list) carries no mark, and reads as "not known to be
// missing".

/** A summary card as a console holds it, with the console-only presence marks. */
type RunSummaryWithPresence = RunSummary & {
  artifactsStored?: false;
  artifactsReclaimed?: true;
};

/**
 * Mark each of `summaries` whose id is in `notStored` as a run whose artifact
 * tree is not stored, and each whose id is in `reclaimed` as a run whose tree was
 * removed on purpose. A run in both lists reads as reclaimed. Cards outside the
 * lists are returned as they are.
 */
export function markArtifactsNotStored(
  summaries: RunSummary[],
  notStored: readonly string[] | null | undefined,
  reclaimed?: readonly string[] | null,
): RunSummary[] {
  const lost = new Set(notStored ?? []);
  const removed = new Set(reclaimed ?? []);
  if (lost.size === 0 && removed.size === 0) return summaries;
  return summaries.map((summary): RunSummary => {
    if (removed.has(summary.id)) {
      const marked: RunSummaryWithPresence = {
        ...summary,
        artifactsStored: false,
        artifactsReclaimed: true,
      };
      return marked;
    }
    if (!lost.has(summary.id)) return summary;
    const marked: RunSummaryWithPresence = {
      ...summary,
      artifactsStored: false,
    };
    return marked;
  });
}

/**
 * Whether `summary` is known to have no stored artifact tree for a reason nobody
 * chose, which means the run cannot be published. False for a run whose presence
 * is unknown, and for one whose tree was reclaimed.
 */
export function artifactsNotStored(summary: RunSummary): boolean {
  const card = summary as RunSummaryWithPresence;
  return card.artifactsStored === false && card.artifactsReclaimed !== true;
}

/**
 * Whether `summary`'s artifact tree was removed on purpose by the backend's
 * reclamation sweep. An unpublished run this holds for cannot be published.
 */
export function artifactsReclaimed(summary: RunSummary): boolean {
  return (summary as RunSummaryWithPresence).artifactsReclaimed === true;
}

/**
 * Why `summary` cannot be published for want of an artifact tree, in the words a
 * console shows, or null when its tree is not known to be gone.
 */
export function unpublishableArtifactsLabel(
  summary: RunSummary,
): string | null {
  if (artifactsReclaimed(summary)) return ARTIFACTS_RECLAIMED_LABEL;
  if (artifactsNotStored(summary)) return ARTIFACTS_NOT_STORED_LABEL;
  return null;
}

/** What a console says about a run whose artifact tree is not stored. */
export const ARTIFACTS_NOT_STORED_LABEL =
  "No stored artifacts: the artifact service holds no source or build for this run, so it cannot be published";

/** What a console says about an unpublished run whose tree was reclaimed. */
export const ARTIFACTS_RECLAIMED_LABEL =
  "Artifacts removed: this run's artifacts were removed after the retention period, so it cannot be published";

// ---------------------------------------------------------------------------
// What a run's page downloads
// ---------------------------------------------------------------------------

/**
 * The branch a release pushes a run's source to. `crates/core/src/publish.rs`
 * pushes `HEAD:refs/heads/main`, and the zip archive below names that branch.
 */
export const RELEASE_BRANCH = "main";

/**
 * Where a published run's source is downloaded from, given the record's source
 * repository link.
 *
 * A repository on GitHub answers a zip archive of the released branch at
 * `<repository>/archive/refs/heads/main.zip`. Any other link is returned as the
 * page it is: a repository host this console cannot build an archive link for,
 * or a GitHub link that is not a plain `owner/repository`, still has a page to
 * open, and a link that opens a page is better than one that answers 404. Null
 * for no link, or one that is not an `http(s)` URL.
 */
export function publishedSourceDownload(
  sourceRepo: string | null | undefined,
): { href: string; kind: "archive" | "page" } | null {
  if (!sourceRepo) return null;
  let url: URL;
  try {
    url = new URL(sourceRepo);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "github.com" || host === "www.github.com") {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 2) {
      const owner = segments[0]!;
      const repository = segments[1]!.replace(/\.git$/, "");
      if (repository) {
        return {
          href: `https://github.com/${owner}/${repository}/archive/refs/heads/${RELEASE_BRANCH}.zip`,
          kind: "archive",
        };
      }
    }
  }
  return { href: url.toString(), kind: "page" };
}

/** What a run's page offers to download. */
export type RunDownload =
  /** The whole stored tree, from the artifact service. */
  | { kind: "tree"; href: string }
  /** The released source as a zip archive from its repository host. */
  | { kind: "archive"; href: string }
  /** The released source repository's own page. */
  | { kind: "page"; href: string };

/**
 * What a run's page offers to download, or null for nothing.
 *
 * - An unpublished run downloads its whole stored tree, unless the tree is known
 *   to be gone (reclaimed, or recorded as not stored).
 * - A published run downloads what was released: its source repository. Its tree
 *   is deleted once the release is confirmed, so the tree is offered only for a
 *   published run with no source repository, and then on the same terms as an
 *   unpublished run's: unless it is known to be gone. A presence nothing has
 *   reported on is a tree that may well be there, which is every run of a host
 *   whose backend holds no service token.
 *
 * `treeUrl` is the artifact service's archive of the run, or null on a host with
 * no artifact service.
 */
export function runDownload(run: {
  published: boolean;
  artifactsStored: boolean | null | undefined;
  artifactsReclaimed: boolean;
  sourceRepo: string | null | undefined;
  treeUrl: string | null;
}): RunDownload | null {
  const treeGone = run.artifactsReclaimed || run.artifactsStored === false;
  if (!run.published) {
    return run.treeUrl && !treeGone
      ? { kind: "tree", href: run.treeUrl }
      : null;
  }
  const released = publishedSourceDownload(run.sourceRepo);
  if (released) return released;
  return run.treeUrl && !treeGone ? { kind: "tree", href: run.treeUrl } : null;
}
