// assets/no-runtime-fetch-outside-dist — the played site fetches nothing from
// outside its own served output.
//
// specs/assets.md, intro: "Production is a one-time step. The tools are
// development tools of this machine; the committed files are the assets, and
// the build bundles them, so `npm ci` and `npm run build` invoke no tool and the
// built site fetches nothing from outside its own `dist/`."
//
// WHAT "OUTSIDE ITS OWN DIST" MEANS HERE. There is no page in this project — the
// engine is stood up in Node — and `validation/host.ts` installs the one
// transport every fetch the build makes goes through. That transport answers a
// RELATIVE URL out of the built tree, exactly as the static server the site is
// served by would; a URL carrying a SCHEME is a URL that names somewhere else,
// and it goes to the network. So a request that reaches outside the built output
// is exactly a request that carries a scheme — a CDN, a font host, a model or
// sample fetched from the web at play time. Every one of them would leave the
// built site broken wherever it is served without a network, which is what the
// requirement exists to prevent.
//
// EVERY REQUEST, AND FROM BEFORE THE FIRST FRAME. The transport is installed
// before a line of the engine or the build runs, so the loads a build makes while
// it is coming up are in the record beside the ones a driven screen makes later.
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

  const fetched = h.requests();
  assertGreaterThan(
    fetched.length,
    0,
    "the files the played build fetched, which this point reads off the one " +
      "transport the harness installs",
  );

  const outside = fetched
    // `data:` and `blob:` never leave the built output, so neither is a fetch
    // out of it; everything else carrying a scheme names somewhere else.
    .filter((one) => one.offOrigin && !/^(data|blob):/i.test(one.url))
    .map((one) => one.url);

  assertEqual(
    outside.join(", "),
    "",
    "every request the played build made to name a file inside its own " +
      '`dist/`, since "the built site fetches nothing from outside its own ' +
      '`dist/`" (specs/assets.md) — these named somewhere else',
  );

  console.log(
    `gantry: every asset the played-through site requested —\n  ` +
      fetched.map((one) => `${String(one.status)} ${one.url}`).join("\n  "),
  );

  await h.capture("requests", "Every asset the played-through site requested");
});
