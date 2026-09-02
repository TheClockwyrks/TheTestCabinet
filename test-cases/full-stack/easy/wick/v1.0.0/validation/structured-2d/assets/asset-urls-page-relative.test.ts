// assets/asset-urls-page-relative — every URL the running build asks for
// resolves against the page rather than against the origin root.
//
// WHAT THIS DECIDES. One reading of the transport: of every URL the build put
// on it from before `initialize` ran through its first drawn frame, none
// carries a URI scheme and none begins with `/`. Both of those escape the
// directory the page was mounted in, so a build that emits either finds
// nothing under a sub-path.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Where the files land, and
// how they are loaded"): "The loader resolves every path under one root,
// `assets/`, relative to the page the build is served from, so the build asks
// it for a path written relative to that root, such as `sprites/ground.png`
// and `audio/hit.wav`, rather than constructing a URL of its own." The review
// item states what that buys: the built site "runs unchanged mounted under a
// sub-path".
//
// WHY THE FORM OF THE URL IS THE WHOLE READING. A path handed to the engine's
// loader arrives page-relative by construction, so what is left for this
// point to catch is a build that reached past the loader and constructed a
// URL of its own — an absolute path, or a host.
//
// HOW THE WATCH IS INSTALLED. `harness.ts` stands its own `fetch` up over the
// workspace on the FIRST harness of the process, so a watcher has to be
// installed after that to wrap it rather than be wrapped by it.
// `watchRequests` opens and disposes a throwaway harness to force that order,
// and only then wraps; the harness under watch is the one opened afterwards.
//
// WHAT IT DELIBERATELY DOES NOT READ. Whether each file then arrived and was
// decoded is `assets/assets-decoded-before-first-frame` and the produced-file
// points; a build that asks for nothing has no URL to get wrong here, and
// that point is what fails it.
//
// WHY NO WORLD IS POSED. The scenario IS the boot: the harness is opened,
// which is the engine initializing the build's game over the watched
// transport, and one frame runs after it so a URL a build asks for on its
// first frame rather than during `initialize` is on the record too.
//
// THE TOLERANCE. None. A URL is page-relative or it is not.

import { afterEach, it } from "vitest";
import { fail } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { watchRequests, type RequestWatch } from "./requests";

/** A leading URI scheme: `http:`, `data:`, `file:`, and the rest. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A URL that resolves against the origin root (`/...`) or a host (`//...`). */
function escapesThePage(url: string): boolean {
  return SCHEME.test(url) || url.startsWith("/");
}

/** How many offending URLs a failure names before it stops listing them. */
const NAMED = 5;

let watch: RequestWatch | null = null;
let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
  watch?.restore();
  watch = null;
});

it("asks for every produced file by a page-relative URL", async () => {
  watch = await watchRequests();
  try {
    h = await createHarness();
  } catch (error) {
    fail(
      "the build initializing over the engine's loader, every request a " +
        "page-relative URL (specs/assets.md, where the files land)",
      `initialize rejected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  await h.frameDraw();
  captureStill(h, "resolved");

  const escaped = watch.urls.filter(escapesThePage);
  if (escaped.length > 0) {
    fail(
      "every URL the build requests resolving against the page — no scheme " +
        "and no leading slash (specs/assets.md, where the files land)",
      `URLs resolved against the origin root or a host: ${escaped
        .slice(0, NAMED)
        .join(", ")}`,
    );
  }
});
