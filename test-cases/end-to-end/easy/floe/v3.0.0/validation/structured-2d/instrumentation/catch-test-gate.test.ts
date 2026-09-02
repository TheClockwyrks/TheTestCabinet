// instrumentation/catch-test-gate — `setCatchTest` gates whether a bear reaching
// the critter costs a life, and nothing else.
//
// specs/instrumentation.md gives the gate exactly that scope: "Whether a bear
// reaching the critter costs a life. The bears still sense, route, travel, and
// draw." Every gate is "on at a fresh start, is restored to on by `reset`, and is
// reported by `snapshot`". specs/hunter.md fixes the catch the gate holds off: a
// bear catches the critter "when the straight-line distance between their centers
// ... is at most `BEAR_CATCH_DIST` (`18`) stage units", and specs/progression.md
// fixes what that costs — "`lives` drops by exactly one, `phase` becomes `dying`".
//
// WITHOUT IT A BEAR CANNOT BE POSED WHERE A CHECK NEEDS ONE. `startCrossing` shuts
// this gate so that a bear posed on or beside the critter — which half the hunter
// checks need, to read where it routes or how fast it travels — does not end the
// scenario with a death nobody asked for. That makes the gate load-bearing, and a
// gate the suite leans on has to be known to work before anything leaning on it
// means anything.
//
// SO ONE SCENARIO IS RUN TWICE, ONCE EACH SIDE OF THE GATE, AND NOTHING ELSE MOVES
// BETWEEN THEM. The bear is settled on the critter's own tile, so their centers
// are the same point and the distance between them is `0` — as far inside
// `BEAR_CATCH_DIST` as the strait allows, so nothing here rests on where the catch
// radius ends. `hunter/catches` and `hunter/no-catch-beyond-range` decide that.
// One direction alone would be half the requirement: a build that never catches at
// all passes the first reading and fails the second, and a build that ignores the
// gate fails the first and passes the second, so the pair names which.
//
// THE BEAR IS POSED WITH ALL THREE FACULTIES OFF. It is not asked to find the
// critter, to choose a step, or to travel: the requirement is what happens when a
// bear IS on the critter, so the bear is put there and held there, and a build
// whose routing or travel is broken is graded on those by the hunter checks rather
// than here.
//
// THE LIVES ARE POSED AWAY FROM THE START, at `2` rather than `START_LIVES` (`3`),
// so the held reading is of the lives this scenario put on the strait and the cost
// reads `1` — a figure neither a reset nor an untouched run produces.

import { afterEach, beforeEach, it } from "vitest";
import { BEAR_CATCH_DIST } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { requireBear } from "./roster";

/** The tile both bodies are posed on: solid ice, well clear of every edge. */
const MEETING_COL = 17;
const MEETING_ROW = 14;

/** The lives posed on the run: away from `START_LIVES`, so a reset shows. */
const POSED_LIVES = 2;

/** The game time the held half runs for, in seconds: the item's figure. */
const HELD_SECONDS = 1;

/**
 * The game time the open half is given, in seconds.
 *
 * A quarter of a second. specs/hunter.md makes the catch a reading taken while the
 * two centers are within range, which they are from the first tick, so this is
 * thirty ticks of allowance on a reading one tick can take. It is well inside
 * `DEATH_PAUSE` (`0.9` s), so the phase read at the end is still the `dying` the
 * death set rather than whatever follows the hold.
 */
const OPEN_SECONDS = 0.25;

/** The straight-line distance between two centers, in stage units. */
function centreDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life with the catch test off and one life with it on", async () => {
  // `startCrossing` leaves the gate off, which is the first half's arrangement.
  startCrossing(h);
  h.debug.setLives(POSED_LIVES);
  h.debug.setCritterTile(MEETING_COL, MEETING_ROW);
  // Only the bear's presence is exercised here, so all three faculties are held
  // off and it stays exactly where the pose put it.
  const bear = poseBear(h, MEETING_COL, MEETING_ROW, {
    sense: false,
    routing: false,
    travel: false,
  });

  const posed = h.snapshot();
  assertEqual(
    posed.catchTest,
    false,
    "snapshot().catchTest after setCatchTest(false), which every gate reports " +
      "(specs/instrumentation.md)",
  );
  assertLessThanOrEqual(
    centreDistance(posed.critter, requireBear(posed, bear, "the posed catch")),
    BEAR_CATCH_DIST,
    `the stage units between the two posed centers, against BEAR_CATCH_DIST ` +
      `(${BEAR_CATCH_DIST}), which specs/hunter.md makes the catch — this point ` +
      `cannot hold the gate to a catch the scenario never set up`,
  );

  const read = await captureReplay(h, "gate", async () => {
    await h.advance(ticksFor(HELD_SECONDS));
    const held = h.snapshot();

    h.debug.setCatchTest(true);
    const opened = h.snapshot();
    await h.advance(ticksFor(OPEN_SECONDS));
    return { held, opened, caught: h.snapshot() };
  });

  assertEqual(
    read.held.lives,
    POSED_LIVES,
    `the lives after ${HELD_SECONDS} s of game time with a bear on the ` +
      `critter's own center and setCatchTest(false) — the gate holds off the ` +
      `catch costing a life (specs/instrumentation.md)`,
  );
  assertEqual(
    read.held.phase,
    "crossing",
    `the phase after that second — a life lost would have made it "dying" ` +
      `(specs/progression.md)`,
  );

  assertEqual(
    read.opened.catchTest,
    true,
    "snapshot().catchTest after setCatchTest(true)",
  );
  assertEqual(
    read.caught.lives,
    POSED_LIVES - 1,
    `the lives after ${OPEN_SECONDS} s of the same scenario with the gate on, ` +
      `which specs/progression.md drops by exactly one on the tick the bear ` +
      `catches the critter`,
  );
  assertEqual(
    read.caught.phase,
    "dying",
    "the phase the catch left the crossing in (specs/progression.md)",
  );
});
