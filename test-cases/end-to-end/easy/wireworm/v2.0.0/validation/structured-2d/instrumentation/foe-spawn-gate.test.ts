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
// THE MOMENT EACH SPAWNER WOULD ACT IS POSED, NOT WAITED FOR. specs/foes.md has
// each kind's entry or check happen when its clock reaches `0`, and
// `setSpawnTimer` poses the seconds left on each clock, so all three are posed
// to run out inside the next update. With the gate off, a clock "holds its
// value whenever it is not counting down ... while foe spawning is off"
// (specs/foes.md), so a second of play leaves the roster empty; with it on, the
// same posed clocks run out and the level's foes arrive on the next update.
// Nothing waits on the interval a clock is drawn to, so the point costs a second
// of updates whatever a build's pacing.
//
// THE ON HALF IS READ LOOSELY AND ON PURPOSE. It is asserted only that SOME foe
// arrived, because this point is about the gate. Which foe arrives when, how
// many share the board, and what draws a dropper in are
// `instrumentation/set-spawn-timer`, `foes/glitch-cap`,
// `foes/dropper-sparse-trigger` and their siblings.
//
// THE BOARD IS OTHERWISE EMPTY AND QUIET. `startPlaying` clears all four rosters
// and holds the worm entry and the cursor's contact off, so anything that turns
// up in the foe roster over the span came from the level's own spawning and from
// nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { CORRUPTOR_FROM_LEVEL } from "../constants";
import { assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  TICK_HZ,
  ticksFor,
  type FoeKind,
  type Harness,
} from "../harness";

/**
 * The level the gate is held at: `CORRUPTOR_FROM_LEVEL` (`5`), the first at
 * which all three of the specification's spawners are running.
 */
const LEVEL = CORRUPTOR_FROM_LEVEL;

/** The three kinds, each with a clock of its own (specs/foes.md). */
const KINDS: readonly FoeKind[] = ["glitch", "dropper", "corruptor"];

/**
 * The seconds each clock is posed at: half of one update's delta, so a clock
 * that is counting down reaches `0` inside the very next update.
 */
const DUE_SECONDS = 0.5 / TICK_HZ;

/** How long the gated board is played for, in seconds. */
const GATED_SECONDS = 1;

/**
 * How long the ungated board is given before a foe is expected, in seconds: a
 * tenth of a second, room for a build that acts on the update after its clock
 * crosses `0` rather than inside the one it crosses in.
 */
const UNGATED_SECONDS = 0.1;

/** Pose every kind's clock to run out inside the next update. */
function poseClocksDue(h: Harness): void {
  for (const kind of KINDS) h.debug.setSpawnTimer(kind, DUE_SECONDS);
}

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
  poseClocksDue(h);

  await h.advanceSeconds(GATED_SECONDS);
  // Before the assertions, so a failing gate still leaves the picture of the
  // level-5 board a foe joined.
  captureStill(h, "gated");

  assertLength(
    h.snapshot().foes,
    0,
    `the foes on a level-${LEVEL} board after ${GATED_SECONDS} s of play ` +
      `with setFoeSpawning(false) held and every spawner clock posed to run ` +
      `out on the next update (specs/instrumentation.md)`,
  );

  // And the control: the level really would have spawned one.
  h.debug.setFoeSpawning(true);
  poseClocksDue(h);
  const arrived = await h.until((s) => s.foes.length > 0, {
    maxFrames: ticksFor(UNGATED_SECONDS),
  });
  assertTrue(
    arrived.hit,
    `a foe to join the roster within ${UNGATED_SECONDS} s of ` +
      `setFoeSpawning(true) with every spawner clock posed to run out on the ` +
      `same level-${LEVEL} board — without one, an empty roster while the ` +
      `gate was off says nothing about the gate`,
  );
});
