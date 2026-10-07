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
// WHAT IS READ. Every path the build NAMED, from the moment it was stood up
// through a round played to the end. That is two logs and it takes both: the
// transport's, which holds what was actually asked for — not only what failed,
// because a call to a host that happens to answer is exactly the failure this
// item is about — and the failed loads, because the engine's asset loader
// refuses a path that escapes its root BEFORE it fetches, so a build naming a
// host through the loader reaches no transport at all and would otherwise leave
// no trace. Two spellings name somewhere other than the served directory, and
// both are refused here: a URI scheme, which names a host, and a `..` segment,
// which climbs out of the tree.
//
// WHY `data:` AND `blob:` ARE NOT OFF-SITE. Both carry their bytes with them: an
// inlined sprite or a decoded sound handed to a URL is part of the build's own
// tree, and nothing outside it is contacted. What the rule forbids is a fetch
// that leaves the site.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. Whether the paths are page-relative,
// which is `assets/assets-load-page-relative` under a real sub-path mount; the
// build is served from its own root here, so a path merely rooted at `/` is that
// item's business and not this one's.
//
// ONE HARNESS AT A TIME. The transport that records requests is process-global
// under this engine, so the harness is built inside the check and released in a
// `finally` rather than shared through a hook.

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

/** A leading URI scheme: `http:`, `https:`, `data:`, and anything else shaped so. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/iu;

/** Schemes that carry their own bytes rather than naming somewhere to fetch from. */
const SELF_CONTAINED = ["data", "blob"];

/** Whether a path the build asked for names a location outside the served tree. */
function isOffSite(asked: string): boolean {
  const scheme = SCHEME.exec(asked);
  if (scheme !== null) return !SELF_CONTAINED.includes(scheme[1].toLowerCase());
  return asked.split("/").includes("..");
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

it("asks for nothing outside the site it was served from", async () => {
  const h = await createHarness();
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
    captureStill(h, "requests");
    await swapAndResolve(h, ESCAPE_SWAP.a, ESCAPE_SWAP.b);

    // A build that asked for nothing would pass the check below without having
    // loaded a thing, so what was asked for is counted first.
    assertGreaterThan(h.requests.length, 0, "files the build asked for");

    const named = [
      ...h.requests,
      ...h.assetFailures.map((failure) => failure.path),
    ];
    assertDeepEqual(
      reported(named.filter(isOffSite)),
      [],
      "files the build named outside the directory it was served from",
    );
  } finally {
    h.dispose();
  }
});
