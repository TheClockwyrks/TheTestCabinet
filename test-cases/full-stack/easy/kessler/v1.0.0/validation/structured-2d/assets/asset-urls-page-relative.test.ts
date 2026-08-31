// assets/asset-urls-page-relative — asset URLs resolve against the page.
//
// specs/assets.md: the engine's loader "resolves every path under one root,
// `assets/`, relative to the page the build is served from, so the build asks
// it for a path written relative to that root, such as `sprites/planet.png`
// and `audio/paddle-bounce.wav`, rather than constructing a URL of its own."
// A URL that resolves against the page is what keeps the built site running
// unchanged under a sub-path mount; one resolved against the origin root
// escapes the mount and fails there.
//
// So the reading is the URLs the build's loading actually puts on the
// transport, watched from before its `initialize` runs: every one of them is
// page-relative — no URI scheme, no leading slash. A path handed to the loader
// arrives in that form by construction; a URL the build constructed itself
// against the origin root (`/assets/...`), a protocol-relative host, or an
// absolute one arrives as exactly what the sentence rules out, and is named.
// Direction: only the FORM of the URLs is decided here. Whether each file
// then arrived and drew is the produced-file items' business, and a build
// that inlined everything and asks for nothing has no URL to get wrong.

import { afterEach, it } from "vitest";
import { fail } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { watchRequests, type RequestWatch } from "./asset-requests";

/** A leading URI scheme: `http:`, `data:`, `file:`, ... */
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
    h = await openHarness();
  } catch (error) {
    fail(
      "the build initializing over the engine's loader, its every request a page-relative URL (specs/assets.md, where the files land)",
      `initialize rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await h.tick(1);
  captureStill(h, "resolved");

  const escaped = watch.urls.filter(escapesThePage);
  if (escaped.length > 0) {
    fail(
      "every URL the build requests resolving against the page — relative, with no scheme and no leading slash (specs/assets.md, where the files land)",
      `URLs resolved against the origin root or a host: ${escaped
        .slice(0, 5)
        .join(", ")}`,
    );
  }
});
