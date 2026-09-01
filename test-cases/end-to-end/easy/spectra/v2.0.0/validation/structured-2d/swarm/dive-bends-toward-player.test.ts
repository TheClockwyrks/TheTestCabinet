// swarm/dive-bends-toward-player — a dive closes on the ship, wherever it is.
//
// specs/swarm.md, "The dive": the path "bends toward the ship's current `x`, so
// it closes on the ship rather than running a fixed track, while staying wide
// enough to dodge".
//
// WHY THE SAME DIVE IS FLOWN TWICE, WITH THE SHIP ON OPPOSITE SIDES. A single
// reading cannot tell a dive that bends toward the ship from a dive that always
// sweeps toward the same side of the field and happened to be pointed at it. So
// the drone is posed at the same row both times, and the ship is parked at the
// far LEFT end of its lane for the first dive and the far RIGHT for the second:
// a fixed track closes on one and runs away from the other, whichever track it
// is, while a path that bends toward the ship closes on both. The ship is parked
// before the drone is put into its dive, so the build lays its path out knowing
// where the ship is.
//
// HOW MUCH CLOSING IS ASKED FOR. A third of the horizontal gap, which is the
// item's own figure and a deliberately loose one: the specification also requires
// the path to stay "wide enough to dodge", so a dive that ran the ship down would
// be conforming to one half of the sentence by breaking the other. A third is
// far more than a fixed track can manage in the direction it runs away in — from
// the far side of the lane a track that closes on the left leaves the gap to a
// ship on the right GROWING — and far less than a build that genuinely aims has
// to give.
//
// The drone dives with travel on and firing off, so nothing it would shoot
// reaches the ship, and the ship's contact test is off through `startPosed`, so
// a dive that presses all the way home neither costs a life nor stops the wave.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_TOP, SHIP_X_MAX, SHIP_X_MIN, slotX } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { traceDrone } from "./flight";

/** The stage the dive is posed at: the first, a standard wave's. */
const STAGE = 1;

/**
 * The share of the horizontal gap the dive must close: the item's own third.
 *
 * Read as the gap that may REMAIN, so the assertion is on the closest the dive
 * ever got to the ship's lane position: two thirds of what it started with.
 */
const GAP_LEFT = 2 / 3;

/**
 * How long each dive is watched, in frames.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds", so this is the
 * whole span a dive may occupy. The watch stops itself the moment the drone
 * leaves phase `diving`, which is sooner on any build whose dives end.
 */
const DIVE_FRAMES = ticksFor(8);

/** Where the diver starts: the grid's outermost columns, top row. */
const FROM_RIGHT = { x: slotX(8), y: FIELD_TOP + 76 } as const;
const FROM_LEFT = { x: slotX(0), y: FIELD_TOP + 76 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("closes a third of the gap to the ship parked at either end of its lane", async () => {
  startPosed(h);

  /** Fly one dive from `at`, with the ship parked at `shipX`, and read the gap. */
  const dive = async (
    shipX: number,
    at: { x: number; y: number },
  ): Promise<{ opened: number; closest: number }> => {
    h.debug.clearDrones();
    h.debug.setShipX(shipX);
    const id = poseDrone(h, "shard", at.x, at.y, {
      phase: "diving",
      travel: true,
    });
    const trace = await traceDrone(h, id, {
      frames: DIVE_FRAMES,
      stop: (sample) => sample.phase !== "diving",
    });
    const gaps = trace.samples.map((sample) => Math.abs(sample.x - shipX));
    return { opened: gaps[0], closest: Math.min(...gaps) };
  };

  // Both dives inside one capture: the replay shows the same dive flown at a ship
  // parked left and then at a ship parked right, which is the whole of the point.
  const left = { opened: 0, closest: 0 };
  const right = { opened: 0, closest: 0 };
  await captureReplay(h, "bent", async () => {
    Object.assign(left, await dive(SHIP_X_MIN, FROM_RIGHT));
    Object.assign(right, await dive(SHIP_X_MAX, FROM_LEFT));
  });

  assertLessThanOrEqual(
    left.closest,
    left.opened * GAP_LEFT,
    `the closest the dive from x ${FROM_RIGHT.x} ever came to a ship parked at ` +
      `SHIP_X_MIN (${SHIP_X_MIN}), against the two thirds of its opening gap ` +
      `(${left.opened.toFixed(0)} units) the item leaves it, at stage ` +
      `${STAGE} (specs/swarm.md)`,
  );
  assertLessThanOrEqual(
    right.closest,
    right.opened * GAP_LEFT,
    `the closest the dive from x ${FROM_LEFT.x} ever came to a ship parked at ` +
      `SHIP_X_MAX (${SHIP_X_MAX}), against the two thirds of its opening gap ` +
      `(${right.opened.toFixed(0)} units) the item leaves it, at stage ` +
      `${STAGE} (specs/swarm.md)`,
  );
});
