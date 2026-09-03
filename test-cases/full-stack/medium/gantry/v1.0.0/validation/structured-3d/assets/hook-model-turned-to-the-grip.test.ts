// assets/hook-model-turned-to-the-grip — the hook block is drawn turned by the
// grip axis's value.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … the hook at the bob turned to the grip's yaw …". specs/program.md gives
// the grip as one of the four axes the tape drives, and specs/rigging.md has it
// turn nothing but the hook — "turning the grip applies no force to anything" —
// so the grip's value shows on screen in exactly one place: the yaw the hook
// block is drawn at.
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
// THIRTY-SEVEN DEGREES, NOT NINETY, so that a build whose block happens to have a
// four-fold symmetry is still read as having turned: the reading is the
// transform's angle rather than the silhouette's, and thirty-seven is a step of
// no symmetry a sculpt is likely to carry.
//
// THE TAPE'S ONE MOVE IS ON THE SLEW AXIS RATHER THAN THE GRIP. The run has to
// still be running for the grip to be posed at all, so the tape needs a step that
// never completes; and it cannot be a grip step, because specs/instrumentation.md's
// `setAxis` sets an axis's value "leaving it stopped with no live command", so
// posing the grip would finish a grip step and end the run. The slew is unbounded
// (specs/program.md), so a slew target of a hundred thousand degrees is in range
// and never arrives — and at a rate of a thousandth of a degree a second, which
// specs/program.md accepts as "greater than `0` and at most the axis's max", the
// arm turns by under a fifty-thousandth of a degree between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  drawnFromModel,
  drawnYaw,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  yawBetween,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The subject's produced model, under the asset root specs/assets.md fixes. */
const MODEL = "models/hook.glb";

const SITE = 0;

/** A step that never completes and turns the arm by nothing worth reading. */
const CRAWL: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 100_000, rate: 0.001 }],
};

/** The carriage, and the bob hanging straight under it at the cable's length. */
const TROLLEY_AT = 4;
const BOB: Vec3 = { x: 4, y: 4 - HOIST_START, z: 0 };

/** The two grip values read. */
const REST = 0;
const TURNED = 37;

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

/** The yaw the one hook placement is drawn at, in degrees. */
async function hookYaw(harness: Harness): Promise<number> {
  const placed = await drawnFromModel(harness, MODEL);
  assertEqual(
    placed.length,
    1,
    "the placements of the committed hook model on a running crane: the game " +
      'draws "the hook at the bob turned to the grip\'s yaw" ' +
      "(specs/assets.md)",
  );
  return drawnYaw(placed[0]!);
}

it("draws the hook turned by the grip axis's value", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [CRAWL]);
  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);

  await h.debug.setAxis("grip", REST);
  await h.advance(1);
  const rest = await hookYaw(h);

  await h.debug.setAxis("grip", TURNED);
  await h.advance(1);
  const turned = await hookYaw(h);

  await h.capture("grip", "The hook at grip 0 and grip 37");

  assertNear(
    yawBetween(rest, turned),
    TURNED - REST,
    TOLERANCE,
    `the turn the hook is drawn through between grip ${REST} and grip ` +
      `${TURNED}, against the turn the axis made: the hook is drawn "turned ` +
      "to the grip's yaw\" (specs/assets.md)",
  );
});
