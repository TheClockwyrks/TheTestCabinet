// resonance/discharge-spares-formation — every drone in phase `formation` is
// still standing once the wave has run.
//
// THE RULE. `specs/resonance.md`'s wave table, the row that is a survival: "A
// drone in phase `formation` | Nothing." It is the opposite direction of the
// three points that read the phases the wave destroys, so a build that clears the
// whole field on a discharge and a build that clears the correct three phases
// grade differently.
//
// A SURVIVAL IS VACUOUS UNLESS THE WAVE REALLY SWEPT OVER IT, and that is the one
// hard thing about this point: a build whose discharge does nothing at all leaves
// the formation standing too, and would pass a check that read only "they are
// still there". So the wave is sampled frame by frame, and each drone is required
// to have been REACHED as `specs/resonance.md` defines reached — "when that
// thing's center lies inside the wave's current radius", both figures taken from
// the same snapshot — before its survival is read. The reach is a PRECONDITION;
// the verdict is the survival.
//
// THE DRONES ARE POSED ON THE GRID'S OWN SLOTS, in phase `formation`, with their
// slots set to those centres, because that is what a formation drone is
// (`specs/swarm.md`: it "sits at its slot plus the sway offset ... and it stays
// there"). Every faculty is off, so none of them rides the sway out from under
// the reach the sampler measured or is pulled into a dive mid-wave.
//
// FIVE ACROSS THE GRID, at three different distances from the ship, so a build
// that spares only what it happens not to reach first, or only the nearest row,
// reads differently from one that spares the phase.
//
// WHAT THIS DOES NOT DECIDE. That the wave destroys the other three phases is the
// three sibling points; that it spares the player's own bullets is
// `resonance/discharge-spares-player-bullets`.

import { afterEach, beforeEach, it } from "vitest";
import { DISCHARGE_TIME, RESONANCE_MAX } from "../constants";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  findDrone,
  poseFormation,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { everReached, release, sweep } from "./wave";

/**
 * The grid slots the formation is posed on.
 *
 * Five of the `FORM_COLS` (`9`) by `FORM_ROWS` (`5`) grid, over three rows and
 * the grid's full width, and mirror-symmetric about the centre column as
 * `specs/swarm.md` requires of a filled layout. The mirrored pairs put them at
 * three distinct distances from the ship at `(640, 600)` — `527`, `386` and `268`
 * units — so a build that spares only the near row and one that spares the phase
 * read differently. Every one is a small fraction of `DISCHARGE_MAX_R` (`1500`)
 * out and so is swept over early in the wave's life.
 */
const SLOTS = [
  { kind: "shard", col: 0, row: 0 },
  { kind: "shard", col: 2, row: 2 },
  { kind: "shard", col: 4, row: 4 },
  { kind: "shard", col: 6, row: 2 },
  { kind: "shard", col: 8, row: 0 },
] as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the suite's clock, sampled one frame at a time so
 * the radii the wave passed through are all read. The wave grows to
 * `DISCHARGE_MAX_R` (`1500`) over that span, which is nearly twice the distance
 * from the ship to the furthest corner of the stage, so every posed drone is
 * swept over with room to spare.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every drone in phase formation standing", async () => {
  startPosed(h);
  const slotted = poseFormation(h, [...SLOTS]);

  const posed = h.snapshot();
  for (const id of slotted) {
    assertEqual(
      droneOf(posed, id).phase,
      "formation",
      "precondition: the posed drone rests in phase formation",
    );
  }
  assertEqual(
    posed.discharge.active,
    false,
    "precondition: no wave is running before the action",
  );

  await release(h, RESONANCE_MAX);
  const samples = await sweep(h, WAVE_TICKS);
  captureStill(h, "spared");
  const after = h.snapshot();

  for (const id of slotted) {
    // The verdict first, so a build that TOOK the drone is named for that rather
    // than for the reach it then has no drone left to have covered.
    assertNotNull(
      findDrone(after, id),
      `the drone resting in phase formation after a discharge wave swept over ` +
        `it: still standing, since the wave does nothing to a drone in ` +
        `formation (specs/resonance.md)`,
    );
    // And then the anti-vacuity reading: a survival the wave never reached
    // decides nothing, so the sweep has to show the radius covering it.
    assertTrue(
      everReached(samples, (snapshot) => findDrone(snapshot, id)),
      `precondition: the wave's radius covered the drone resting at its slot, ` +
        `so its survival is one the wave declined rather than one it never ` +
        `reached (specs/resonance.md)`,
    );
  }
});
