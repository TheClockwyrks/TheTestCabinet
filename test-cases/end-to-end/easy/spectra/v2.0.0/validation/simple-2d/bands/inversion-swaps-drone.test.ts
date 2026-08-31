// bands/inversion-swaps-drone — an inversion swaps a drone's band.
//
// specs/bands.md, "Effective band": a thing's effective band is "its stored band,
// taken as the opposite band once for each of the following that holds", one of
// which is "A spectral inversion is active and the entity is a drone or an enemy
// bullet". "The spectral inversion" states the same rule again — "While an
// inversion is active, every drone and every enemy bullet reads as the opposite
// of its stored band". specs/instrumentation.md reports the two separately, as a
// drone's `band` and its `effectiveBand`.
//
// THE ONE SWAP IS THE INVERSION'S. The target is a SHARD, which is the one kind
// carrying no swap of its own: a Prism's broken shell is a swap
// (`bands.prism-shell-flips-effective-band`) and a Flux's shimmer is another
// (the `drones` group's), so either would put a second toggle into a reading
// meant to hold exactly one. Its faculties are all off, so nothing moves it,
// nothing turns its band clock, and nothing it fires enters the reading.
//
// THE INVERSION IS POSED, not triggered. `setInversion` is the operation
// specs/instrumentation.md provides for exactly this — "sets the seconds of
// spectral inversion remaining" — and what TRIGGERS one is a diving Prism, which
// is the `drones` group's point. Posing it is what keeps this reading about what
// an inversion DOES.
//
// ONE FRAME RUNS, so the reading is taken off a game that has stepped rather than
// off the pose itself, and so the still has a rendered field in it.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the drone stands: well inside the play field (specs/field.md). */
const DRONE_X = LANE_CENTER;
const DRONE_Y = 320;

/** The band the drone stores, and the one an inversion makes it read as. */
const STORED_BAND = "cyan" as const;
const SWAPPED_BAND = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a stored-cyan Shard as magenta while an inversion runs", async () => {
  startPosed(h);
  h.debug.setInversion(INVERSION_TIME);
  const droneId = poseDrone(h, "shard", DRONE_X, DRONE_Y, {
    band: STORED_BAND,
  });

  await h.advance(1);
  captureStill(h, "swapped");

  const drone = droneOf(h.snapshot(), droneId);
  assertEqual(
    drone.effectiveBand,
    SWAPPED_BAND,
    `the effective band of a Shard storing ${STORED_BAND} with an inversion ` +
      `of ${INVERSION_TIME} s posed (it stores ${drone.band}) — ` +
      "specs/bands.md: while an inversion is active, every drone reads as the " +
      "opposite of its stored band",
  );
});
