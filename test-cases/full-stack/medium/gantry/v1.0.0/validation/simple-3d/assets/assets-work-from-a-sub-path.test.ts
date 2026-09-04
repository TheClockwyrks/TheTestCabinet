// assets/assets-work-from-a-sub-path — the built site runs served from a
// sub-path, because nothing in it is addressed from the server's root.
//
// specs/overview.md § The build interface states it outright: "`npm ci` followed
// by `npm run build` produces the complete static site into `dist/` at the
// repository root, with an `index.html` at the root of that directory as the
// entry point. That directory runs correctly when served as-is at the root of any
// static file server, and equally when served from a sub-path, so every asset
// reference in the build is relative rather than root-absolute." specs/assets.md
// says the same thing of the produced files under this engine: the loader
// "resolves every path under one root, `ASSET_ROOT` (`assets/`), relative to the
// page the build is served from… A path the loader resolves reaches the file at
// whatever base path the site is served from, but only where the built site
// carries that file under the root: the supplied toolchain does not copy
// `assets/` into `dist/`, so the built output carrying every produced file under
// that root is the build's to arrange." And § Hard requirements closes the set:
// "The build fetches nothing at runtime from outside its own `dist/`."
//
// THIS ENGINE'S HALF OF THE POINT IS THAT THERE IS NO SERVER TO POINT AT A
// SUB-PATH. This project stands the engine up in this process rather than loading
// a page, so an engineless build's version of this check — serve `dist/` three
// directories down, answer everything else with a `404`, and see whether the site
// comes up — has nothing to serve. What it was reading, though, is exactly two
// facts about the build, and both are readable here:
//
//   - EVERY PATH THE BUILD ASKS FOR IS RELATIVE. A path with a scheme, or one
//     beginning `/`, reaches the host's root rather than the directory the site
//     was served from, and a path climbing out with `..` reaches above it. Any of
//     the three is a request a sub-path deployment answers with a `404`.
//   - AND `dist/` CARRIES IT. A relative path only resolves where the served
//     output holds the file, and the toolchain does not copy `assets/` there, so
//     a produced file the build never arranged into `dist/` is exactly the
//     request the sub-path server could not answer.
//
// THE ENTRY POINT IS READ TOO, because the bundle's own references are addressed
// before a line of the build has run: an `index.html` that names its script or
// its stylesheet from the root never loads at all under a sub-path, and no
// request the build made would ever show it.
//
// A SITE THAT LOADS IS NOT YET A SITE THAT RUNS, so the game is played the way
// any other point plays it — a site opened, a crane stood up, a tape appended, a
// run started and ticked — before the requests are read, because a build is free
// to fetch late.

import { existsSync, readFileSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, fail } from "../assert";
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

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** What `npm run build` writes, and what a static host serves (specs/overview.md). */
const DIST = resolve(join(WORKSPACE, "dist"));

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

/** An address in `index.html` that reaches the host's root rather than the page. */
const ROOT_ABSOLUTE = /\s(?:src|href)\s*=\s*["']\/(?!\/)/gi;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs from a sub-path, reaching every asset it needs", async () => {
  // The entry point, before anything the build asks for at run time.
  const index = join(DIST, "index.html");
  assertTrue(
    existsSync(index),
    "an index.html at the root of dist/ as the entry point " +
      "(specs/overview.md § The build interface)",
  );
  const rooted = [...readFileSync(index, "utf8").matchAll(ROOT_ABSOLUTE)].map(
    (one) => one[0]!.trim(),
  );
  assertEqual(
    rooted.join(", "),
    "",
    "every reference in the built index.html to be relative rather than " +
      "root-absolute, since dist/ runs equally when served from a sub-path " +
      "(specs/overview.md § The build interface) — these are addressed from " +
      "the server's root",
  );

  // And played: a site opened, a crane stood up, a tape appended, a run run.
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  const ran = await runTicks(h, PLAY_TICKS);
  await h.capture("sub-path", "The site played from a sub-path");

  assertEqual(
    ran.run.phase,
    "running",
    `the run's phase after ${PLAY_TICKS} ticks, which runs the simulation ` +
      "exactly as it does at a root",
  );
  assertEqual(ran.run.tick, PLAY_TICKS, `the ticks the run has taken`);

  const asked = h.assetRequests();
  assertTrue(
    asked.length > 0,
    "the files the played site fetched, which this point holds to the " +
      "sub-path rule",
  );

  const unanswered: string[] = [];
  for (const { path } of asked) {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(path)) {
      unanswered.push(`${path} (an absolute URL, outside the served output)`);
      continue;
    }
    if (path.startsWith("/")) {
      unanswered.push(`${path} (root-absolute, outside the sub-path)`);
      continue;
    }
    const within = normalize(path.split("/").join(sep));
    const file = resolve(join(DIST, within));
    if (file !== DIST && !file.startsWith(DIST + sep)) {
      unanswered.push(`${path} (reaching outside dist/)`);
      continue;
    }
    if (!existsSync(file)) {
      unanswered.push(`${path} (no such file under dist/)`);
    }
  }

  if (unanswered.length > 0) {
    fail(
      "every request the built site makes to be a relative path the served " +
        "output carries, since specs/overview.md has every asset reference in " +
        "the build be relative rather than root-absolute and the built output " +
        "carrying every produced file under ASSET_ROOT is the build's to " +
        "arrange (specs/assets.md) — a sub-path deployment answers each of " +
        "these with a 404",
      unanswered.join(", "),
    );
  }
});
