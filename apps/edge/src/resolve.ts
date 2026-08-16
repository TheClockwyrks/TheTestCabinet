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
      /** The domain's front door: the bare root, which is not a link to anything
       * in particular and so sends the visitor to the gallery. */
      kind: "gallery";
      url: string;
    }
  | {
      /** The path addresses nothing on this domain — a code that names no run, or
       * a path that is not a short link at all. Answered with a 404. */
      kind: "notFound";
      /** The gallery URL to offer on the 404 page, so the visitor has somewhere
       * to go from a domain that has nothing else on it. */
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
 * Only `/r/<code>` and `/p/<code>` are short links. The bare root is the domain's
 * front door and goes to the gallery. Everything else addresses nothing here and
 * is a 404 — the short domain has exactly one job, and quietly redirecting a path
 * it does not serve would alias the gallery's own paths and hide typos.
 *
 * A code that names no run is a 404 for the same reason a wrong address on the
 * gallery is: a link that resolves to *something* when it should have resolved to
 * nothing tells the person who followed it that they arrived, and tells a crawler
 * the URL is real. The 404 page offers the gallery, so nobody is left at a dead
 * end on a domain with nothing else on it.
 */
export function resolveShortLink(
  pathname: string,
  index: ShareIndex,
): Resolution {
  const origin = index.origin.replace(/\/+$/, "");
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return { kind: "gallery", url: origin };

  const requested =
    segments.length === 2 ? targetForPrefix(segments[0]!) : null;
  if (!requested) return { kind: "notFound", url: origin };

  const runId = resolveCode(decodeURIComponent(segments[1]!), codeMap(index));
  if (!runId) return { kind: "notFound", url: `${origin}/runs` };

  const entry = Object.values(index.entries).find((e) => e.runId === runId);
  if (!entry) return { kind: "notFound", url: `${origin}/runs` };

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
