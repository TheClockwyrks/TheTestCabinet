// Cloudflare Pages middleware for the gallery. It owns the two things a
// client-routed single-page app cannot do for itself, because both are decided
// before the app runs: what a shared run link unfurls into, and what status an
// unrecognized URL is answered with.
//
// **Preview tags.** Every run page is served from one `index.html` whose `<head>`
// is written at build time and says nothing about any particular run. A link to a
// run therefore unfurls — in Slack, Discord, iMessage, anywhere — as a bare URL,
// and a search engine indexing it sees the same generic title on every page.
// Nothing in a static bundle can fix that, because the document is chosen before
// the run is known.
//
// The tags go to every visitor rather than only to crawlers. Serving crawlers a
// different document from people is cloaking, which search engines penalise, and
// it means the preview is never exercised by an actual visit. So this injects into
// the response the visitor was going to get anyway: the same document, with a
// `<head>` that describes the run. A person gets a correct tab title out of it too.
//
// **404s.** The gallery ships no `404.html`, which is what makes Pages answer an
// unmatched path with the app shell at the requested URL — the SPA fallback a deep
// link such as `/runs/<id>` depends on. The cost of that is indiscriminate: a
// mistyped URL is answered with the shell and a `200` as well, so every wrong
// address became an indexable page that rendered nothing. Restoring `404.html`
// would break the deep links again, since Pages would serve it for those too.
//
// So the status is decided here, where the path can actually be examined. A path
// no route addresses is answered with the shell and a `404`; the app's catch-all
// route renders the not-found page inside it. Two facts make this exact rather
// than a guess: the route table is imported from the app itself, and the share
// index says which run ids exist. See `isKnownRoute` for the one case it is
// deliberately coarse about.
//
// WHERE THIS FILE LIVES. Pages discovers `functions/` at the *project* root, which
// for this project is the repository root — the build runs `npm ci && npm run
// build:site` from there because the gallery is one workspace of an npm workspace
// repo. It cannot live under `apps/site/`, where it would otherwise belong. Which
// requests reach it at all is decided by `apps/site/public/_routes.json`. See
// `apps/docs/src/content/docs/development/releasing.md`.

import {
  SHARE_INDEX_PATH,
  renderMetaTags,
  type ShareEntry,
  type ShareIndex,
  type ShareTarget,
} from "@test-cabinet/share-links";
import { isKnownRoute } from "@test-cabinet/ui/routes";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

type Context = {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
};

// How long a fetched share index is reused within one isolate. The index changes
// only when the gallery is rebuilt, and a rebuild replaces the deployment this
// middleware runs in, so this is a guard against re-fetching on every request
// rather than a correctness-relevant staleness window.
const INDEX_TTL_MS = 60_000;

let cachedIndex: { at: number; index: ShareIndex } | null = null;

// The share index, from this deployment's own assets. Same-origin by construction,
// so the tags can never describe a run the page being served does not have.
async function loadIndex(
  request: Request,
  env: Env,
): Promise<ShareIndex | null> {
  const now = Date.now();
  if (cachedIndex && now - cachedIndex.at < INDEX_TTL_MS) {
    return cachedIndex.index;
  }
  try {
    const url = new URL(request.url);
    url.pathname = `/${SHARE_INDEX_PATH}`;
    url.search = "";
    const response = await env.ASSETS.fetch(new Request(url.toString()));
    if (!response.ok) return null;
    const index = (await response.json()) as ShareIndex;
    cachedIndex = { at: now, index };
    return index;
  } catch {
    // A preview is a decoration on a page that works without it, so a failure to
    // read the index must never cost the visitor the page itself.
    return null;
  }
}

