// resonance/discharge-clears-entering — every drone in phase `entering` is gone
// once the wave has run.
//
// THE RULE. `specs/resonance.md`'s wave table names three phases in one row: "A
// drone in phase `entering`, `diving`, or `returning` | It is destroyed." This
// point takes the `entering` row on its own, because a build that reads the row
// as "anything that is diving" leaves a wave flying in untouched and must fail
// here while passing `resonance/discharge-clears-divers`.
//
// WHERE AN ENTERING DRONE IS POSED. `specs/swarm.md` has an entering drone
// "Flying in from above the play field toward its formation slot", crossing
// `FIELD_TOP` into the field within a second of its release and reaching its slot
// within six, so a drone part-way down the upper field is exactly what the phase
// describes. The three are posed inside the play field, on and around the
// formation grid's top row (`FORM_ROW0_Y` `140`), where an entrance that has just
// crossed the edge really passes.
//
// EVERY FACULTY IS OFF, so each holds the place it was put: `specs/resonance.md`
// keys what the wave takes on the phase alone, and a drone that flew on down its
// entrance would be judged somewhere the check did not choose. Their slots are
// wherever `poseDrone` left them, which the phase's own rules never reach in the
// half-second this scenario runs.
//
// WHAT THIS DOES NOT DECIDE. What the wave does to the other three phases is the
// three sibling points; how an entrance is actually flown is `swarm`'s.

import { afterEach, beforeEach, it } from "vitest";
import { DISCHARGE_MAX_R, DISCHARGE_TIME, RESONANCE_MAX } from "../constants";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  findDrone,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseBystander, release } from "./wave";

/**
 * Where the three entering drones stand.
 *
 * Just inside the play field below `FIELD_TOP` (`64`), spread across its width,
 * at `484`, `460` and `484` units from the ship at `(640, 600)` — every one a
 * third of `DISCHARGE_MAX_R` (`1500`) or less, so the wave reaches all three
 * inside its life. Clear of the corner the bystander holds.
 */
const ENTERING_AT = [
  { x: 340, y: 220 },
  { x: 640, y: 140 },
  { x: 940, y: 220 },
] as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the suite's clock. The wave grows from `0` to
 * `DISCHARGE_MAX_R` (`1500`) over that span, so a drone `484` units out is
 * reached a third of the way through and the reading is taken well past that.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys every drone in phase entering", async () => {
  startPosed(h);
  // In the formation, which specs/resonance.md's own table spares, so a drone is
  // still standing when the three are taken (specs/stages.md clears a stage in
  // the moment the last drone of its wave is destroyed).
  poseBystander(h);
  const entering = ENTERING_AT.map((at) =>
    poseDrone(h, "shard", at.x, at.y, { phase: "entering" }),
  );

  const posed = h.snapshot();
  assertLength(
    posed.drones,
    ENTERING_AT.length + 1,
    "precondition: the three entering drones and the bystander are on the field",
  );
  for (const id of entering) {
    assertEqual(
      droneOf(posed, id).phase,
      "entering",
      "precondition: the posed drone stands in phase entering",
    );
  }

  await release(h, RESONANCE_MAX);
  await h.advance(WAVE_TICKS);
  captureStill(h, "cleared");
  const after = h.snapshot();

  for (const [index, id] of entering.entries()) {
    assertNull(
      findDrone(after, id),
      `the drone posed in phase entering at (${ENTERING_AT[index].x}, ` +
        `${ENTERING_AT[index].y}), well inside DISCHARGE_MAX_R ` +
        `(${DISCHARGE_MAX_R}) of the ship: destroyed by the wave ` +
        `(specs/resonance.md)`,
    );
  }
});
