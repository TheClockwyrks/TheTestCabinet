// The short-link resolver: the Worker behind tcab.ai.
//
// It turns `/r/<code>` and `/p/<code>` into a run's verdict or play page on the
// gallery. Two properties are worth stating because they are the reason the
// design is shaped this way:
//
//  - **It has no write surface.** A code is derived from a run id (see
//    `@test-cabinet/share-links`), so the set of valid links is exactly the set of
//    published runs and only the backend can extend it. There is no endpoint that
//    mints a link, so there is nothing to rate-limit and nothing for a malicious
//    visitor to exhaust. That is what makes this safe to expose publicly.
//  - **It has no data plane of its own.** The published index it resolves against
//    is an asset of the gallery deployment, fetched over HTTP and edge-cached. No
//    KV, no database, no deploy step per publish: a gallery rebuild is what makes a
//    newly published run resolvable.
//
// A crawler gets a preview document carrying the run's card. Anything else gets a
// redirect, because a person who clicked a link wants the run, not a stub.
//
// A path this domain does not serve — a code that names no run, or anything that
// is not a short link — gets a 404 with the gallery offered as the way out. It
// used to get a quiet redirect to the run index, which is worse in both
// directions: the person who followed a dead link is told they arrived somewhere,
// and a crawler is told the URL is real.

import {
  SHARE_INDEX_PATH,
  isCrawler,
  renderPreviewDocument,
  type ShareIndex,
} from "@test-cabinet/share-links";
import { renderNotFoundDocument } from "./notFound.js";
import { resolveShortLink } from "./resolve.js";

export interface Env {
  /** The gallery this resolver points at, e.g. `https://testcabinet.ai`. */
  GALLERY_ORIGIN: string;
}

// How long the fetched index is cached at the edge. A short link for a run
// published within this window resolves once the cache turns over; the gallery
// rebuild that publishes the run takes longer than this anyway.
const INDEX_CACHE_SECONDS = 300;

async function loadIndex(env: Env): Promise<ShareIndex | null> {
  const origin = (env.GALLERY_ORIGIN || "https://testcabinet.ai").replace(
    /\/+$/,
    "",
  );
  try {
    const response = await fetch(`${origin}/${SHARE_INDEX_PATH}`, {
      cf: { cacheTtl: INDEX_CACHE_SECONDS, cacheEverything: true },
    } as RequestInit);
    if (!response.ok) return null;
    return (await response.json()) as ShareIndex;
  } catch {
    return null;
  }
}

// Where to send a visitor when the index cannot be read at all. Deliberately a
// redirect and not a 404: the link may well be perfectly good, and this resolver
// simply cannot say right now. Manufacturing a 404 out of an infrastructure
// failure would tell the visitor — and any crawler — that a real link is dead.
function fallbackRedirect(env: Env): Response {
  const origin = (env.GALLERY_ORIGIN || "https://testcabinet.ai").replace(
    /\/+$/,
    "",
  );
  return Response.redirect(`${origin}/runs`, 302);
}

// The 404 for a path this domain does not serve: a code that names no run, or a
// path that is not a short link at all. It carries the gallery as the way out, so
// a dead link is still not a dead end.
function notFound(url: string): Response {
  return new Response(renderNotFoundDocument(url), {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // A dead short link must not be indexed. It is exactly the kind of URL a
      // crawler follows from wherever the link was shared.
      "x-robots-tag": "noindex",
      // Not cached, for the same reason the redirect below is a 302: a code that
      // names nothing today names a run the moment that run is published, and a
      // cached 404 would outlive the fact it recorded.
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The resolver answers reads. A HEAD is a read (crawlers and link checkers
    // send them); anything else is not something a short link can mean.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const index = await loadIndex(env);
    if (!index) return fallbackRedirect(env);

    const url = new URL(request.url);
    const resolution = resolveShortLink(url.pathname, index);
    if (resolution.kind === "notFound") return notFound(resolution.url);
    if (resolution.kind === "gallery") {
      return Response.redirect(resolution.url, 302);
    }

    const { entry, target, canonicalUrl } = resolution;
    if (isCrawler(request.headers.get("user-agent"))) {
      return new Response(renderPreviewDocument(entry, target, canonicalUrl), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          // The preview is as stable as the run's published card, but keep it
          // short enough that a re-review is reflected within the day.
          "cache-control": "public, max-age=3600",
        },
      });
    }

    // 302 rather than 301: a permanent redirect is cached by browsers
    // indefinitely, and a code's destination can legitimately change — a play
    // link starts pointing at the play page once a run's build is republished.
    return Response.redirect(canonicalUrl, 302);
  },
};
