// assets/assets-decoded-before-first-frame — nothing is still loading when the
// first frame draws.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Where the files land, and how
// they are loaded"): "Every image is decoded and every sound is bound to its cue
// before the first frame draws."
//
// THE DRIVE. That sentence is about an ORDER, and no reading taken after the page
// has settled can recover it, so the order is recorded as it happens: this suite
// serves the build itself and injects `first-frame-init.js` before a line of the
// build's own script runs. That probe wraps the drawing methods of a 2D context,
// so the first call to any of them is the moment the first frame began to draw;
// it wraps the image `src` setter and `createImageBitmap`, so every image is
// counted from the moment a URL lands on it until its load settles; and it reads
// the cues bound by then, through the Web Audio decodes this case's audio probe
// already logs and through any media element pointed at a produced file. The page
// is then left to settle and the record is read.
//
// WHAT IS ASSERTED. That a frame was drawn at all; that every image the build
// asked for had settled when it was, with none in flight and none arriving after;
// and that all fifteen cues were bound to a file by then.
//
// NO COUNT OF IMAGES IS ASSERTED, and deliberately: a build is free to serve two
// identical produced files as one, to inline a small one into its script, or to
// pack several into a canvas of its own, so the number of image loads is not a
// figure the specification fixes. That every produced file exists at its path is
// every `*-produced` point in this category, and what the frames draw is the
// presentation category's.
//
// THE TOLERANCE. None on the order: an image had settled before the first drawing
// call or it had not. The settling wait is the harness's own allowance, so a
// build still fetching when the record is read is read as still fetching.

import { it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
import { CUE_NAMES, HANDLE } from "../constants";
import { PROJECT_ROOT, writeImageBytes } from "./media-out";
import { openSite } from "./site";
import { join } from "node:path";

/** What `first-frame-init.js` records, read once the page has settled. */
interface FirstFrame {
  drawn: boolean;
  imagesStarted: number;
  imagesSettled: number;
  imagesSettledAfterDraw: number;
  imagesInFlightAtDraw: number | null;
  boundAtDraw: string[] | null;
  boundNow: string[];
}

/** How long the surface is waited for before the load is called a failure. */
const SURFACE_TIMEOUT_MS = 15_000;

/** How long the page is left to finish whatever it started. */
const SETTLE_MS = 3_000;

it("draws its first frame with every image decoded and every cue bound", async () => {
  const site = await openSite({
    initScripts: [
      join(PROJECT_ROOT, "audio-init.js"),
      join(PROJECT_ROOT, "assets", "first-frame-init.js"),
    ],
  });
  try {
    await site.page
      .waitForFunction(
        (handle) =>
          typeof (window as unknown as Record<string, unknown>)[handle] ===
          "object",
        HANDLE,
        { timeout: SURFACE_TIMEOUT_MS },
      )
      .catch(() => undefined);
    await site.page.waitForTimeout(SETTLE_MS);

    const record = (await site.page.evaluate(
      () =>
        (
          window as unknown as {
            __wickFirstFrame?: { read(): FirstFrame };
          }
        ).__wickFirstFrame?.read() ?? null,
    )) as FirstFrame | null;
    writeImageBytes("ready", await site.page.screenshot({ type: "png" }));

    if (record === null) {
      fail("the first-frame probe installed on the page", "it was not there");
    }
    if (!record.drawn) {
      fail(
        `a first frame drawn within ${SETTLE_MS / 1000}s of the page loading`,
        "nothing was ever drawn on a 2D context",
      );
    }
    assertGreaterThanOrEqual(
      record.imagesStarted,
      1,
      "produced images the build loaded",
    );
    assertEqual(
      record.imagesSettled,
      record.imagesStarted,
      "images that finished loading, against the images the build started",
    );
    assertEqual(
      record.imagesInFlightAtDraw,
      0,
      "images still loading when the first frame began to draw",
    );
    assertEqual(
      record.imagesSettledAfterDraw,
      0,
      "images that finished loading only after the first frame began to draw",
    );

    const bound = new Set(record.boundAtDraw ?? []);
    const unbound = CUE_NAMES.filter((cue) => !bound.has(cue));
    if (unbound.length > 0) {
      fail(
        "all fifteen cues bound to their files before the first frame drew",
        `these were not bound yet: ${unbound.join(", ")}${
          record.boundNow.length > 0
            ? ` (bound by the time the page settled: ${record.boundNow.join(", ")})`
            : " (none were bound even once the page settled)"
        }`,
      );
    }
  } finally {
    await site.close();
  }
});
