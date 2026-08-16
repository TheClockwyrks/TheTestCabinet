// Resolving a short link, as a pure function of the path and the published index.
//
// Kept separate from the request plumbing in `index.ts` so the decisions that
// matter — which run a code names, which page it opens, and where a link that
// names nothing should land — are testable without a Workers runtime.

import {
  resolveCode,
  runPath,
  targetForPrefix,
  type ShareEntry,
  type ShareIndex,
  type ShareTarget,
} from "@test-cabinet/share-links";

/** What a short-link request resolves to. */
export type Resolution =
  | {
      kind: "run";
      entry: ShareEntry;
      /** The page the link opens, after any downgrade below. */
      target: ShareTarget;
      /** The gallery URL to send a visitor to, and to declare as canonical. */
      canonicalUrl: string;
      /** True when a `play` link was downgraded to the verdict page because the
       * run released no playable build. */
      downgraded: boolean;
    }
  | {
      /** The path names no run; send the visitor somewhere useful on the gallery
       * rather than answering with an error. */
      kind: "elsewhere";
      url: string;
    };

// Every code in the index, as the code -> run id map the resolver reads.
function codeMap(index: ShareIndex): Map<string, string> {
  const codes = new Map<string, string>();
  for (const [code, entry] of Object.entries(index.entries)) {
    codes.set(code, entry.runId);
  }
  return codes;
}

/**
 * Resolve a short-link path against the published index.
 *
 * Only `/r/<code>` and `/p/<code>` are short links. Everything else — including
 * the bare root — is sent to the gallery, so the short domain has exactly one job
 * and no surprising aliasing of the gallery's own paths.
 *
 * A link that names no run lands on the run index rather than a 404: someone
 * following a dead or mistyped link is better served by the thing they were
 * looking for than by an error page on a domain that has nothing else on it.
 */
export function resolveShortLink(
  pathname: string,
  index: ShareIndex,
): Resolution {
  const origin = index.origin.replace(/\/+$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const requested =
    segments.length === 2 ? targetForPrefix(segments[0]!) : null;
  if (!requested) return { kind: "elsewhere", url: origin };

  const runId = resolveCode(decodeURIComponent(segments[1]!), codeMap(index));
  if (!runId) return { kind: "elsewhere", url: `${origin}/runs` };

  const entry = Object.values(index.entries).find((e) => e.runId === runId);
  if (!entry) return { kind: "elsewhere", url: `${origin}/runs` };

  // A run that released no playable build has nothing for a play link to open —
  // a harness-error or hung run releases none, and a catastrophic one produced
  // nothing that loads. Send the visitor to the verdict page, which explains what
  // happened, rather than to a tab that renders an empty frame.
  const downgraded = requested === "play" && !entry.hasPlayableBuild;
  const target: ShareTarget = downgraded ? "verdict" : requested;

  return {
    kind: "run",
    entry,
    target,
    // Always the gallery's own URL — never the run's playable-build deployment.
    // A shared link has to land somewhere the visitor can reach the rest of the
    // cabinet from; a bare build has no way back.
    canonicalUrl: `${origin}${runPath(entry.runId, target)}`,
    downgraded,
  };
}
