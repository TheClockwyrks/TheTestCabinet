// assets/assets-work-from-a-sub-path — the built site runs served from a
// sub-path, because nothing in it is addressed from the server's root.
//
// specs/overview.md § The build interface states it outright: "`npm ci` followed
// by `npm run build` produces the complete static site into `dist/` at the
// repository root, with an `index.html` at the root of that directory as the
// entry point. That directory runs correctly when served as-is at the root of any
// static file server, and equally when served from a sub-path, so every asset
// reference in the build is relative rather than root-absolute." specs/assets.md
// says the same thing of the produced files under this engine: "Reference every
// asset page-relative, never by a root-absolute URL: the built site is served
// from a sub-path as well as from a root".
//
// WHAT DECIDES IT HERE IS THE ADDRESS ITSELF. The engineless project serves the
// built `dist/` three directories down and requires the game to come up; this
// project has no page and no server — it stands the engine up in Node, over the
// one transport `validation/host.ts` installs — so what it reads is the thing a
// sub-path would break: the FORM of every URL the build asks for. A page-relative
// URL resolves against wherever the document stands and so answers the same file
// under any prefix; a root-absolute one ignores the prefix entirely and reaches
// for a file the host is not serving there; and one that climbs out with `..`
// leaves the served tree the moment the tree is not at the root.
//
// SO EVERY REQUEST IS JUDGED, AND THE SITE IS PLAYED FIRST, because a build is
// free to fetch late: a screen's art on first arrival, a cue on first play. Every
// screen is shown and a run is driven before the record is read.
//
// AND EVERY ONE OF THEM RESOLVED, which is the other half of the sentence: a
// reference that is relative but names a file the build never produced would
// answer this point's letter and still leave the site broken wherever it is
// served.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/**
 * How long the site is played once it is up, in ticks.
 *
 * Long enough to be a run that is genuinely running rather than a run that has
 * just started, and no longer: the build fetches what it needs before it installs
 * its surface, so the requests this point reads are already made by the time the
 * first tick is driven, and every tick past a few tenths of a second of run clock
 * adds nothing to what it decides.
 */
const PLAY_TICKS = 20;

/** A URL that would not survive being served from a sub-path, or `null`. */
function rootAnchored(url: string): string | null {
  if (/^(data|blob):/i.test(url)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
    return "it carries a scheme, so it names a host rather than a file of the site";
  }
  if (url.startsWith("/")) {
    return "it is root-absolute, so a sub-path prefix is ignored";
  }
  if (url.split(/[?#]/)[0]!.split("/").includes("..")) {
    return "it climbs out of the served tree with `..`";
  }
  return null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("addresses every asset page-relative, so the site runs from a sub-path", async () => {
  // Every screen the game has, then a run: a build that fetches on arrival at a
  // screen or on a cue's first play has done it by the end of this.
  for (const screen of ["title", "howto", "select"] as const) {
    await h.debug.setScreen(screen);
    await h.advance(1);
  }
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  const ran = await runTicks(h, PLAY_TICKS);
  await h.capture(
    "sub-path",
    "The site played, with every asset addressed page-relative",
  );

  assertTrue(
    ran.run.phase === "running",
    "the run to still be going when the record is read, so what this point " +
      `reads is a site that was played rather than one that was opened (it is "${ran.run.phase}")`,
  );

  const asked = h.requests();
  assertGreaterThan(
    asked.length,
    0,
    "the files the played build fetched, which this point reads off the one " +
      "transport the harness installs",
  );

  const anchored = asked
    .map((one) => ({ url: one.url, why: rootAnchored(one.url) }))
    .filter((one) => one.why !== null)
    .map((one) => `${one.url} — ${one.why!}`);
  assertEqual(
    anchored.join(", "),
    "",
    "every asset the build asks for to be addressed page-relative, since " +
      '"the built site is served from a sub-path as well as from a root" ' +
      "(specs/assets.md, specs/overview.md) — these were not",
  );

  const missing = asked
    .filter((one) => one.status >= 400)
    .map((one) => `${one.url} → ${String(one.status)}`);
  assertEqual(
    missing.join(", "),
    "",
    "every asset the build asks for to resolve, so a relative reference " +
      "names a file the build actually produced (specs/assets.md) — these did " +
      "not",
  );
});
