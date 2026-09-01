// resonance/discharge-clears-returning — every drone in phase `returning` is gone
// once the wave has run.
//
// THE RULE. The third phase of specs/resonance.md's one row: "A drone in phase
// `entering`, `diving`, or `returning` | It is destroyed." Read on its own,
// because a build that spares a survivor on its way home — the phase a drone is
// in while it loops back to its slot — must fail here while passing the `diving`
// and `entering` siblings.
//
// WHERE A RETURNING DRONE IS POSED. specs/swarm.md has it looping back to its
// slot after a dive, travelling from wherever its dive ended back up to the
// formation, so a drone below the grid and above the ship's lane is squarely
// inside what the phase describes. Its slot is set to a real grid slot, so the
// pose is a drone genuinely on its way somewhere rather than one with nowhere to
// go.
//
// EVERY FACULTY IS OFF, so each holds the place it was put: specs/resonance.md
// keys what the wave takes on the phase alone, and a drone that travelled on
// would be judged somewhere the check did not choose.
//
// WHAT THIS DOES NOT DECIDE. What the wave does to the other three phases is the
// three sibling points; how a return is actually flown, and how long it may take,
// is `swarm`'s.

import { afterEach, beforeEach, it } from "vitest";
import { DISCHARGE_MAX_R, DISCHARGE_TIME } from "../../src/constants";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  slotCenter,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseBystander, release } from "./wave";

/**
 * Where the three returning drones stand, and the slot each is heading for.
 *
 * Between the formation grid (whose filled rows end at `slotY(4)` = 332,
 * specs/field.md) and the ship's lane at `SHIP_Y` (`600`), spread across the
 * field's width: 256, 160 and 256 units from the ship at `(640, 600)`, all far
 * inside `DISCHARGE_MAX_R` (`1500`), so the wave reaches every one of them early
 * in its life. Clear of the corner the bystander holds.
 */
const RETURNING = [
  { x: 440, y: 440, col: 2, row: 0 },
  { x: 640, y: 440, col: 4, row: 0 },
  { x: 840, y: 440, col: 6, row: 0 },
] as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the harness's 100 Hz clock. The wave grows from
 * `0` to `DISCHARGE_MAX_R` (`1500`) over that span, so a drone 256 units out is
 * reached inside the first fifth of it.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys every drone in phase returning", async () => {
  startPosed(h);
  // In the formation, which specs/resonance.md's own table spares, so a drone is
  // still standing when the three are taken (specs/stages.md clears a stage in
  // the moment the last drone of its wave is destroyed).
  poseBystander(h);
  const returning = RETURNING.map((at) =>
    poseDrone(h, "shard", at.x, at.y, {
      phase: "returning",
      slot: slotCenter(at.col, at.row),
    }),
  );

  const posed = h.snapshot();
  assertLength(
    posed.drones,
    RETURNING.length + 1,
    "precondition: the three returning drones and the bystander are on the field",
  );
  for (const id of returning) {
    assertEqual(
      droneById(posed, id)?.phase,
      "returning",
      "precondition: the posed drone stands in phase returning",
    );
  }

  await release(h);
  await h.advance(WAVE_TICKS);
  captureStill(h, "cleared");
  const after = h.snapshot();

  for (const [index, id] of returning.entries()) {
    assertUndefined(
      droneById(after, id),
      `the drone posed in phase returning at (${RETURNING[index].x}, ` +
        `${RETURNING[index].y}), well inside DISCHARGE_MAX_R ` +
        `(${DISCHARGE_MAX_R}) of the ship: destroyed by the wave ` +
        `(specs/resonance.md)`,
    );
  }
});
