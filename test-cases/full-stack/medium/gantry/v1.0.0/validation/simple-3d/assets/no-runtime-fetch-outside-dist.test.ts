// assets/no-runtime-fetch-outside-dist — the played site fetches nothing from
// outside its own served output.
//
// specs/assets.md, intro: "Production is a one-time step. The tools are
// development tools of this machine; the committed files are the assets, and
// the build bundles them, so `npm ci` and `npm run build` invoke no tool and the
// built site fetches nothing from outside its own `dist/`."
//
// WHAT "OUTSIDE ITS OWN DIST" MEANS HERE, AND THIS IS THIS ENGINE'S HALF OF THE
// POINT. There is no page and no origin: this project stands the engine up in
// this process, and every path the build asks for goes through the harness's own
// fetch, which serves the workspace's own files and nothing else. So a request
// that reaches outside the built output is exactly a request the build wrote as
// an ABSOLUTE URL — a CDN, a font host, a model or sample fetched from the web at
// play time — because a relative path cannot leave the output it is resolved
// against. Every such request would leave the built site broken wherever it is
// served without a network, which is what the requirement exists to prevent.
//
// A ROOT-ABSOLUTE PATH IS OUTSIDE IT TOO. `specs/overview.md` requires "every
// asset reference in the build is relative rather than root-absolute", because a
// leading `/` leaves the sub-path the site is served from and reaches the host's
// root instead. So a path beginning `/` fails this reading as surely as a `https:`
// URL does.
//
// EVERY REQUEST, NOT EVERY REQUEST A LISTENER CAUGHT. `h.assetRequests()` carries
// every path this build has fetched since it was initialized, including the ones
// its own `initialize` made before a check could look.
//
// THE SITE IS PLAYED, NOT JUST OPENED, because a build is free to fetch late: a
// screen's art on first arrival, a cue on first play. So every screen is shown
// and a whole run is driven to its verdict before the buffer is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  DESIGNS,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
} from "../harness";

/** The site whose reference design and tape clear it (`designs.json`). */
const SITE = 0;

/** Ticks per crossing while a run plays out, and the cap on the run. */
const STRIDE = 30;
const MAX_TICKS = 7200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fetches nothing from outside the origin its own dist is served on", async () => {
  // Every screen the game has, in the order a player meets them, then a whole
  // run: a build that fetches on arrival at a screen or on a cue's first play
  // has done it by the end of this.
  for (const screen of ["title", "howto", "select"] as const) {
    await h.debug.setScreen(screen);
    await h.advance(1);
  }
  await openSite(h, SITE);
  await h.advance(1);

  const design = DESIGNS[SITE]!;
  await poseCrane(h, design);
  await poseTape(h, design.tape);
  await h.debug.setScreen("program");
  await h.advance(1);
  await h.debug.setScreen("build");
  await startRun(h);

  let ran = 0;
  let phase = "running";
  while (ran < MAX_TICKS) {
    const state = await runTicks(h, STRIDE);
    ran += STRIDE;
    phase = state.run.phase;
    if (phase !== "running") break;
  }
  assertTrue(
    phase !== "running",
    `the reference tape for site ${SITE + 1} to reach a verdict within ` +
      `${MAX_TICKS} ticks, so this point reads a site that was played rather ` +
      "than one that was opened",
  );
  await h.advance(1);

  const fetched = h.assetRequests();

  assertGreaterThan(
    fetched.length,
    0,
    "the files the played site fetched, which this point reads off every " +
      "request the build made since it was initialized",
  );

  const outside = fetched
    .filter(
      (one) =>
        // A scheme of any kind leaves the output; so does a leading `/`, which
        // reaches the host's root rather than the path the site is served from.
        /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(one.path) || one.path.startsWith("/"),
    )
    .map((one) => one.path);

  assertEqual(
    outside.join(", "),
    "",
    "every request the played site made to be a path relative to the output " +
      'it is served from, since "the built site fetches nothing from outside ' +
      "its own `dist/`\" (specs/assets.md) and every asset reference is " +
      "relative rather than root-absolute (specs/overview.md) — these were not",
  );

  console.log(
    `gantry: every asset the played-through site requested —\n  ` +
      fetched
        .map((one) => `${one.found ? "ok " : "404"} ${one.path}`)
        .join("\n  "),
  );

  await h.capture("requests", "Every asset the played-through site requested");
});
