// Wireworm — instrumentation/foe-spawn-gate: with the level's own foe spawning
// gated off, no foe joins the roster; with it on, one does.
//
// specs/instrumentation.md gives the gate exactly one faculty:
// `setFoeSpawning(enabled)` gates "The level's own spawning of foes: the
// glitch's paced arrival, the corruptor's, and the dropper's sparse-field check.
// Off, no foe appears unless one is added."
//
// WITHOUT IT, HALF THIS SUITE IS INVADED. `startPlaying` poses an EMPTY board,
// which is the sparsest a field can be, and specs/foes.md draws a dropper in
// whenever the nodes standing in rows `10` to `19` number fewer than
// `DROPPER_SPARSE_THRESHOLD` (`8`), checked every `DROPPER_CHECK_INTERVAL`
// (`2.5` s) from `DROPPER_FROM_LEVEL` (`3`); a glitch arrives every
// `GLITCH_MIN_INTERVAL`–`GLITCH_MAX_INTERVAL` (`7`–`12` s) from level `2`; and a
// corruptor every `CORRUPTOR_MIN_INTERVAL`–`CORRUPTOR_MAX_INTERVAL`
// (`14`–`22` s) from level `5`. So every point that runs above level 1 for more
// than a couple of seconds depends on this gate holding, and this point is where
// it is decided.
//
// THE LEVEL IS 5 BECAUSE THAT IS WHERE ALL THREE SPAWNERS ARE RUNNING. At level
// 5 the glitch, the dropper and the corruptor are all past their first level, so
// the off half holds every one of them and the on half is satisfied by whichever
// of them arrives first.
//
// A MINUTE IS LONGER THAN ANY OF THE INTERVALS. `CORRUPTOR_MAX_INTERVAL` (`22`
// s) is the longest wait the specification names, so `60` s of play is nearly
// three of them: a build whose gate merely delays a spawner rather than holding
// it is caught, and a build whose gate works reports an empty roster whatever
// its intervals are.
//
// THE ON HALF IS READ LOOSELY AND ON PURPOSE. It is asserted only that SOME foe
// arrived, inside a window past every interval the specification names, because
// this point is about the gate. Which foe arrives when, how many share the
// board, and what draws a dropper in are `foes/glitch-arrives`, `foes/glitch-
// cap`, `foes/dropper-sparse-trigger` and their siblings.
//
// THE BOARD IS OTHERWISE EMPTY AND QUIET. `startPlaying` clears all four rosters
// and holds the worm entry and the cursor's contact off, so anything that turns
// up in the foe roster over the span came from the level's own spawning and from
// nothing else.

import { afterEach, beforeEach, it } from "vitest";
import {
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  DROPPER_CHECK_INTERVAL,
  GLITCH_MAX_INTERVAL,
} from "../constants";
import { assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The level the gate is held at: `CORRUPTOR_FROM_LEVEL` (`5`), the first at
 * which all three of the specification's spawners are running.
 */
const LEVEL = CORRUPTOR_FROM_LEVEL;

/** How long the gated board is played for, in seconds. */
const GATED_SECONDS = 60;

/**
 * How long the ungated board is given to produce a foe, in seconds.
 *
 * `CORRUPTOR_MAX_INTERVAL` (`22` s) is the longest wait specs/foes.md names for
 * any spawner, and the dropper's sparse-field check runs every
 * `DROPPER_CHECK_INTERVAL` (`2.5` s) on a board this empty — so this window is
 * past every one of them with room to spare, and a build whose spawning works
 * at all fills the roster well inside it.
 */
const UNGATED_SECONDS = CORRUPTOR_MAX_INTERVAL + 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the level's own foes away while the gate is off", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(false);

  await h.advanceSeconds(GATED_SECONDS);
  // Before the assertions, so a failing gate still leaves the picture of the
  // level-5 board a foe joined.
  captureStill(h, "gated");

  assertLength(
    h.snapshot().foes,
    0,
    `the foes on a level-${LEVEL} board after ${GATED_SECONDS} s of play ` +
      `with setFoeSpawning(false) held — that span is nearly three ` +
      `CORRUPTOR_MAX_INTERVALs (${CORRUPTOR_MAX_INTERVAL} s), past ` +
      `GLITCH_MAX_INTERVAL (${GLITCH_MAX_INTERVAL} s) many times over, and ` +
      `${Math.floor(GATED_SECONDS / DROPPER_CHECK_INTERVAL)} sparse-field ` +
      `checks (specs/foes.md)`,
  );

  // And the control: the level really would have spawned one.
  h.debug.setFoeSpawning(true);
  const arrived = await h.until((s) => s.foes.length > 0, {
    maxFrames: ticksFor(UNGATED_SECONDS),
  });
  assertTrue(
    arrived.hit,
    `a foe to join the roster within ${UNGATED_SECONDS} s of ` +
      `setFoeSpawning(true) on the same level-${LEVEL} board — without one, ` +
      `an empty roster while the gate was off says nothing about the gate`,
  );
});
