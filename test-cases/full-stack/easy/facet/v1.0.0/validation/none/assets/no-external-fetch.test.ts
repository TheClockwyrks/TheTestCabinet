// assets/no-external-fetch — everything the running build asks for comes from
// the site it was served from.
//
// specs/overview.md's hard requirements state it twice. "The build fetches
// nothing at runtime from outside its own `dist/`", and "Run in the browser with
// no backend. Everything needed to play is self-contained, and no API key or
// credential is needed to build, run, or play." specs/assets.md gives the reason
// the rule has teeth: the whole of what the game shows and plays is produced
// during the run and committed under `public/assets/`, so a build reaching a CDN
// for a font, an icon, a sound or a library at play time is one whose finished
// site does not hold what it needs.
//
// WHAT IS READ. Every request the page made, from the first byte of the document
// through a round played to the end — not only the ones that failed, because a
// call to a host that happens to answer is exactly the failure this item is
// about. Each is held to the origin the site was served from.
//
// WHY `data:` AND `blob:` ARE NOT OFF-SITE. Both carry their bytes inside the
// page: an inlined sprite or a decoded sound handed to a URL is part of the
// build's own tree, and nothing outside it is contacted. What the rule forbids
// is a fetch that leaves the site.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. Whether the URLs are page-relative,
// which is `assets/assets-load-page-relative` under a real sub-path mount; the
// site is served at its origin root here so that a request off the origin is the
// only thing that can fail this.

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

/** URL schemes that carry their own bytes rather than naming somewhere to fetch from. */
const SELF_CONTAINED = ["data:", "blob:"];

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

it("asks for nothing outside the site it was served from", async () => {
  const h = await createHarness();
  try {
    if (h.surfaceFault !== null) failSurface(h.surfaceFault);
    const origin = new URL(h.page.url()).origin;

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
    await captureStill(h, "requests");
    await swapAndResolve(h, ESCAPE_SWAP.a, ESCAPE_SWAP.b);

    // A build that asked for nothing would pass the check below without having
    // loaded a thing, so what was asked for is counted first.
    assertGreaterThan(h.requests.length, 0, "files the build asked for");

    assertDeepEqual(
      reported(
        h.requests.filter((url) => {
          const parsed = new URL(url);
          if (SELF_CONTAINED.includes(parsed.protocol)) return false;
          return parsed.origin !== origin;
        }),
      ),
      [],
      `requests made off ${origin}, the site the build was served from`,
    );
  } finally {
    await h.dispose();
  }
});
