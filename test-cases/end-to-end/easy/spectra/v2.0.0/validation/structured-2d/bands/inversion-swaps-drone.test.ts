// bands/inversion-swaps-drone — an inversion swaps what a drone reads as.
//
// specs/bands.md defines effective band ONCE — "its stored band, taken as the
// opposite band once for each of the following that holds" — and lists an active
// inversion as one of the three swaps, on "a drone or an enemy bullet". So a
// stored-cyan drone under an inversion reads magenta.
//
// A SHARD IS THE DRONE POSED, deliberately: it is the one kind with no swap of its
// own, a Prism's broken shell and a Flux's shimmer being the other two, so the
// inversion is the only thing that can move the reading and a wrong answer names
// the inversion.
//
// THE READING IS A PAIR, because the pair is what says the inversion SWAPPED the
// reading rather than the build rewriting the drone's stored band, which
// specs/bands.md forbids in the same breath: "Nothing about the ship, the player's
// bullets, or any stored band changes." A build that flipped the stored field
// instead would report `band` magenta and `effectiveBand` cyan, and fails here.
//
// THE INVERSION IS POSED with `setInversion`, which specs/instrumentation.md gives
// for exactly this: what STARTS an inversion is the `drones` category's item, and
// what a running one swaps is this one.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../constants";
import { assertEqual, fail } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the drone stands, in logical units: mid-field, clear of both HUD strips
 * (`FIELD_TOP` `64`, `FIELD_BOTTOM` `656`, specs/field.md) and far above the
 * ship's lane at `SHIP_Y` (`600`).
 */
const AT_X = LANE_CENTER;
const AT_Y = 320;

/** The drone's stored band, and the band it must read as under the inversion. */
const STORED = "cyan" as const;
const SWAPPED = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a stored-cyan drone as magenta while an inversion runs", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", AT_X, AT_Y, { band: STORED });
  h.debug.setInversion(INVERSION_TIME);
  // One frame, so the picture kept below is the posed field rather than the one
  // before it. It costs the inversion 0.01 s of its 5.
  await h.advance(1);

  const posed = h.snapshot();
  captureStill(h, "swapped");

  assertEqual(
    posed.inversionActive,
    true,
    `an inversion running over the posed drone, ${INVERSION_TIME} s having ` +
      `been set on it (specs/instrumentation.md)`,
  );
  const drone = droneById(posed, id);
  if (drone === undefined) {
    fail(
      "the posed Shard still on the drone roster (specs/instrumentation.md)",
      "no drone carries the id addDrone appended",
    );
  }
  assertEqual(
    drone.band,
    STORED,
    "the drone's stored band, which an inversion never changes (specs/bands.md)",
  );
  assertEqual(
    drone.effectiveBand,
    SWAPPED,
    `the band a stored-${STORED} drone reads as under an inversion, one swap ` +
      `taken on the stored band (specs/bands.md)`,
  );
});
