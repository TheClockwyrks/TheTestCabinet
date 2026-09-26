// Spectra — presentation/cyan-vs-field: a cyan drone is drawn on the field.
//
// `specs/overview.md`'s legibility table, the first row: a cyan thing and a
// magenta thing are told apart at a glance, "and each is told apart from the
// field behind it". What a pixel read decides of that rule is the half a script
// can decide at all — that the drone was DRAWN. A build that painted nothing
// where a cyan drone stands has no cyan on the field for a player to tell
// apart from anything.
//
// THIS POINT IS THE CYAN HALF ALONE. `presentation/magenta-vs-field` is the
// magenta half, in its own file, so a build that drew no drone on one band is
// named for the band it lost rather than for both.
//
// NOTHING ABOUT HOW IT LOOKS IS ASSERTED. `specs/overview.md` fixes no palette,
// and how far the build's cyan reads from the field it chose is the reviewer's
// presentation rating. What is graded here is presence and nothing else.
//
// THE READING IS THE PIXELS, HELD PLACE FOR PLACE. The drone's `SHARD_SIZE`
// (`28`) square is read with the drone on it and again with the drone gone, and a
// place that moved between the two readings is a place the drone painted — see
// `presentation/reading`. Held against its own control rather than against a
// fixed colour, so a build's starfield, banner or watermark inside the square is
// carried by both readings and cancels.
//
// THE DRONE IS A SHARD, `specs/drones.md`'s "bulk of every formation", posed as a
// prop with every faculty off so it holds its place and nothing it could do
// disturbs the frame that is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { droneOf, footprintOf, paintedCount, readRegion } from "./reading";

/** Where the Shard stands: inside the play field, clear of the ship's lane. */
const SHARD_AT = { x: 440, y: 420 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a cyan drone on the empty field behind it", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", SHARD_AT.x, SHARD_AT.y, { band: "cyan" });
  await h.advance(1);

  // A cyan drone against the empty field.
  captureStill(h, "cyan");

  const drone = droneOf(h.snapshot(), id);
  assertEqual(
    drone.effectiveBand,
    "cyan",
    "precondition: the Shard reads as cyan on the field (specs/bands.md; no " +
      "inversion is running)",
  );
  const square = footprintOf(drone.x, drone.y, SHARD_SIZE);
  const drawn = readRegion(h, square);

  // The same square of the same field with no drone on it: the control every
  // place the drone painted is held against.
  h.debug.clearDrones();
  await h.advance(1);
  const bare = readRegion(h, square);

  const painted = paintedCount(bare, drawn);
  assertGreaterThan(
    painted,
    0,
    `the cyan Shard to paint at least one place of its SHARD_SIZE ` +
      `(${SHARD_SIZE}) footprint that the same square of the same field does ` +
      `not carry without it (specs/overview.md: each band is on the field to ` +
      `be told apart from it)`,
  );
});
