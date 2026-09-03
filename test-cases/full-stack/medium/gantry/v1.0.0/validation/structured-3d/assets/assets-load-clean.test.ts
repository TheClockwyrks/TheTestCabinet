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
// THE READING IS EVERY REQUEST'S OWN STATUS. There is no page here — this project
// stands the engine up in Node — so the requests are read off the one transport
// `validation/host.ts` installs, which answers a relative URL out of the built
// tree exactly as a static server would and hands anything else to the network.
// The engine's own loader and anything the build fetched for itself both go
// through it, so it carries the whole of what the built site asks for.
//
// AND THE ENGINE'S OWN VERDICT IS READ BESIDE IT. `specs/assets.md` has an engine
// build load every produced file "through the engine's own asset loader", and the
// engine announces each load it could not complete — a status it refused, a
// decode that failed — so a file that arrived as bytes and was not usable is
// caught as well as one that never arrived.
//
// A WHOLE SITE IS PLAYED, because a build is free to fetch late and a missing
// file would then only show up on the screen that wanted it.
//
// WHAT THIS POINT DOES NOT READ. Anything the build logs. A build is free to log
// whatever it likes, so a console reading would grade something other than
// whether the assets loaded. This point reads request outcomes and the engine's
// own load failures, and nothing else.

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

  const fetched = h.requests();
  assertGreaterThan(
    fetched.length,
    0,
    "the files the played build fetched, which this point reads off the one " +
      "transport the harness installs",
  );

  const failed = fetched
    .filter((one) => one.status >= 400)
    .map((one) => `${one.url} \u2192 ${String(one.status)}`);
  assertEqual(
    failed.join(", "),
    "",
    "every request the played build made to resolve, so no produced file is " +
      "missing from the built output or asked for at a path that does not " +
      "resolve (specs/assets.md, specs/overview.md) — these did not",
  );

  const refused = h.assetFailures.map((one) => `${one.path} (${one.reason})`);
  assertEqual(
    refused.join(", "),
    "",
    "every load the engine's own asset loader made to complete while the site " +
      "was played through, since specs/assets.md has the build load each " +
      "produced file through it — these did not",
  );

  console.log(
    `gantry: the play-through with every asset loaded —\n  ` +
      fetched.map((one) => `${String(one.status)} ${one.url}`).join("\n  "),
  );

  await h.capture("run", "The play-through with every asset loaded");
});
