// assets/ring-model-turns-with-the-arm — the ring model is drawn turned by the
// slew angle.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: the ring centered on the slew axis between its flanges and turning with the
// arm …". specs/structure.md says what the arm's turn is: the ring "turns the top
// flange about the slew axis by the slew angle and takes the whole arm with it,
// so an arm node stands at its lattice position turned by that angle and nothing
// else moves it, while the bottom flange stands still". So the drum's own drawing
// follows the slew value.
//
// WHAT A TURN IS, UNDER AN ENGINE. specs/assets.md has an engine build load each
// model "through the engine's own asset loader under its asset root", so a model
// on screen is a `ModelComponent` the world holds and the angle it is drawn at is
// the rotation of the transform the pipeline places it at. `drawnYaw` reads that
// as `specs/world.md` measures a yaw — where the rotation sends `+x`, positive
// from `+x` toward `+z`.
//
// WHAT IS COMPARED IS TWO READINGS OF THE SAME PLACEMENT, never a reading against
// a figure: the model's own zero orientation is the build's, since the sculpt
// faces whichever way the exporter left it, and specs/assets.md fixes only that
// the drawing FOLLOWS the axis.
//
// THE ENGINELESS PROJECT DECIDES THIS BY PHOTOGRAPHING THE SUBJECT AT TWO ANGLES
// and requiring the pixels to differ. There is no rasterizer here —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so the reading is the angle itself, which is a stronger reading
// of the same sentence: it says the drawing turned BY the axis rather than merely
// that it changed.
//
// THIRTY-SEVEN DEGREES, NOT NINETY, so that a build whose drum happens to have a
// four-fold symmetry is still read as having turned.
//
// THE WORLD IS ONE CRANE, RUNNING, AND NOTHING ELSE — no loads, no obstacles, and
// a tape of one grip move, the only axis whose motion "applies no force to
// anything" (specs/rigging.md), so posing the slew is the only thing that moves
// between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  createHarness,
  drawnFromModel,
  drawnYaw,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  yawBetween,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The subject's produced model, under the asset root specs/assets.md fixes. */
const MODEL = "models/ring.glb";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** The angle the arm starts at, and the one it is swung to. */
const REST = 0;
const SWUNG = 37;

/**
 * How far the drawn turn may stand from the axis's own.
 *
 * The angle is read off a transform rather than off a picture, so nothing here is
 * approximate but the build's own arithmetic; half a degree is room for a build
 * that carries its angles in radians and back.
 */
const TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The yaw the one ring placement is drawn at, in degrees. */
async function ringYaw(harness: Harness): Promise<number> {
  const placed = await drawnFromModel(harness, MODEL);
  assertEqual(
    placed.length,
    1,
    "the placements of the committed ring model on a crane with one ring: " +
      '"a crane has exactly one" (specs/structure.md)',
  );
  return drawnYaw(placed[0]!);
}

it("draws the ring turned by the slew angle", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);

  await h.debug.setAxis("slew", REST);
  await h.advance(1);
  const rest = await ringYaw(h);

  await h.debug.setAxis("slew", SWUNG);
  await h.advance(1);
  const swung = await ringYaw(h);

  await h.capture("slew", "The ring at slew 0 and slew 37");

  assertNear(
    yawBetween(rest, swung),
    SWUNG - REST,
    TOLERANCE,
    `the turn the ring is drawn through between slew ${REST} and slew ` +
      `${SWUNG}, against the turn the axis made: the ring is drawn "turning ` +
      'with the arm" (specs/assets.md)',
  );
});
