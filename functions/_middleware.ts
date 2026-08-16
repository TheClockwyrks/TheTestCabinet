// Cloudflare Pages middleware for the gallery: give a run's page the preview tags
// a shared link unfurls into.
//
// Why this exists. The gallery is a client-routed single-page app, so every run
// page is served from one `index.html` whose `<head>` is written at build time and
// says nothing about any particular run. A link to a run therefore unfurls — in
// Slack, Discord, iMessage, anywhere — as a bare URL, and a search engine indexing
// it sees the same generic title on every page. Nothing in a static bundle can fix
// that, because the document is chosen before the run is known.
//
// Why it tags every visitor rather than only crawlers. Serving crawlers a different
// document from people is cloaking, which search engines penalise, and it means the
// preview is never exercised by an actual visit. So this injects into the response
// the visitor was going to get anyway: the same document, with a `<head>` that
// describes the run. A person gets a correct tab title out of it too.
//
// WHERE THIS FILE LIVES. Pages discovers `functions/` at the *project* root, which
// for this project is the repository root — the build runs `npm ci && npm run
// build:site` from there because the gallery is one workspace of an npm workspace
// repo. It cannot live under `apps/site/`, where it would otherwise belong. See
// `apps/docs/src/content/docs/development/releasing.md`.

import {
  SHARE_INDEX_PATH,
  renderMetaTags,
  type ShareEntry,
  type ShareIndex,
  type ShareTarget,
} from "@test-cabinet/share-links";

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

// The run id and share target a gallery path names, or null when the path is not a
// run page. Only the two shareable pages are tagged; a run's other tabs are for
// people already on the site.
function parseRunPath(
  pathname: string,
): { runId: string; target: ShareTarget } | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments[0] !== "runs") return null;
  const runId = decodeURIComponent(segments[1]!);
  if (segments.length === 2) return { runId, target: "verdict" };
  if (segments.length === 3 && segments[2] === "play") {
    return { runId, target: "play" };
  }
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

export const onRequest = async (context: Context): Promise<Response> => {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const parsed = parseRunPath(url.pathname);

  // Every other path — the bulk of them — is untouched and costs one comparison.
  if (!parsed) return next();

  const response = await next();
  // Only rewrite the app shell. An asset that happens to sit under /runs (the
  // build emits `runs/<id>.json`) is served as itself.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const index = await loadIndex(request, env);
  if (!index) return response;
  const entry = entryForRun(index, parsed.runId);
  // An unpublished or unknown run has no card to show; the page still renders and
  // says so itself.
  if (!entry) return response;

  const canonicalUrl = `${index.origin}${url.pathname}`;
  const tags = renderMetaTags(entry, parsed.target, canonicalUrl);
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
