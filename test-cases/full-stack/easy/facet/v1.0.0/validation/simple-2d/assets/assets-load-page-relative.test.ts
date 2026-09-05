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
// HOW THE MOUNT IS POSED, AND WHERE THE VERDICT COMES FROM. The harness records
// every path the build resolves against the mounted base and refuses none of
// them — every produced file is stood up for this check as for every other — so
// the verdict is read off those paths. A build that spelled one asset
// `/assets/...` is caught by that reading rather than by a withheld file.
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
// sub-path, every path the build resolved landed inside the mount and answered.
//
// ONE HARNESS AT A TIME. The transport that records requests and poses the mount
// is process-global under this engine, so the harness is built inside the check
// and released in a `finally` rather than shared through a hook.

import { it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertTrue } from "../assert";
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
 * Whether a path the build asked for resolves against the origin root rather
 * than against the page.
 *
 * The leading `/` is the whole of it: that is the spelling specs/assets.md says
 * "resolves against the origin root and 404s under a sub-path".
 */
function isRootAbsolute(asked: string): boolean {
  return asked.startsWith("/");
}

/**
 * Whether a path the build named is one this deployment could serve at all.
 *
 * The mount is a statement about where on THIS site the build looked, so a path
 * that names a host is not held to it: that is a fetch that left the site, and
 * `assets/no-external-fetch`'s to fail rather than this item's.
 */
function isOnSite(asked: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/iu.test(asked);
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
    loadBoard(h, posed);
    await h.advance(1);
    captureStill(h, "subpath");
    await swapAndResolve(h, ESCAPE_SWAP.a, ESCAPE_SWAP.b);

    // A build that asked for nothing would pass the checks below without having
    // loaded a thing, so what was asked for is counted first.
    assertGreaterThan(h.requests.length, 0, "files the build asked for");

    // Every produced file loaded: nothing the build asked for went unanswered.
    // A path the loader itself refused for escaping the asset root is in here
    // too, and it is the same fault — an asset named from the origin root.
    assertDeepEqual(
      reported(
        h.assetFailures
          .filter((failure) => isOnSite(failure.path))
          .map((failure) => `${failure.path}: ${failure.reason}`),
      ),
      [],
      "assets the mounted site did not answer",
    );

    // And the paths themselves are page-relative: not one of them was rooted at
    // the origin, which is what the item decides.
    assertDeepEqual(
      reported(h.requests.filter(isRootAbsolute)),
      [],
      `paths that resolved against the origin root rather than the ${MOUNT} mount`,
    );
  } finally {
    h.dispose();
  }
});
