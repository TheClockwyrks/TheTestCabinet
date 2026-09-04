// presentation/stage-letterboxed — the whole logical stage is on screen at every
// window size, its aspect ratio kept and its letterboxing even.
//
// specs/overview.md, "Units, ticks, and the stage": "The canvas presents a fixed
// logical stage of `STAGE_W x STAGE_H` (`1280 x 720`, 16:9). Fitting it to the
// browser window is the runtime's: the uniform scale that preserves the aspect
// ratio, the letterboxed centering, and the device pixel ratio. The complete
// stage is on screen at every window size, on load and at any pixel density".
//
// THE FIT IS READ THROUGH THE POINTER, not off the canvas element. The bars the
// letterboxing leaves "are painted in the stage background the build chooses", so
// a build is free to give the canvas the whole window and paint the bars inside
// it — the reference does exactly that — and the element's own box then says
// nothing about where the stage landed. What the fit IS observable through is the
// pointer: the same paragraph ends "The pointer position the game reads is in
// those same units", so a real pointer event delivered at a window position the
// specification's fit maps a stage point to must read back as that stage point.
// A build that scaled the stage differently, cropped it, stretched it or seated
// it off centre answers a different point, and the gap is the error in its fit.
//
// The window positions come from `fitViewport`, which computes the fit the
// paragraph above states — one uniform scale, the whole stage inside, centred,
// the leftover split evenly — from the window's shape alone. It is arithmetic
// over the specification's own figures rather than a reading of the build, so
// nothing here grades the build against itself.
//
// THREE WINDOWS, WHICH ARE THE THREE CASES THE REQUIREMENT HAS. One wider than
// 16:9, where the bars stand left and right; one taller, where they stand above
// and below; and one at the stage's own shape with the device pixel ratio raised,
// where there are no bars and what is under test is that a denser surface changes
// nothing about where a stage point lands.
//
// THE PROBES AVOID THE STAGE'S EXACT CORNERS. A window position on the window's
// own outside edge is not inside the page, so the event never lands; every probe
// sits a few units in from the stage's border, which still reaches the corners of
// the fitted rectangle within a few pixels.

import { afterEach, it } from "vitest";
import { assertClose, assertTrue } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { createHarness, fitViewport, type Harness } from "../harness";

/** The three surfaces: wider than 16:9, taller than 16:9, and denser. */
const SURFACES = [
  { cssWidth: 1600, cssHeight: 700, dpr: 1, shape: "wider than 16:9" },
  { cssWidth: 900, cssHeight: 1200, dpr: 1, shape: "taller than 16:9" },
  {
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
    dpr: 2,
    shape: "at device pixel ratio 2",
  },
] as const;

/**
 * The stage points each surface is probed at: the middle, and one a short way
 * inside each corner, which is what says the WHOLE stage is on screen.
 */
const PROBES = [
  { x: STAGE_W / 2, y: STAGE_H / 2 },
  { x: 4, y: 4 },
  { x: STAGE_W - 4, y: 4 },
  { x: 4, y: STAGE_H - 4 },
  { x: STAGE_W - 4, y: STAGE_H - 4 },
] as const;

/**
 * How far a probe may read from the point it was aimed at, in logical units.
 *
 * A window position is delivered in whole CSS pixels, and one CSS pixel is at
 * most `STAGE_W / 900` — about `1.5` — logical units on the narrowest surface
 * here, so a correct fit still answers up to that much away. Two units is that
 * rounding with room to spare, and it is far short of the error any wrong fit
 * makes: a stretched fit misses a corner by tens of units, and an off-centre one
 * by the whole bar it forgot to halve.
 */
const TOLERANCE = 2;

const open: Harness[] = [];

afterEach(async () => {
  while (open.length > 0) await open.pop()!.dispose();
});

it("fits the whole 1280 x 720 stage into every window shape", async () => {
  for (const surface of SURFACES) {
    const h = await createHarness({
      cssWidth: surface.cssWidth,
      cssHeight: surface.cssHeight,
      dpr: surface.dpr,
    });
    open.push(h);

    const view = fitViewport(surface.cssWidth, surface.cssHeight, surface.dpr);
    assertTrue(
      view.cssScale > 0,
      `a fit for a ${surface.cssWidth} x ${surface.cssHeight} window ` +
        "(specs/overview.md)",
    );

    for (const probe of PROBES) {
      // A REAL pointer event at the window position the specification's fit
      // maps this stage point to. `specs/instrumentation.md` says a caller
      // reaching a control "dispatches a real pointer or key event", and the
      // surface's own `pointerMove` takes stage units and so could not see the
      // fit at all.
      //
      // UNDER THIS ENGINE the harness's own `pointerMove` IS that raw event: it
      // dispatches a `PointerEvent`-shaped event carrying the CLIENT position it
      // is given, and the engine maps that position — times the device pixel
      // ratio, through the inverse viewport map — into the stage's logical
      // units. At the default surface the two coincide, which is why every other
      // suite writes stage units; here the surface is deliberately not the
      // default, so what goes in is the window position and what comes back out
      // of the snapshot is the stage point the fit put under it.
      await h.pointerMove(
        view.cssOffsetX + probe.x * view.cssScale,
        view.cssOffsetY + probe.y * view.cssScale,
      );
      // "Every update reads the pointer's current position into it"
      // (specs/instrumentation.md), so one frame runs before the reading.
      await h.advance(1);
      const { pointer } = await h.snapshot();
      const where =
        `stage (${probe.x}, ${probe.y}) over a ${surface.cssWidth} x ` +
        `${surface.cssHeight} window ${surface.shape}`;
      assertClose(
        pointer.x,
        probe.x,
        TOLERANCE,
        `${where}: the stage's whole width fitted at one uniform scale and ` +
          "centred, so the pointer over that point reads it back " +
          "(specs/overview.md)",
      );
      assertClose(
        pointer.y,
        probe.y,
        TOLERANCE,
        `${where}: the stage's whole height fitted at the same scale and ` +
          "centred, so the pointer over that point reads it back " +
          "(specs/overview.md)",
      );
    }

    if (surface === SURFACES[0]) {
      await h.capture(
        "fit",
        "The stage fitted and centred in an off-aspect window",
      );
    }
  }
});
