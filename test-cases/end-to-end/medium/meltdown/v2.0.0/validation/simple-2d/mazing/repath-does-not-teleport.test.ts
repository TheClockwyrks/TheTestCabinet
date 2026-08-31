// mazing/repath-does-not-teleport — a recomputation moves nothing.
//
// specs/mazing.md: "Each unit's route is recomputed from the tile its centre
// occupies at that moment, and a recomputation moves nothing: every unit's centre
// on the frame the floor changed is exactly where the frame's own movement left
// it."
//
// TWO READINGS OF THAT ONE SENTENCE.
//
//   1. The floor changes with no frame in between. The wall is added and the
//      centre is read again before any frame runs, so the frame's own movement is
//      nothing at all and the centre must be EXACTLY where it was. A build that
//      snaps a unit to the tile it re-paths from fails here.
//   2. Then one frame runs — the frame the wall lands on — and the centre may have
//      moved by what the unit's own speed buys in a frame, and by no more. A build
//      that defers its recomputation to its next update, and snaps there, fails
//      here.
//
// WHY THE UNIT IS POSED OFF-CENTRE. A snap to the centre of the tile a unit is
// standing on is invisible when the unit is already standing on that centre. So
// the unit is placed `6` units east and `6` units north of the centre of tile
// (12, 17) — inside that tile, whose half-width is `9.5` (specs/floor.md), and
// `8.49` units from its centre, which is seventeen times what one frame of a
// Mote's own `60` units per second (specs/surge.md) can legitimately cover. Its
// motion is left ON, because the sentence is about what a frame's own movement
// leaves, and the unit is a walker.
//
// WHY THE WALL'S GUNS ARE OFF. A Lance eight tiles away would shoot the Mote, and
// a position reading taken off a unit that is being killed measures the wrong
// thing. specs/instrumentation.md's firing gate holds targeting and the shot
// alone, so the wall walls exactly as specs/mazing.md says a tower of any kind
// does.

import { afterEach, beforeEach, it } from "vitest";
import {
  LEFT_VENT_ROWS,
  SURGE_DEFS,
  tileCX,
  tileCY,
} from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  TICK_HZ,
  captureReplay,
  createHarness,
  poseIdleTower,
  poseWalker,
  startRun,
  ticksFor,
  unitOf,
  type Harness,
  type TowerType,
  type UnitSnapshot,
} from "../harness";
import { distance } from "./geometry";

/** The type whose 4x4 footprint spans the corridor's whole four-row run. */
const WALL_TYPE: TowerType = "lance";

/** Where the wall lands: eight tiles ahead of the unit, spanning the corridor. */
const WALL_COL = 20;
const WALL_ROW = LEFT_VENT_ROWS[0];

/** The tile the unit is standing in when the floor changes under it. */
const STAND_COL = 12;
const STAND_ROW = LEFT_VENT_ROWS[1];

/**
 * How far off that tile's centre the unit is posed, in logical units.
 *
 * Inside the tile, whose half-width is `9.5` (specs/floor.md), and far enough from
 * the centre that a snap to it is unmistakable: the offset is `8.49` units of
 * travel away.
 */
const OFF_CENTRE = 6;

/** A short lead and tail, so the replay shows a walker rather than a still. */
const LEAD_SECONDS = 0.5;
const TAIL_SECONDS = 1.0;

/**
 * The most the centre may move over the one frame the wall lands on, in logical
 * units.
 *
 * One frame of this suite's clock is `1 / 120` s and a Mote's own speed is `60`
 * units per second (specs/surge.md), so its own movement buys `0.5` units. The
 * bound is twice that, which leaves room for a build that clamps or splits its
 * delta and is still a sixth of the `8.49` units a snap to the tile centre would
 * cover.
 */
const MAX_FRAME_TRAVEL = (2 * SURGE_DEFS.mote.speed) / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a unit's centre exactly where it stood when the floor changed", async () => {
  startRun(h);
  const walker = poseWalker(h, "mote", "left");

  const legs = await captureReplay(
    h,
    "held",
    async (): Promise<{
      before: UnitSnapshot;
      onChange: UnitSnapshot;
      afterFrame: UnitSnapshot;
    }> => {
      await h.advance(ticksFor(LEAD_SECONDS));

      // Off the centre of a known tile, so a snap to that centre is visible.
      h.debug.setUnitPosition(
        walker,
        tileCX(STAND_COL) + OFF_CENTRE,
        tileCY(STAND_ROW) - OFF_CENTRE,
      );
      const before = unitOf(h.snapshot(), walker);

      // The floor changes, and no frame runs.
      poseIdleTower(h, WALL_TYPE, WALL_COL, WALL_ROW);
      const onChange = unitOf(h.snapshot(), walker);

      // Then the one frame the wall lands on.
      await h.advance(1);
      const afterFrame = unitOf(h.snapshot(), walker);

      await h.advance(ticksFor(TAIL_SECONDS));
      return { before, onChange, afterFrame };
    },
  );

  assertEqual(
    legs.onChange.x,
    legs.before.x,
    "the centre's x is untouched by the recomputation the wall triggered",
  );
  assertEqual(
    legs.onChange.y,
    legs.before.y,
    "the centre's y is untouched by the recomputation the wall triggered",
  );
  assertLessThanOrEqual(
    distance(legs.before, legs.afterFrame),
    MAX_FRAME_TRAVEL,
    `over the one frame the wall landed on, the centre moves no further than ` +
      `the ${MAX_FRAME_TRAVEL} units a Mote's own ${SURGE_DEFS.mote.speed} ` +
      `units per second buys twice over; it moved`,
  );
});
