// assets/assets-load-page-relative — mounted under a sub-path, the build still
// gets everything it asks for.
//
// specs/assets.md is explicit about the deployment: the built site "is not
// guaranteed to be served from the root of its origin; it is played back mounted
// under a per-run sub-path, a path like `/runs/<id>/build/`". From that it draws
// the rule this item reads — "Reference every asset page-relative, as
// `assets/gems/ruby.png`, which resolves against the document wherever the site
// is mounted", and its opposite, "A root-absolute URL, a leading `/` as in
// `/assets/ruby.png`, resolves against the origin root and 404s under a
// sub-path". specs/overview.md's build interface says the same of the whole
// tree: `dist/` "runs correctly when served as-is at the root of any static file
// server, and equally when served from a sub-path".
//
// HOW THE MOUNT IS REAL RATHER THAN LENIENT. The harness opens the page at the
// sub-path AND answers everything the build then asks for outside it with a 404,
// which is what the origin root of a real per-run deployment holds: nothing of
// this build. So a build that spelled one asset `/assets/...` does not quietly
// succeed here — it gets the 404 the specification says it gets, and the failure
// lands on this item.
//
// WHAT IS DRIVEN, AND WHY THAT MUCH. Everything specs/assets.md commits is
// loaded at run time, and a build is free to load a file when it first needs it
// rather than at startup. So the drive reaches for as many of them as one round
// can: the audio is opened so the `.wav`s decode, a board is posed, and a swap
// is carried through its whole chain, which is what puts a break sheet, a
// particle system and a cue in front of the loader.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. Whether the build fetches anything
// OFF-SITE — that is `assets/no-external-fetch` — or which produced files exist,
// which the per-file items read off disk. This reads one thing: served from a
// sub-path, every URL the build resolved landed inside the mount and answered.

import { it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import { ESCAPE_SWAP, quietRowsWithEscape, swapIsLegal } from "../board";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  swapAndResolve,
} from "../harness";

/** The shape of mount specs/assets.md names: a per-run sub-path, not the root. */
const MOUNT = "/runs/7/build/";

/**
 * Whether a URL names this deployment at all.
 *
 * The mount is a statement about where on THIS site the build looked, so only a
 * URL this site would have served is held to it. A `data:` or `blob:` URL
 * carries its bytes inside the page and no server answers it; a URL on some
 * other host is a fetch that left the site, which is
 * `assets/no-external-fetch`'s to fail rather than this item's.
 */
function isOnSite(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** The URL a failure line names: the reason, one space, then the URL. */
function urlOf(failure: string): string {
  return failure.slice(failure.indexOf(" ") + 1);
}

/**
 * The head of a list of offenders, so a build that got one URL wrong reads as
 * clearly as one that got a hundred wrong.
 *
 * Sound as an assertion: an empty list truncates to an empty list, so nothing
 * passes here that would not have passed on the whole of it.
 */
const REPORTED = 6;

function reported(items: readonly string[]): string[] {
  return items.length <= REPORTED
    ? [...items]
    : [...items.slice(0, REPORTED), `and ${items.length - REPORTED} more`];
}

it("resolves every file it loads inside the sub-path it is mounted at", async () => {
  const h = await createHarness({ basePath: MOUNT });
  try {
    if (h.surfaceFault !== null) failSurface(h.surfaceFault);
    const page = new URL(h.page.url());
    // The page is genuinely at the sub-path, so every relative URL under it
    // resolves from there rather than from the origin root.
    assertEqual(page.pathname, MOUNT, "the path the built site is mounted at");

    // The audio is opened first, so the `.wav`s are decoded rather than left
    // waiting on a gesture that never comes.
    await h.armAudio();
    await h.warmAudio();

    const posed = quietRowsWithEscape([]);
    // The filler's own planted swap, so the scenario carries no fixture of its
    // own; asserted legal here so anything that fails below is the build's.
    assertTrue(
      swapIsLegal(posed, ESCAPE_SWAP.a, ESCAPE_SWAP.b),
      "R1 and R3 accept the escape swap",
    );
    await loadBoard(h, posed);
    await h.advance(1);
    await captureStill(h, "subpath");
    await swapAndResolve(h, ESCAPE_SWAP.a, ESCAPE_SWAP.b);

    // A build that asked for nothing would pass the two checks below without
    // having loaded a thing, so what was asked for is counted first.
    assertGreaterThan(h.requests.length, 0, "files the build asked for");

    // Nothing 404'd: every URL the build resolved names a file this mount holds.
    assertDeepEqual(
      reported(
        h.failedRequests.filter((failure) => isOnSite(urlOf(failure), page.origin)),
      ),
      [],
      "requests the mounted site did not answer",
    );

    // And the reason it answered is the URLs themselves, rather than a lenient
    // server: not one of them reached past the mount toward the origin root.
    assertDeepEqual(
      reported(
        h.requests
          .filter((url) => isOnSite(url, page.origin))
          .filter((url) => !new URL(url).pathname.startsWith(MOUNT)),
      ),
      [],
      `requests that resolved outside the ${MOUNT} mount`,
    );
  } finally {
    await h.dispose();
  }
});
