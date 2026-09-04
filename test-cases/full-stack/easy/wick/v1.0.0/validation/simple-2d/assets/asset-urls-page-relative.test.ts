// Wick — assets/asset-urls-page-relative: every URL the running build asks for
// resolves against the page rather than against the origin root.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (Where the files land): "The loader resolves every path
//     under one root, `assets/`, relative to the page the build is served from,
//     so the build asks it for a path written relative to that root, such as
//     `sprites/ground.png` and `audio/hit.wav`, rather than constructing a URL
//     of its own."
//   - The review item states what that buys: "so the built site runs unchanged
//     mounted under a sub-path". A URL resolved against the origin root, or
//     against a host, escapes the mount and finds nothing there.
//
// WHAT IS READ. Every URL the build puts on the transport, watched from before
// its `initialize` runs: none of them carries a URI scheme and none of them
// begins with `/`. A path handed to the engine's loader arrives in that form by
// construction, so what this catches is a build that reached past the loader
// and built a URL of its own.
//
// WHY THE WATCH IS INSTALLED THE WAY IT IS. The harness stands its own `fetch`
// up over the workspace on the FIRST open of the process, so a watcher must be
// installed after that to wrap it rather than be wrapped by it; `watchRequests`
// opens and disposes one harness to force that order, and only then wraps.
//
// WHAT IT DELIBERATELY DOES NOT READ. Only the FORM of the URLs is decided
// here. Whether each file then arrived and was drawn is the produced-file
// points' business, and a build that asks for nothing at all has no URL to get
// wrong — which the loading point, `assets/assets-decoded-before-first-frame`,
// is what catches.
//
// WHY A NIGHT IS DRIVEN. One frame past the boot, so any URL a build asks for
// on its first frame rather than during `initialize` is on the record too.
//
// TOLERANCE. None. A URL is relative or it is not.

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
      `initialize rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await h.frameDraw();
  captureStill(h, "resolved");

  const escaped = watch.urls.filter(escapesThePage);
  if (escaped.length > 0) {
    fail(
      "every URL the build requests resolving against the page — relative, " +
        "with no scheme and no leading slash (specs/assets.md)",
      `URLs resolved against the origin root or a host: ${escaped
        .slice(0, 5)
        .join(", ")}`,
    );
  }
});
