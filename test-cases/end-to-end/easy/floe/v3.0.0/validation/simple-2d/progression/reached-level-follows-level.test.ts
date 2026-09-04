// progression/reached-level-follows-level — the level the game-over screen
// reports climbs with the level a run reaches.
//
// `specs/progression.md` makes `reachedLevel` the deepest level a run got to,
// and `specs/ui.md` has the game-over screen report it. A build that never moves
// it tells every player who dies on level six that they reached level one, which
// is the one number that screen exists to carry.
//
// THE ADVANCE IS A REAL ONE, taken by the hop that fills the level's last open
// bay and the `CLEAR_PAUSE` that follows it (`specs/bays.md`,
// `specs/progression.md`). A posed `setLevel` moves the level and nothing else
// (`specs/instrumentation.md` says so outright), so a check that posed the
// advance would be asking a build to answer a question no run ever asks it.
//
// THE TWO NUMBERS START EQUAL, which is what makes the reading decide anything:
// a run that has only ever been on level `3` reports `3` for both, so the
// assertion is that BOTH moved to `4` rather than that one of them happens to be
// there already.
//
// WHAT THIS DOES NOT DECIDE. That the level advances at all is
// `progression/level-advances`; that the game-over screen prints the figure is
// `progression/game-over-reports-level`. This point is the one field, across the
// one advance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BAY_COUNT, CLEAR_PAUSE } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { poseAtBayMouth, requestHop } from "./crossing";

/** The level the run is posed on, and the one the advance opens. */
const LEVEL = 3;

/** The one bay left open for the hop that clears the level. */
const OPEN_BAY = 2;

/**
 * How far past `CLEAR_PAUSE` the reading is taken, in seconds.
 *
 * A tenth of a second either way is the tolerance `progression/level-advances`
 * grades the hold's own length to; this point is about the FIELD rather than the
 * length, so it reads on the far side of that window and a build whose hold runs
 * a shade long is graded on its length there rather than failed here.
 */
const TOLERANCE = 0.1;

/** Whole frames that carry the clearing hold out, so the next level opens. */
const CLEAR_TICKS = ticksFor(CLEAR_PAUSE + TOLERANCE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the level reached with the level a real advance opens", async () => {
  startCrossing(h, LEVEL);
  h.debug.setReachedLevel(LEVEL);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    if (bay !== OPEN_BAY) h.debug.setBay(bay, true);
  }
  poseAtBayMouth(h, OPEN_BAY);

  const posed = h.snapshot();
  assertEqual(posed.level, LEVEL, `the run posed on level ${LEVEL}`);
  assertEqual(
    posed.reachedLevel,
    LEVEL,
    `with the level reached at ${LEVEL} as well, so both numbers have to move`,
  );

  const opened = await captureReplay(h, "advance", async () => {
    await requestHop(h, "up");
    await h.advance(CLEAR_TICKS);
    return h.snapshot();
  });

  assertEqual(
    opened.level,
    LEVEL + 1,
    `level ${LEVEL + 1} open once the clearing hold ran out ` +
      "(specs/progression.md)",
  );
  assertEqual(
    opened.reachedLevel,
    LEVEL + 1,
    `the level reached at ${LEVEL + 1}: it follows the deepest level the run ` +
      "got to (specs/progression.md)",
  );
});
