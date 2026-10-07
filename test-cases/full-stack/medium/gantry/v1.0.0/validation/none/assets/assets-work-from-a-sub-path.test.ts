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
// from a sub-path as well as from a root". And § Hard requirements closes the
// set: "The build fetches nothing at runtime from outside its own `dist/`."
//
// SO THE SITE IS SERVED FROM A SUB-PATH AND NOWHERE ELSE. The page is given a
// server that answers `/<a>/<b>/<c>/…` out of the build's own `dist/` and answers
// everything else with a `404`, so a root-absolute reference has nothing to hit
// and a reference to a file `dist/` does not carry has nothing to hit either.
// Three path segments deep rather than one, because a build that resolved an
// asset one directory up would still find it under a shallow prefix.
//
// A SITE THAT LOADS IS NOT YET A SITE THAT RUNS, so the game is then played the
// way any other point plays it: the surface is waited for, a site is opened, a
// crane is stood up, a tape is appended, and a run is started and ticked. The
// models and sounds are fetched while the page comes up, so a build whose
// produced assets were addressed from the root never installs its surface here,
// and one whose bundle was is never parsed at all.
//
// WHAT THE VERDICT RESTS ON is the list of requests the page made that the
// sub-path server could not answer: every one of them is either a root-absolute
// address or a file the build did not put in `dist/`, and both are what this
// point is about.

import { readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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

/** The sub-path the site is served from: three segments, none of them the root. */
const PREFIX = "/deployed/gantry/build/";

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

/** What a static host answers each kind of file with. */
const TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  glb: "model/gltf-binary",
  wav: "audio/wav",
  mid: "audio/midi",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs from a sub-path, reaching every asset it needs", async () => {
  const unanswered: string[] = [];

  await h.page.route("**/*", async (route) => {
    const asked = new URL(route.request().url());
    if (!asked.pathname.startsWith(PREFIX)) {
      unanswered.push(`${asked.pathname} (outside the sub-path)`);
      await route.fulfill({ status: 404, body: "not served" });
      return;
    }
    const within = decodeURIComponent(asked.pathname.slice(PREFIX.length));
    const file = resolve(join(DIST, within === "" ? "index.html" : within));
    if (file !== DIST && !file.startsWith(DIST + sep)) {
      unanswered.push(`${asked.pathname} (reaching outside dist/)`);
      await route.fulfill({ status: 404, body: "not served" });
      return;
    }
    let body: Buffer;
    try {
      const at = statSync(file).isDirectory() ? join(file, "index.html") : file;
      body = readFileSync(at);
    } catch {
      unanswered.push(`${asked.pathname} (no such file under dist/)`);
      await route.fulfill({ status: 404, body: "not served" });
      return;
    }
    const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
    await route.fulfill({
      status: 200,
      body,
      headers: {
        "content-type": TYPES[extension] ?? "application/octet-stream",
      },
    });
  });

  const origin = new URL(h.page.url()).origin;
  await h.page.goto(`${origin}${PREFIX}`, { waitUntil: "load" });

  // The build's own surface, on a page served three directories down.
  const arrived = await h.page
    .waitForFunction(
      () =>
        typeof (window as unknown as Record<string, unknown>).__gantry ===
        "object",
      undefined,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!arrived) {
    fail(
      `the built site to come up served from ${PREFIX}, which ` +
        'specs/overview.md requires of `dist/` — "that directory runs ' +
        "correctly when served as-is at the root of any static file server, " +
        'and equally when served from a sub-path"',
      unanswered.length === 0
        ? "window.__gantry was still absent 20s after the page loaded, and " +
            "every request it made was answered"
        : `it never installed window.__gantry, having asked for ` +
            `${unanswered.join(", ")}`,
    );
  }

  // Off the wall clock, as every harness puts a page it drives.
  await h.page.evaluate(() => {
    (
      window as unknown as { __gantry: { setAutoStep(on: boolean): void } }
    ).__gantry.setAutoStep(false);
  });

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
    `the run's phase after ${PLAY_TICKS} ticks of the site served from ` +
      `${PREFIX}, which runs the simulation exactly as it does at a root`,
  );
  assertEqual(
    ran.run.tick,
    PLAY_TICKS,
    `the ticks the run has taken on the site served from ${PREFIX}`,
  );

  assertTrue(
    unanswered.length === 0,
    `every request the built site makes to be answered from within ${PREFIX}, ` +
      "since specs/overview.md has every asset reference in the build be " +
      'relative rather than root-absolute and the build "fetches nothing at ' +
      `runtime from outside its own dist/\" — it asked for ` +
      `${unanswered.join(", ")}`,
  );
});
