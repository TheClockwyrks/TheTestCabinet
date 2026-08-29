// brightness/widens-vision — brightness widens the light pocket.
//
// specs/sensing.md: the light's "radius is `V = VISION_MIN + VISION_GAIN * G`,
// with `VISION_MIN` (`96`) and `VISION_GAIN` (`64`) in logical units, so `V` is
// `96` (3 tiles) at `G = 0` and `160` (5 tiles) at `G = 1`."
//
// The formula is read at five brightnesses across the range, so a build with the
// right endpoints and a wrong curve between them fails, and so does one that
// reports a radius it does not use. That second half is the point of the PROBE
// TILE: a tile posed four tiles down a straight corridor stands `128` logical
// units off, between the `96` the light reaches at `G = 0` and the `160` it
// reaches at `G = 1`, so the same tile is unlit dim and lit bright. `visibility`
// is read there at both ends, which is what ties the number the build reports to
// the light it actually casts.
//
// THE BRIGHTNESSES ARE POSED. `setBrightness(g)` sets `G` and "everything derived
// from brightness recomputes from it", and it arms the `BRIGHT_HOLD` hold in full
// so the posed value is steady for a whole second (specs/instrumentation.md) —
// which is what lets five values be read one after another without the decay
// curve running underneath the measurement. What eating does to `G` is
// `brightness/from-eating`'s, and how `G` decays is `brightness/holds-decays`'.
//
// EACH READING IS TAKEN A BEAT AFTER THE POSE. `V` is DERIVED from `G`, and a
// build that recomputes it at the top of the next step keeps the formula exactly
// as much as one that recomputes it inside the operation. Two ticks is past
// either, and the hold has `118` more to run.
//
// THE ASCENDING ORDER IS DELIBERATE. `G = 0` is asked first, while the probe tile
// has never been revealed by anything, so "not lit" there cannot be a tile that an
// earlier, brighter reading had already lit and left remembered.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, VISION_GAIN, VISION_MIN } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
  assertNotEqual,
} from "../assert";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  startPlaying,
  visibilityOf,
  type Harness,
} from "../harness";
import {
  denAll,
  fromForager,
  graded,
  parkForager,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import type { Tile } from "../maze";

/** Tiles of posed corridor: the forager's own, the probe's, and room to spare. */
const RUN_TILES = 8;

/**
 * How far down the corridor the probe tile is posed, in tiles.
 *
 * Four, so it stands `128` logical units off: past `VISION_MIN` (`96`) and inside
 * `VISION_MIN + VISION_GAIN` (`160`), with a whole tile of margin either side.
 */
const PROBE_TILES = 4;

/** The brightnesses `V` is read at, ascending. See the header for why ascending. */
const SAMPLES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/** The review item's tolerance on the radius, in logical units. */
const RADIUS_TOLERANCE = 1;

/** Ticks between posing a brightness and reading what was derived from it. */
const READ_BEAT = 2;

/** Ticks each posed brightness is held for the clip, after its reading is taken. */
const FILM_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Brightness widens the light pocket", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const run = await poseStraightRun(h, RUN_TILES);
    const probe: Tile = { tx: run.tx + PROBE_TILES, ty: run.ty };
    const quiet = await denAll(h);
    await parkForager(h, { tx: run.tx, ty: run.ty });
    // No plankton, so nothing the forager is standing on can raise `G` under a
    // reading that is about a posed one.
    h.debug.clearPlankton();
    const watch = await sceneGuard(h, quiet);

    const sweep = await captureReplay(h, "widen", async () => {
      const readings: { g: number; radius: number; probe: string }[] = [];
      for (const g of SAMPLES) {
        h.debug.setBrightness(g);
        await h.advance(READ_BEAT);
        const snapshot = h.snapshot();
        readings.push({
          g,
          radius: snapshot.visionRadius,
          probe: visibilityOf(snapshot, probe),
        });
        // Held on screen so the clip shows the pocket at this width; the reading
        // above is already taken, so nothing here can reach an assertion.
        await h.advance(FILM_TICKS);
      }
      return { readings, end: h.snapshot() };
    });

    requireSceneHeld(sweep.end, watch);

    // The fixture's own geometry, from the specification's figures rather than
    // from the build's readings.
    const center = centerOf(sweep.end, probe);
    const gap = fromForager(sweep.end, center.x, center.y);
    assertGreaterThan(
      gap,
      VISION_MIN,
      `the ${PROBE_TILES * TILE} logical units to the probe tile, which must be ` +
        `past V at G = 0 (VISION_MIN = ${VISION_MIN})`,
    );
    assertLessThan(
      gap,
      VISION_MIN + VISION_GAIN,
      "that same distance, which must be inside V at G = 1 " +
        `(VISION_MIN + VISION_GAIN = ${VISION_MIN + VISION_GAIN})`,
    );

    for (const reading of sweep.readings) {
      const expected = VISION_MIN + VISION_GAIN * reading.g;
      assertLessThanOrEqual(
        Math.abs(reading.radius - expected),
        RADIUS_TOLERANCE,
        `visionRadius at G = ${reading.g}, against VISION_MIN + VISION_GAIN * G ` +
          `(${expected})`,
      );
    }

    // And the light the build actually casts, at the two ends of the range.
    const dim = sweep.readings[0];
    const bright = sweep.readings[sweep.readings.length - 1];
    assertNotEqual(
      dim.probe,
      "l",
      `the visibility of the tile ${PROBE_TILES} tiles down the corridor at ` +
        `G = ${dim.g}, which is past the light's reach there`,
    );
    assertEqual(
      bright.probe,
      "l",
      `the visibility of that same tile at G = ${bright.g}, which is inside the ` +
        "light's reach there",
    );
  });
});
