// field/ship-lane — the ship holds one lane: its centre `y` is `SHIP_Y` at all
// times, through a second of movement in each direction.
//
// specs/field.md, "The ship's lane": "The ship travels along a fixed horizontal
// lane. Its center `y` is `SHIP_Y` (`600`) at all times". specs/ship.md gives the
// ship left and right and nothing else, so a second of held movement is the whole
// of what can move it, and through it the lane must stay exactly where it was.
//
// WHERE THE READING COMES FROM. The snapshot reports the ship's `x` and nothing
// else — specs/instrumentation.md leaves its `y` out precisely because the
// specification fixes it — so the lane is read off the CANVAS instead, from the
// destination box of the draw that puts the seeded fighter art on the stage.
// specs/assets.md requires the ship to be drawn from `assets/fighter.png`, and
// specs/overview.md fixes that "an entity's position is its center", so the centre
// of that box is the ship's centre. The candidate is picked by the ship's OWN `x`,
// which the snapshot does report, and never by its `y`, which is the thing under
// test: a build that flew the ship out of its lane is still found there.
//
// THE LANE IS READ WHILE THE SHIP IS MOVING, not only at the ends of the sweep.
// Three readings are taken across each held second, so a build whose ship bobs,
// arcs or eases along the lane is caught as squarely as one that parks it at the
// wrong height. The world is `startPosed`'s: an empty field with the wave's three
// gates shut, so nothing but the held key touches the ship.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual, fail } from "../assert";
import { BINDINGS, SHIP_H, SHIP_W, SHIP_Y } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/**
 * How far the drawn ship's centre may sit from `SHIP_Y`, in logical units.
 *
 * specs/field.md fixes the lane exactly, so the only slack this needs is for a
 * build that pads its destination box by a unit or two around the hull. `SHIP_H`
 * is 28, so 6 is under a quarter of the hull: a lane error this lets through is
 * one no player could see, and a ship a whole hull clear of its lane is over four
 * times the allowance.
 */
const LANE_TOLERANCE = 6;

/**
 * How closely a draw's source must agree with the seeded `fighter.png`
 * silhouette, `0` to `1`, for it to be the ship rather than some other art.
 *
 * A bar for IDENTIFYING the draw, not for grading the art — that is
 * `presentation/fighter-from-sprite`, which asks for 99%. 90% leaves room for a
 * build that bakes its per-band copies at another resolution while still refusing
 * anything that is not the seeded silhouette.
 */
const SHIP_ART_MIN = 0.9;

/** A second of held movement, in frames of the harness's clock. */
const HELD_FRAMES = framesFor(1);

/** How many readings of the lane are taken across each held second. */
const READINGS = 3;

/**
 * How far the ship must travel under a second of a held direction for the sweep
 * to be a second OF MOVEMENT at all.
 *
 * Not a reading of the ship's speed — `ship/moves-left` and `ship/moves-right`
 * grade that — but the precondition this check's own scenario needs, since a ship
 * that never moved would hold any lane at all. A tenth of the ground `SHIP_SPEED`
 * covers in a second: far below any conformant build, far above standing still.
 */
const MOVED_MIN = 36;

/**
 * The centre `y` of the draw that put the seeded fighter art on the stage at the
 * ship's own `x`.
 *
 * The candidate is chosen by horizontal position and by silhouette alone: within
 * `SHIP_W` of the `x` the snapshot reports, so a lives readout drawn from the same
 * art elsewhere on the stage is never mistaken for the ship — and never by `y`.
 */
async function drawnLaneY(h: Harness): Promise<number> {
  const { ship } = await h.snapshot();
  const blits = await blitsOfFrame(h);
  const candidates = blits
    .filter(
      (blit) =>
        Math.abs(blit.x - ship.x) <= SHIP_W &&
        blit.agreement.fighter >= SHIP_ART_MIN,
    )
    .sort((a, b) => b.agreement.fighter - a.agreement.fighter);
  if (candidates.length === 0) {
    fail(
      `the ship drawn from the seeded fighter art within ${SHIP_W} units of the ` +
        `x the snapshot reports (specs/assets.md)`,
      `no such draw at ship x ${ship.x}`,
    );
  }
  return candidates[0].y;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("holds the ship's centre at SHIP_Y through a second of movement each way", async () => {
  await startPosed(harness);
  await harness.advance(1);

  const lanes: { at: string; y: number }[] = [
    { at: "before the sweep", y: await drawnLaneY(harness) },
  ];

  for (const direction of ["left", "right"] as const) {
    const before = (await harness.snapshot()).ship.x;
    await harness.hold(BINDINGS[direction][0]);
    for (let reading = 0; reading < READINGS; reading += 1) {
      // The held second, split evenly across the readings. Each reading runs one
      // frame of its own to read the draw, which is counted in the split.
      await harness.advance(Math.floor(HELD_FRAMES / READINGS) - 1);
      lanes.push({
        at: `${reading + 1} of ${READINGS} through the held ${direction}`,
        y: await drawnLaneY(harness),
      });
    }
    await harness.release(BINDINGS[direction][0]);

    // The sweep really was a second of MOVEMENT, so the lanes above were read of a
    // ship that was travelling rather than one standing still.
    const after = (await harness.snapshot()).ship.x;
    const travelled = direction === "left" ? before - after : after - before;
    assertGreaterThan(
      travelled,
      MOVED_MIN,
      `the units the ship travelled ${direction} under a held second`,
    );
  }

  await captureStill(harness, "lane");

  for (const lane of lanes) {
    assertLessThanOrEqual(
      Math.abs(lane.y - SHIP_Y),
      LANE_TOLERANCE,
      `how far the drawn ship's centre sat from SHIP_Y (${SHIP_Y}) ${lane.at}, ` +
        `on a hull ${SHIP_H} units tall (specs/field.md)`,
    );
  }
});
