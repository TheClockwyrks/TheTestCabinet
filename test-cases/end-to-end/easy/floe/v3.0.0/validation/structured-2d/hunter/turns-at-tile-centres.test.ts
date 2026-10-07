// hunter/turns-at-tile-centres — a bear changes the axis it travels on only where
// its centre is a tile centre.
//
// specs/hunter.md: "it changes the axis it travels on only at a tile center", and
// the settling rule behind it — a tick whose travel would carry the bear past the
// centre of the tile it is entering settles it EXACTLY on that centre for that
// tick, and the leftover goes to the next tick. So a turn happens across a tick
// boundary at which the centre is a tile centre exactly.
//
// The reading is every tick of a real pursuit, one tick apart. Where the axis a
// tick moved the bear along differs from the axis of the last tick that moved it,
// the centre at the boundary between them is required to be a tile centre. Ticks
// that moved it on neither axis carry no axis, so they are passed over rather
// than counted as turns; ticks that moved it on both are `one-axis-at-a-time`'s
// verdict, not this one's, and are passed over here.
//
// The bear runs under its own routing, because a turn is what routing produces.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import { ROW_NEAR, colAt, rowAt, tileCX, tileCY } from "../constants";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { axisMoved, samplePerTick } from "./harness";

/**
 * The pursuit: three tiles across and three tiles up.
 *
 * Every shortest route over that pair of differences turns at least once, and six
 * tiles at `BEAR_ICE_SPEED` (3) tiles a second is two of the four seconds read,
 * so a build that routes to the specification turns inside the window whichever
 * of the shortest routes it picks.
 */
const BEAR_COL = 20;
const BEAR_ROW = ROW_NEAR - 1;
const CRITTER_COL = BEAR_COL + 3;
const CRITTER_ROW = BEAR_ROW - 3;

/** The seconds of pursuit read, from the item. */
const PURSUIT_SECONDS = 4;

/** Units of movement below which a tick is read as having moved nothing. */
const MOVE_EPSILON = 1e-6;

/**
 * How far off a tile centre a turning bear may be found, in stage units.
 *
 * The specification says the settle is EXACT, so the honest allowance is only
 * what arithmetic costs: a hundredth of a unit is three thousandths of a tile,
 * far under anything a build could mean by a position and far over the last bits
 * of a double.
 */
const CENTRE_TOLERANCE = 0.01;

/** How far a centre is from the centre of the tile it falls in, in stage units. */
function offCentre(point: { x: number; y: number }): number {
  return Math.max(
    Math.abs(point.x - tileCX(colAt(point.x))),
    Math.abs(point.y - tileCY(rowAt(point.y))),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("turns the bear only where its centre is a tile centre", async () => {
  startCrossing(h);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  const id = poseBear(h, BEAR_COL, BEAR_ROW);

  const samples = await captureReplay(h, "turn", () =>
    samplePerTick(h, ticksFor(PURSUIT_SECONDS)),
  );

  let travelling: "x" | "y" | null = null;
  let turns = 0;
  const offTurns: string[] = [];
  for (let k = 1; k < samples.length; k += 1) {
    const before = samples[k - 1].bears.find((entry) => entry.id === id);
    const after = samples[k].bears.find((entry) => entry.id === id);
    if (before === undefined || after === undefined) continue;
    const axis = axisMoved(before, after, MOVE_EPSILON);
    if (axis !== "x" && axis !== "y") continue;
    if (travelling !== null && axis !== travelling) {
      turns += 1;
      const off = offCentre(before);
      if (off > CENTRE_TOLERANCE) {
        offTurns.push(`tick ${k}: (${before.x}, ${before.y}) is ${off} off`);
      }
    }
    travelling = axis;
  }

  assertGreaterThanOrEqual(
    turns,
    1,
    `turns over ${PURSUIT_SECONDS} s of a pursuit whose every shortest route ` +
      `turns`,
  );
  assertLength(
    offTurns,
    0,
    `turns taken away from a tile centre: ${offTurns.slice(0, 3).join("; ")}`,
  );
});
