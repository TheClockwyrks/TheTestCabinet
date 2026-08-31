// Meltdown — surge/walks-at-its-speed: a unit covers its own speed a second.
//
// THE RULE. `specs/surge.md` gives each type a speed "in logical units per
// second", and `specs/mazing.md` spends it: "A unit travels toward the centre of
// the next tile of its route at its current speed, in logical units per second."
// `specs/waves.md` says which second that is — "The game advances by the elapsed
// time of every frame, multiplied by the game speed. Every rate in this
// specification is per second and is integrated against that game time, and
// `simTime` accumulates it." So the figure is a distance divided by a gain in
// `simTime`, and this point measures exactly that.
//
// TWO TYPES, BECAUSE ONE FIGURE CANNOT TELL A TABLE FROM A CONSTANT. A build that
// walks every unit at one speed reads the same number twice. The Mote's `60` and
// the Sprint's `120` are exactly a factor of two apart, so no single constant, and
// no figure derived from hp or bounty, lands on both.
//
// WHERE THE WALK IS POSED, AND WHY THAT ROUTE IS THE ONLY ONE. Each unit is stood
// on the centre of tile `(5, 17)` on an EMPTY floor. `specs/floor.md` opens the
// left vent on rows 16 to 19 and gives it the right exhaust — the same four rows —
// as its fixed opposite, and `specs/mazing.md` costs an orthogonal step `1` and a
// diagonal `sqrt(2)`. Straight east along row 17 is therefore 44 steps and costs
// `44`; any route that changes row costs at least `43 + sqrt(2)`, which is more.
// The cheapest route is unique and it is a straight line, so the straight-line
// distance this point measures IS the distance the unit walked, with no route
// geometry folded into the reading.
//
// WHY THE WINDOW IS TWO SECONDS AND STOPS WHERE IT DOES. The Sprint covers `240`
// logical units in two seconds, twelve and a half tiles, which leaves it at column
// eighteen: nowhere near the exhaust, so neither unit leaves the roster mid-window
// and neither reading is taken on a unit that has stopped. Nothing else stands on
// the floor, so nothing shoots at it, slows it, or walls it in.
//
// BOTH READINGS COME FROM THE ONE WINDOW. `windowOfFrames` takes one snapshot as
// the window opens and one as it closes, and the travel and the `simTime` gain are
// both read off that pair, so the distance and the interval it is divided by span
// the same stretch of game time and nothing else. The engine's frame loop runs the
// identical frame a player's frame runs, so what this measures is the game's own
// advance rather than an instrument's.
//
// WHAT EVERY WRONG MODEL READS. A build that walks per frame rather than per
// second reads a speed that follows the suite's clock rather than the table; one
// that swapped the Mote's and the Sprint's rows reads `120` and `60`; one that
// walks everything at the Mote's speed reads `60` twice; one that applied a slow
// nobody asked for reads a fraction of the figure; one whose unit does not move at
// all reads `0`.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS, TILE } from "../../src/constants";
import { assertBetween, assertGreaterThan, assertNotNull } from "../assert";
import {
  captureStill,
  clockGain,
  createHarness,
  poseWalker,
  startRun,
  ticksFor,
  tileCenter,
  travelOf,
  windowOfFrames,
  type Harness,
  type SurgeType,
} from "../harness";

/** The tile each walker is stood on: on the left vent's row 17, near its end. */
const START = { col: 5, row: 17 } as const;

/** Seconds of game time the window is held open for. */
const WINDOW_SECONDS = 2;

/**
 * The fraction of the stated speed a reading may miss by: `0.08`.
 *
 * `specs/mazing.md` walks a unit "toward the centre of the next tile of its
 * route", which leaves a build free to spend its frame's travel budget one segment
 * at a time and to drop whatever is left when it lands on a tile centre. A Sprint
 * at `120` logical units a second crosses `120 / TILE` tile centres a second, and
 * a build that drops the remainder at each of them loses at most one frame of
 * travel per crossing, which is `speed / (TILE * TICK_HZ)` of the distance —
 * `120 / (19 * 120)`, a shade over `5.2%`. The window's own ends cost one frame
 * each, another `2 / (WINDOW_SECONDS * TICK_HZ)`, under `0.9%`. `0.08` covers both
 * with room over, and is nowhere near the `50%` that separates the two rows this
 * point reads, so no build that walks at the wrong type's speed fits inside it.
 */
const SPEED_TOLERANCE = 0.08;

/**
 * The least a window must produce for the reading to mean anything: half a tile.
 *
 * A floor on which nothing moves divides `0` by the interval and reads `0`, which
 * the bounds below already reject; this states the anti-vacuity leg in its own
 * right so a dead floor fails as a dead floor rather than as a wrong speed.
 */
const MIN_TRAVEL = TILE / 2;

/** The interval the travel is divided by, which must be a real stretch of game time. */
const MIN_CLOCK_GAIN = WINDOW_SECONDS / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Walk one `type` due east for the window, and read its speed off the pair.
 *
 * The still is written each time round, so what a reviewer looks at is the last
 * walk this point drove; the assertions are the caller's either way.
 */
async function speedOf(type: SurgeType): Promise<number> {
  startRun(h);
  const id = poseWalker(h, type, "left");
  const at = tileCenter(START.col, START.row);
  h.debug.setUnitPosition(id, at.x, at.y);

  const span = await windowOfFrames(h, ticksFor(WINDOW_SECONDS));
  captureStill(h, "travel");

  const travelled = travelOf(span, id);
  assertNotNull(
    travelled,
    `the ${type} still on the floor at both ends of the window`,
  );
  const distance = travelled as number;
  const elapsed = clockGain(span);

  assertGreaterThan(
    distance,
    MIN_TRAVEL,
    `logical units the ${type} covered, so the reading was taken on a floor ` +
      `that was actually walking`,
  );
  assertGreaterThan(
    elapsed,
    MIN_CLOCK_GAIN,
    `seconds of game time the window spanned, read off simTime ` +
      `(specs/waves.md)`,
  );
  return distance / elapsed;
}

it("walks a Mote at 60 logical units a second and a Sprint at 120", async () => {
  for (const type of ["mote", "sprint"] as const) {
    const stated = SURGE_DEFS[type].speed;
    const measured = await speedOf(type);
    assertBetween(
      measured,
      stated * (1 - SPEED_TOLERANCE),
      stated * (1 + SPEED_TOLERANCE),
      `the ${type}'s logical units per second of game time, against the ` +
        `${stated} specs/surge.md states`,
    );
  }
});
