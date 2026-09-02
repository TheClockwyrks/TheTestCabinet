// field/sway-together — the formation sways as one rigid body.
//
// specs/field.md, "The sway": "The whole formation translates horizontally as one
// rigid body ... so every slotted drone carries the same offset at the same instant
// and the block's shape never changes." The reading is therefore a SPREAD rather
// than a position: at each instant, every drone's distance from its own slot must
// be the same number.
//
// THE FORMATION IS SPREAD ACROSS THE GRID ON PURPOSE. Six drones over five columns
// and four rows, the two outermost columns among them, so a build whose offset
// depends on where a drone sits — one that scales the sway by column, or gives each
// row its own phase, or lets each drone run its own clock — reads as a spread rather
// than as a shift. A block posed down one column could not tell those apart from a
// rigid one.
//
// AND IT IS READ ACROSS A WHOLE PERIOD, not at one instant: a build whose drones run
// the same wave out of phase agrees at the crossings and disagrees everywhere else,
// so a single reading could land on a moment where a broken build looks right. Every
// drone carries travel and nothing else, so its slot ride is the only thing moving
// it.
//
// This is the shape of the block over time. WHERE a slot is is `field/slot-grid`,
// and HOW FAR the block swings is `field/sway-amplitude`.

import { afterEach, beforeEach, it } from "vitest";
import { SWAY_PERIOD, slotX } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseFormation,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { droneOnRoster } from "./roster";

/**
 * How far apart two drones' offsets from their own slots may sit at one instant, in
 * logical units. The item's own figure: "within one unit".
 */
const TOGETHER_TOLERANCE = 1;

/**
 * How often the block is read during the sweep, in frames.
 *
 * A tenth of a second, so a whole `SWAY_PERIOD` is read at fifty instants spread
 * evenly over it — the crossings, both turns, and everything between, so a block
 * whose drones run out of phase cannot be read only where it happens to agree. Not a
 * tolerance: nothing follows from the sampling grid but how many instants are
 * judged.
 */
const SAMPLE_EVERY = ticksFor(0.1);

/** One whole period, plus a sample, so both turns are inside the sweep. */
const SWEEP_FRAMES = ticksFor(SWAY_PERIOD) + SAMPLE_EVERY;

/**
 * The six slots the block is posed into: both outermost columns, the centre column,
 * and four different rows.
 */
const SLOTS = [
  { col: 0, row: 0 },
  { col: 8, row: 0 },
  { col: 2, row: 1 },
  { col: 6, row: 3 },
  { col: 4, row: 2 },
  { col: 4, row: 4 },
] as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("gives every formation drone the same sway offset at the same instant", async () => {
  startPosed(harness);

  const ids = poseFormation(
    harness,
    SLOTS.map((slot) => ({ kind: "shard" as const, ...slot, travel: true })),
  );
  const posed = SLOTS.map((slot, index) => ({ ...slot, id: ids[index] }));

  let worst = { spread: 0, t: 0, low: 0, high: 0 };
  for (let frame = 0; frame < SWEEP_FRAMES; frame += SAMPLE_EVERY) {
    await harness.advance(SAMPLE_EVERY);
    const snapshot = harness.snapshot();
    const offsets = posed.map(
      (entry) =>
        droneOnRoster(snapshot, entry.id, "across the block's sway sweep").x -
        slotX(entry.col),
    );
    const low = Math.min(...offsets);
    const high = Math.max(...offsets);
    if (high - low > worst.spread) {
      worst = {
        spread: high - low,
        t: seconds(frame + SAMPLE_EVERY),
        low,
        high,
      };
    }
  }
  captureStill(harness, "together");

  assertLessThanOrEqual(
    worst.spread,
    TOGETHER_TOLERANCE,
    `the widest gap between two drones' offsets from their own slots at one ` +
      `instant across a whole SWAY_PERIOD — ${worst.low.toFixed(3)} against ` +
      `${worst.high.toFixed(3)}, at t = ${worst.t.toFixed(2)} s — which ` +
      `specs/field.md makes one number for the whole block`,
  );
});
