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
// THE READING IS EVERY REQUEST'S OWN STATUS, out of the page's Resource Timing
// buffer, which carries the requests the bundle made while it was booting as
// well as the ones a driven screen makes later. A second reading is taken from
// the browser itself for the driven part of the run, so a request that failed
// outright — a connection refused, an aborted fetch — is seen even though a
// failed request's timing entry may report nothing.
//
// THE BROWSER'S OWN `/favicon.ico` PROBE IS NOT THE BUILD'S. Chromium asks every
// document it loads for a favicon whether or not the page references one, and a
// site that ships no icon is not a site with a broken asset — `specs/assets.md`
// lists what is produced and an icon is not among it. So a `/favicon.ico`
// request the page never initiated is left out; anything the page itself asked
// for is judged.
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

/** The path the browser probes on its own, whatever the document references. */
const BROWSER_PROBE = "/favicon.ico";

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

it("plays a whole site through with no asset request failing", async () => {
  // What the browser reports for the driven part, beside what the page's own
  // buffer reports for all of it.
  const refused: string[] = [];
  h.page.on("requestfailed", (request) => {
    refused.push(`${request.url()} (${request.failure()?.errorText ?? "?"})`);
  });

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

  const asked = fetched.filter((one) => {
    try {
      return !(
        new URL(one.name).pathname === BROWSER_PROBE && one.initiator === "other"
      );
    } catch {
      return true;
    }
  });

  const failed = asked
    .filter((one) => one.status >= 400)
    .map((one) => `${one.name} → ${one.status}`);
  assertEqual(
    failed.join(", "),
    "",
    "every request the played site made to resolve, so no produced file is " +
      "missing from the built output or asked for at a path that does not " +
      "resolve (specs/assets.md, specs/overview.md) — these did not",
  );

  assertEqual(
    refused.join(", "),
    "",
    "no request the browser made for the page to be refused outright while " +
      "the site was played through",
  );

  console.log(
    `gantry: the play-through with every asset loaded —\n  ` +
      asked.map((one) => `${one.status} ${one.initiator} ${one.name}`).join("\n  "),
  );

  await h.capture("run", "The play-through with every asset loaded");
});
