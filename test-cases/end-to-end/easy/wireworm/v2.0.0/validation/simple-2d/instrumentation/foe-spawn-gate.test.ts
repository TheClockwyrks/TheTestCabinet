// Wireworm — instrumentation/foe-spawn-gate: `setFoeSpawning(false)` keeps the
// level's own foes away, and turning it back on lets them arrive.
//
// specs/instrumentation.md: "The level's own spawning of foes: the glitch's paced
// arrival, the corruptor's, and the dropper's sparse-field check. Off, no foe
// appears unless one is added."
//
// WHY THE SUITE RESTS ON IT. `startPlaying` opens every scenario in this project
// on an EMPTY board, which is the sparsest a board can be, and specs/foes.md
// draws a dropper in on the first `DROPPER_CHECK_INTERVAL` (`2.5` s) check
// whenever the nodes standing in rows `10`–`19` are below
// `DROPPER_SPARSE_THRESHOLD` (`8`). From level `2` a glitch arrives every
// `GLITCH_MIN_INTERVAL`–`GLITCH_MAX_INTERVAL` (`7`–`12` s) and from level `5` a
// corruptor every `CORRUPTOR_MIN_INTERVAL`–`CORRUPTOR_MAX_INTERVAL`
// (`14`–`22` s). Without this gate every scenario that runs above level 1 for more
// than a couple of seconds is joined by traffic it never asked for, so the gate
// is proved here before anything leans on it.
//
// LEVEL 5, because that is the level at which all three of specs/foes.md's
// spawners are open at once: a build that gated one of the three and not the
// others is caught by the same sweep.
//
// THE MOMENT EACH SPAWNER WOULD ACT IS POSED, NOT WAITED FOR. specs/foes.md has
// each kind's entry or check happen when its clock reaches `0`, and
// `setSpawnTimer` poses the seconds left on each clock, so all three are posed
// to run out inside the next update. With the gate off, a clock "holds its
// value whenever it is not counting down ... while foe spawning is off"
// (specs/foes.md), so a second of play leaves the roster empty; with it on, the
// same posed clocks run out and the level's foes arrive on the next update.
// Nothing waits on the interval a clock is drawn to, so the check costs a second
// of updates whatever a build's pacing. Worm entry stays off, so the level's own
// worm does not join a scenario that is about foes, and the cursor's contact
// test stays off, so nothing that does arrive can cost a life and empty the
// roster the sweep is reading.
//
// The two directions are two checks, so a build that gates nothing and a build
// that gates everything grade differently: the first fails the sweep with the
// gate off and the second fails the sweep with it on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  TICK_HZ,
  ticksFor,
  type FoeKind,
  type Harness,
} from "../harness";

/** The level at which all three of specs/foes.md's spawners are open. */
const LEVEL = 5;

/** The three kinds, each with a clock of its own (specs/foes.md). */
const KINDS: readonly FoeKind[] = ["glitch", "dropper", "corruptor"];

/**
 * The seconds each clock is posed at: half of one update's delta, so a clock
 * that is counting down reaches `0` inside the very next update.
 */
const DUE_SECONDS = 0.5 / TICK_HZ;

/** The second of play the gated board is left for, in frames. */
const GATED_TICKS = ticksFor(1);

/**
 * How long the ungated board is given before a foe is expected, in frames: a
 * tenth of a second, room for a build that acts on the update after its clock
 * crosses `0` rather than inside the one it crosses in.
 */
const ARRIVAL_TICKS = ticksFor(0.1);

/** Pose a quiet level-5 board in live play, with foe spawning as given. */
function openLevel(h: Harness, spawning: boolean): void {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(spawning);
}

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

it("lets no foe join the roster over a second with spawning off", async () => {
  openLevel(h, false);
  poseClocksDue(h);

  const swept = await h.until((s) => s.foes.length > 0, {
    maxFrames: GATED_TICKS,
    poll: 1,
  });
  // The level-5 board no foe joined.
  captureStill(h, "gated");

  assertEqual(
    swept.hit,
    false,
    "with setFoeSpawning(false) and every spawner clock posed to run out, no " +
      "foe joins the roster over a second of level-5 play " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    h.snapshot().foeSpawning,
    false,
    "the gate is still off at the end of the sweep",
  );
});

it("lets the level's foes arrive with spawning on", async () => {
  openLevel(h, true);
  poseClocksDue(h);

  const swept = await h.until((s) => s.foes.length > 0, {
    maxFrames: ARRIVAL_TICKS,
    poll: 1,
  });

  assertEqual(
    swept.hit,
    true,
    "with setFoeSpawning(true) and every spawner clock posed to run out, the " +
      "level's own spawners draw a foe in on the next update (specs/foes.md)",
  );
  assertGreaterThan(
    swept.snapshot.foes.length,
    0,
    "the roster the sweep found",
  );
});
