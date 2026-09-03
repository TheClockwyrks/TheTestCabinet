// assets/no-runtime-fetch-outside-dist — the played site fetches nothing from
// outside its own served output.
//
// specs/assets.md, intro: "Production is a one-time step. The tools are
// development tools of this machine; the committed files are the assets, and
// the build bundles them, so `npm ci` and `npm run build` invoke no tool and the
// built site fetches nothing from outside its own `dist/`."
//
// WHAT "OUTSIDE ITS OWN DIST" MEANS HERE. The harness serves the build's `dist/`
// as the whole of one origin, so a request that reaches outside the built output
// is exactly a request that reaches outside that origin — a CDN, a font host, a
// model or sample fetched from the web at play time. Every such request would
// leave the built site broken wherever it is served without a network, which is
// what the requirement exists to prevent.
//
// EVERY REQUEST, NOT EVERY REQUEST THE HARNESS SAW. The reading is the page's own
// Resource Timing buffer, which carries every resource the document fetched from
// the moment it started loading — including the ones the bundle made while it
// was booting, before a validator could attach a listener. Cross-origin
// resources appear in that buffer under their full URL like any other, so a
// fetch that left the origin is visible even though its timings are not.
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

/** One resource the page fetched. */
interface Fetched {
  name: string;
  status: number;
  initiator: string;
}

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

  const fetched = (await h.page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      status: (entry as PerformanceResourceTiming).responseStatus ?? 0,
      initiator: (entry as PerformanceResourceTiming).initiatorType,
    })),
  )) as Fetched[];

  assertGreaterThan(
    fetched.length,
    0,
    "the resources the played site fetched, which this point reads out of the " +
      "page's own Resource Timing buffer",
  );

  const origin = new URL(h.page.url()).origin;
  const outside = fetched
    .filter((one) => {
      // `data:` and `blob:` never leave the page, so neither is a fetch out of
      // the built output; everything else is judged by its origin.
      if (/^(data|blob):/i.test(one.name)) return false;
      try {
        return new URL(one.name).origin !== origin;
      } catch {
        return true;
      }
    })
    .map((one) => `${one.name} (${one.initiator})`);

  assertEqual(
    outside.join(", "),
    "",
    `every request the played site made to resolve inside the \`dist/\` served ` +
      `at ${origin}, since "the built site fetches nothing from outside its ` +
      'own `dist/`" (specs/assets.md) — these left that origin',
  );

  console.log(
    `gantry: every asset the played-through site requested —\n  ` +
      fetched
        .map((one) => `${one.status} ${one.initiator} ${one.name}`)
        .join("\n  "),
  );

  await h.capture("requests", "Every asset the played-through site requested");
});
