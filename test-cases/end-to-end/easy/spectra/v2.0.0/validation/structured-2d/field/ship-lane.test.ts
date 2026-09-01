// field/ship-lane — the ship holds one lane: its centre `y` is `SHIP_Y` at all
// times, through a second of movement in each direction.
//
// specs/field.md, "The ship's lane": "The ship travels along a fixed horizontal
// lane. Its center `y` is `SHIP_Y` (`600`) at all times". specs/ship.md gives the
// ship left and right and nothing else, so a second of held movement is the whole of
// what can move it, and through it the lane must stay exactly where it was.
//
// WHERE THE READING COMES FROM. The snapshot reports the ship's `x` and nothing else
// — specs/instrumentation.md leaves its `y` out precisely because the specification
// fixes it — so the lane is read off the FRAME instead, from the destination box of
// the `drawImage` that puts the seeded fighter art on the stage. specs/assets.md
// requires the ship to be drawn from `assets/fighter.png`, and specs/overview.md
// fixes that "an entity's position is its center", so the centre of that box is the
// ship's centre. The candidate is picked by the ship's OWN `x`, which the snapshot
// does report, and by the silhouette the blit carries — never by its `y`, which is
// the thing under test: a build that flew the ship out of its lane is still found
// there, and the row of hulls specs/ui.md puts in the bottom HUD strip is not
// mistaken for it.
//
// THE SILHOUETTE, NOT THE PIXELS, IS WHAT IDENTIFIES THE DRAW. specs/assets.md lets
// a build composite the band's tint over the seeded PNG at draw time or bake a
// per-band copy at load time, and lets it scale the art to `SHIP_W` by `SHIP_H`, so
// the source a blit carries may be the seeded bitmap or a scratch canvas of another
// size and another colour. What survives every one of those is the shape, which is
// what `silhouetteMatch` reads.
//
// THE LANE IS READ WHILE THE SHIP IS MOVING, not only at the ends of the sweep.
// Three readings are taken across each held second, so a build whose ship bobs, arcs
// or eases along the lane is caught as squarely as one that parks it at the wrong
// height. The world is `startPosed`'s: an empty field with the wave's three gates
// shut, so nothing but the held key touches the ship.
//
// WHAT THIS DOES NOT DECIDE. How fast the ship travels, or that it clamps at either
// end of its lane, which are `ship/*`; and that the ship is drawn from the seeded art
// at all, which is `presentation/fighter-from-sprite`.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_H, SHIP_W, SHIP_Y } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnImages,
  silhouetteMatch,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How far the drawn ship's centre may sit from `SHIP_Y`, in logical units.
 *
 * specs/field.md fixes the lane exactly, so the only slack this needs is for a build
 * that pads its destination box by a unit or two around the hull. `SHIP_H` is 28, so
 * 6 is under a quarter of the hull: a lane error this lets through is one no player
 * could see, and a ship a whole hull clear of its lane is over four times the
 * allowance.
 */
const LANE_TOLERANCE = 6;

/**
 * How closely a blit's source must agree with the seeded `fighter.png` silhouette,
 * `0` to `1`, for it to be the ship rather than some other art.
 *
 * A bar for IDENTIFYING the draw, not for grading the art — that is
 * `presentation/fighter-from-sprite`. 90% leaves room for a build that bakes its
 * per-band copies at another resolution, which is resampled to the seeded square
 * before the two are compared, while still refusing anything that is not the seeded
 * silhouette.
 */
const SHIP_ART_MIN = 0.9;

/** The first key specs/controls.md binds each direction to. */
const KEYS = { left: BINDINGS.left[0], right: BINDINGS.right[0] } as const;

/** A second of held movement, in frames of the harness's clock. */
const HELD_FRAMES = ticksFor(1);

/** How many readings of the lane are taken across each held second. */
const READINGS = 3;

/**
 * How far the ship must travel under a second of a held direction for the sweep to
 * be a second OF MOVEMENT at all.
 *
 * Not a reading of the ship's speed — `ship/moves-left` and `ship/moves-right` grade
 * that — but the precondition this check's own scenario needs, since a ship that
 * never moved would hold any lane at all. A tenth of the ground `SHIP_SPEED` covers
 * in a second: far below any conformant build, far above standing still.
 */
const MOVED_MIN = 36;

/**
 * The centre `y` of the draw that put the seeded fighter art on the stage at the
 * ship's own `x`, read off one freshly rendered frame.
 *
 * The frame's own blits are what is read, so the call log is emptied before the
 * frame that produces them: `Harness.calls` holds everything the harness has ever
 * rendered, and a reading taken over all of it would find the ship where it was
 * hundreds of frames ago.
 *
 * The candidate is chosen by horizontal position and by silhouette alone: within
 * `SHIP_W` of the `x` the snapshot reports, so the row of hulls specs/ui.md puts in
 * the bottom HUD strip — which this scenario keeps hundreds of units away from the
 * ship's own `x` — is never mistaken for the ship, and the ship's `y` takes no part
 * in the choice.
 */
async function drawnLaneY(h: Harness): Promise<number> {
  h.calls.length = 0;
  await h.advance(1);

  const { ship } = h.snapshot();
  const candidates = drawnImages(h)
    .filter((image) => Math.abs(image.x - ship.x) <= SHIP_W)
    .sort((a, b) => Math.abs(a.x - ship.x) - Math.abs(b.x - ship.x));
  for (const image of candidates) {
    if ((await silhouetteMatch(image.source, "fighter")) >= SHIP_ART_MIN) {
      return image.y;
    }
  }
  fail(
    `the ship drawn from the seeded fighter art within ${String(SHIP_W)} units ` +
      "of the x the snapshot reports (specs/assets.md)",
    `no such drawImage at ship x ${ship.x.toFixed(1)}`,
  );
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("holds the ship's centre at SHIP_Y through a second of movement each way", async () => {
  startPosed(harness);

  const lanes: { at: string; y: number }[] = [
    { at: "before the sweep", y: await drawnLaneY(harness) },
  ];

  for (const direction of ["left", "right"] as const) {
    const before = harness.snapshot().ship.x;
    harness.hold(KEYS[direction]);
    for (let reading = 0; reading < READINGS; reading += 1) {
      // The held second, split evenly across the readings. Each reading runs one
      // frame of its own to read the draw, which is counted in the split.
      await harness.advance(Math.floor(HELD_FRAMES / READINGS) - 1);
      lanes.push({
        at:
          `${String(reading + 1)} of ${String(READINGS)} through the held ` +
          direction,
        y: await drawnLaneY(harness),
      });
    }
    harness.release(KEYS[direction]);

    // The sweep really was a second of MOVEMENT, so the lanes above were read of a
    // ship that was travelling rather than one standing still.
    const after = harness.snapshot().ship.x;
    const travelled = direction === "left" ? before - after : after - before;
    assertGreaterThan(
      travelled,
      MOVED_MIN,
      `the units the ship travelled ${direction} under a held second`,
    );
  }

  captureStill(harness, "lane");

  for (const lane of lanes) {
    assertLessThanOrEqual(
      Math.abs(lane.y - SHIP_Y),
      LANE_TOLERANCE,
      `how far the drawn ship's centre sat from SHIP_Y (${String(SHIP_Y)}) ` +
        `${lane.at}, on a hull ${String(SHIP_H)} units tall (specs/field.md)`,
    );
  }
});
