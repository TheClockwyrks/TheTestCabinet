// foes/glitch-gate — no glitch appears below the level glitches begin at.
//
// `specs/foes.md`: "Glitches begin at GLITCH_FROM_LEVEL (2), and none appears at
// level 1."
//
// The gate is a faculty of the LEVEL rather than of any entity — it is the
// level's own spawning — so this is one of the few points that turns
// `setFoeSpawning` back on: the requirement this point decides IS that faculty,
// and a check that left the gate shut would assert nothing. It is then left
// running over a minute of level-1 play, which is five GLITCH_MAX_INTERVALs, so
// a glitch that was ever going to enter has been overdue four times over.
//
// NOTHING ELSE IS POSED. The board `startPlaying` leaves is empty and quiet, and
// at level 1 the other two spawners are behind gates of their own, so the only
// thing that can put a glitch on this board is the spawner this point turned on.
// The reading is the most glitches the roster ever held, sampled throughout
// rather than once at the end, so a glitch that entered and descended off the
// bottom edge inside the minute is still caught.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_FROM_LEVEL, GLITCH_MAX_INTERVAL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { watchRoster } from "./watching";

/** The level watched: the one immediately below the gate. */
const LEVEL = GLITCH_FROM_LEVEL - 1;

/** The stretch of play watched, as the review item states it: one minute. */
const WATCH_SECONDS = 60;

/**
 * How often the roster is read, in seconds.
 *
 * A glitch enters on a row between `8` and `15` and descends at
 * `GLITCH_V_SPEED` (`62`), so the soonest one can cross the whole board and be
 * gone is over five seconds. A half-second sample cannot step over one.
 */
const POLL_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("keeps every glitch off the board below the level they begin at", async () => {
  await startPlaying(h, { level: LEVEL });
  await h.debug.setFoeSpawning(true);

  const watch = await watchRoster(h, "glitch", WATCH_SECONDS, POLL_SECONDS);

  await captureStill(h, "gated");
  assertEqual(
    watch.peak,
    0,
    `no glitch joins the roster over ${WATCH_SECONDS} s of level-${LEVEL} ` +
      `play, which is five GLITCH_MAX_INTERVALs (${GLITCH_MAX_INTERVAL} s); ` +
      `glitches seen on the board at once`,
  );
});