// The run id a gallery path names, or null when the path is not under a run.
// Every `/runs/:runId/...` route counts, not only the two shareable ones: whether
// the run exists is the same question on all of them.
function runIdFor(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments[0] !== "runs") return null;
  const runId = decodeURIComponent(segments[1]!);
  // `/runs/failures`, `/runs/unreviewed` and `/runs/new` are literal siblings of
  // the `:runId` param, not run ids. They are console-only, so on the gallery
  // they fall through to the not-found page like any other unmounted route.
  if (["failures", "unreviewed", "new"].includes(runId)) return null;
  return runId;
}

// Which of a run's two shareable pages a path names, or null for its other tabs.
// Only these two get preview tags; the rest are for people already on the site.
function shareTargetFor(pathname: string): ShareTarget | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 2) return "verdict";
  if (segments.length === 3 && segments[2] === "play") return "play";
  return null;
}

// Find a run's entry. The index is keyed by short code, so this is a scan — over a
// corpus of published runs, on a request that is already fetching a document.
function entryForRun(index: ShareIndex, runId: string): ShareEntry | null {
  for (const entry of Object.values(index.entries)) {
    if (entry.runId === runId) return entry;
  }
  return null;
}

// Replace the shell's build-time `<title>` and append the run's tags. The shell
// carries exactly one `<title>` and no meta tags of its own, so removing that one
// element is enough to leave the injected set unopposed.
class HeadRewriter {
  constructor(private readonly tags: string) {}

  element(element: {
    append: (content: string, options: { html: boolean }) => void;
  }): void {
    element.append(`\n    ${this.tags}\n  `, { html: true });
  }
}

class TitleRemover {
  element(element: { remove: () => void }): void {
    element.remove();
  }
}

// The app shell, answered as a 404. The body is the same document either way —
// the app's catch-all route renders the not-found page from the URL — so this only
// corrects the status, and tells crawlers not to index a page that says nothing.
//
// `Response` bodies are streams and cannot be re-read, so the status is changed by
// constructing a new response around the same body rather than by copying it.
function asNotFound(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex");
  return new Response(response.body, {
    status: 404,
    statusText: "Not Found",
    headers,
  });
}

export const onRequest = async (context: Context): Promise<Response> => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const response = await next();

  // Only the app shell is ours to reason about. A static asset — the bundle, a
  // logo, the build's per-run `runs/<id>.json` records, which share a prefix with
  // the run pages and so cannot be excluded in `_routes.json` — is served as
  // itself, at whatever status it already carries.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  // A path no route addresses is a wrong address, whatever Pages answered it
  // with. This is checked before anything is fetched, because it needs nothing.
  if (!isKnownRoute(url.pathname)) return asNotFound(response);

  const runId = runIdFor(url.pathname);
  const index = await loadIndex(request, env);

  // Without the index there is nothing to add and nothing to check. The page
  // still renders, which is the right failure: a preview is a decoration, and a
  // 404 must never be manufactured out of an infrastructure hiccup.
  if (!index) return response;

  if (!runId) return response;
  const entry = entryForRun(index, runId);
  if (!entry) {
    // The path is shaped like a run page but names no published run. The gallery
    // holds exactly the published corpus — the share index is built from the same
    // list of runs the bundle is — so this is a dead run link, not a run that is
    // merely private here.
    return asNotFound(response);
  }

  const target = shareTargetFor(url.pathname);
  // A real run, on one of its non-shareable tabs: correct page, no preview card.
  if (!target) return response;

  const canonicalUrl = `${index.origin}${url.pathname}`;
  const tags = renderMetaTags(entry, target, canonicalUrl);
  return new HTMLRewriter()
    .on("head > title", new TitleRemover())
    .on("head", new HeadRewriter(tags))
    .transform(response);
};

// `HTMLRewriter` is a Workers runtime global. Declared here rather than pulled in
// from `@cloudflare/workers-types` because this one global is the entire surface
// this file uses, and the repo typechecks it with the shared DOM lib.
interface HTMLRewriterInstance {
  on(selector: string, handlers: unknown): HTMLRewriterInstance;
  transform(response: Response): Response;
}

declare const HTMLRewriter: new () => HTMLRewriterInstance;
