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
// THE LEVEL IS OPENED THE WAY A LEVEL OPENS. specs/foes.md times each spawner
// "from the moment the level's play becomes active", so the board is posed on the
// `banner` phase and the banner is allowed to run out, and the sweep starts from
// the transition the specification names rather than from a phase posed straight
// into `active`. Worm entry stays off, so the level's own worm does not join a
// scenario that is about foes, and the cursor's contact test stays off, so nothing
// that does arrive can cost a life and empty the roster the sweep is reading.
//
// The two directions are two checks, so a build that gates nothing and a build
// that gates everything grade differently: the first fails the sweep with the
// gate off and the second fails the sweep with it on.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The level at which all three of specs/foes.md's spawners are open. */
const LEVEL = 5;

/** The minute of play the item names, and how far the sweep may run. */
const MINUTE_TICKS = ticksFor(60);

/**
 * How long the gate-on sweep may run before a foe is expected.
 *
 * specs/foes.md checks the sparse field every `DROPPER_CHECK_INTERVAL` (`2.5` s)
 * and the board is empty, and the slowest of the three spawners is the corruptor
 * at `CORRUPTOR_MAX_INTERVAL` (`22` s). Thirty seconds is past every one of them.
 */
const ARRIVAL_TICKS = ticksFor(30);

/** Frames covering the banner, plus one so the transition has run. */
const BANNER_TICKS = ticksFor(BANNER_TIME) + 1;

/** How often the sweeps sample the roster: often enough to see a foe cross. */
const POLL = 12;

/** Pose a quiet level-5 board on its banner, with foe spawning as given. */
function openLevel(h: Harness, spawning: boolean): void {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(spawning);
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(BANNER_TIME);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lets no foe join the roster over a minute with spawning off", async () => {
  openLevel(h, false);

  await h.advance(BANNER_TICKS);
  assertEqual(
    h.snapshot().phase,
    "active",
    "the banner gives way to active play (specs/progression.md)",
  );

  const swept = await h.until((s) => s.foes.length > 0, {
    maxFrames: MINUTE_TICKS,
    poll: POLL,
  });
  // The level-5 board no foe joined.
  captureStill(h, "gated");

  assertEqual(
    swept.hit,
    false,
    "with setFoeSpawning(false) no foe joins the roster over a minute of " +
      "level-5 play (specs/instrumentation.md)",
  );
  assertEqual(
    h.snapshot().foeSpawning,
    false,
    "the gate is still off at the end of the sweep",
  );
});

it("lets the level's foes arrive with spawning on", async () => {
  openLevel(h, true);

  await h.advance(BANNER_TICKS);
  assertEqual(
    h.snapshot().phase,
    "active",
    "the banner gives way to active play (specs/progression.md)",
  );

  const swept = await h.until((s) => s.foes.length > 0, {
    maxFrames: ARRIVAL_TICKS,
    poll: 1,
  });

  assertEqual(
    swept.hit,
    true,
    "with setFoeSpawning(true) the level's own spawners draw a foe in " +
      "(specs/foes.md)",
  );
  assertGreaterThan(
    swept.snapshot.foes.length,
    0,
    "the roster the sweep found",
  );
});
