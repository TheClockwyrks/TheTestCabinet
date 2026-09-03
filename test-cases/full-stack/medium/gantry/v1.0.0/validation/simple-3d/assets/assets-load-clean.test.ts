// assets/assets-load-clean — every asset the built site asks for resolves.
//
// specs/assets.md, "Consuming a model": "the built output carrying every
// produced file under that root is the build's to arrange"; and
// specs/overview.md, "The build interface": "`npm ci` followed by `npm run
// build` produces the complete static site into `dist/` … That directory runs
// correctly when served as-is at the root of any static file server, and equally
// when served from a sub-path, so every asset reference in the build is relative
// rather than root-absolute."
//
// WHAT FAILS THIS POINT. A produced file left out of the built output; a file
// referenced at a path that does not resolve where the site is served from —
// which is what a root-absolute URL does the moment the site is served from a
// sub-path; a name that no longer matches the file after a rename. Each of them
// reaches the page as a request that did not resolve, and each leaves the game
// missing a model or silent on a cue.
//
// THE READING IS EVERY REQUEST'S OWN OUTCOME, AND THIS IS THIS ENGINE'S HALF OF
// THE POINT. There is no page here: this project stands the engine up in this
// process, and `h.assetRequests()` carries every path the build has fetched since
// it was initialized — the ones its own `initialize` made before a check could
// look, as well as the ones a driven screen makes later — with whether the
// output carried the file. A second reading is taken off the engine's own
// `asset:failed` events, so a file that arrived and would not decode is seen
// beside one that never arrived at all.
//
// THERE IS NO BROWSER PROBE TO EXCLUDE. Chromium asks every document it loads for
// a favicon, and an engineless build's version of this point has to set that
// request aside; nothing here asks for anything the build did not.
//
// A WHOLE SITE IS PLAYED, because a build is free to fetch late and a missing
// file would then only show up on the screen that wanted it.
//
// WHAT THIS POINT DOES NOT READ. The page's console. A build is free to log
// whatever it likes, and the browser itself logs its own unanswered favicon
// probe there, so a console reading would grade something other than whether the
// assets loaded. This point reads request outcomes and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
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

it("plays a whole site through with no asset request failing", async () => {
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

  let phase = "running";
  for (let ran = 0; ran < MAX_TICKS; ran += STRIDE) {
    const state = await runTicks(h, STRIDE);
    phase = state.run.phase;
    if (phase !== "running") break;
  }
  assertEqual(
    phase,
    "cleared",
    `the reference tape for site ${SITE + 1} to clear it, so this point reads ` +
      "a site that was attached, placed and cleared rather than one that was " +
      "opened",
  );
  await h.advance(1);

  const asked = h.assetRequests();

  assertGreaterThan(
    asked.length,
    0,
    "the files the played site fetched, which this point reads off every " +
      "request the build made since it was initialized",
  );

  const failed = asked.filter((one) => !one.found).map((one) => one.path);
  assertEqual(
    failed.join(", "),
    "",
    "every request the played site made to resolve, so no produced file is " +
      "missing from the built output or asked for at a path that does not " +
      "resolve (specs/assets.md, specs/overview.md) — these did not",
  );

  assertEqual(
    h.assetFailures.map((one) => `${one.path} (${one.reason})`).join(", "),
    "",
    "no asset the engine loaded for the build to fail on the way in, so every " +
      "produced file the played site asked for arrived and decoded " +
      "(specs/assets.md)",
  );

  console.log(
    `gantry: the play-through with every asset loaded —\n  ` +
      asked.map((one) => `${one.found ? "ok " : "404"} ${one.path}`).join("\n  "),
  );

  await h.capture("run", "The play-through with every asset loaded");
});
