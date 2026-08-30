// foes/corruptor-gate — no corruptor appears below the level they begin at.
//
// `specs/foes.md`: "Corruptors begin at CORRUPTOR_FROM_LEVEL (5), and none
// appears at levels 1 through 4."
//
// The level watched is `4`, the one immediately below the gate, as the review
// item states — the level a build with an off-by-one gate lets one through at,
// and the only one of the four that separates that build from a correct one. It
// is watched for a minute, which is nearly three CORRUPTOR_MAX_INTERVALs, so a
// corruptor that was ever going to enter has been overdue twice over.
//
// The gate is a faculty of the LEVEL rather than of any entity, so this is one
// of the few points that turns `setFoeSpawning` back on: the requirement it
// decides IS that faculty. The glitch and dropper spawners run alongside it at
// this level — that is what `foeSpawning` gates — so the reading counts
// CORRUPTORS alone, sampled throughout rather than once at the end, so a
// corruptor that entered and crossed off the far edge inside the minute is still
// caught.

import { afterEach, beforeEach, it } from "vitest";
import { CORRUPTOR_FROM_LEVEL, CORRUPTOR_MAX_INTERVAL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { watchRoster } from "./watching";

/** The level watched: the one immediately below the gate. */
const LEVEL = CORRUPTOR_FROM_LEVEL - 1;

/** The stretch of play watched, as the review item states it: one minute. */
const WATCH_SECONDS = 60;

/**
 * How often the roster is read, in seconds.
 *
 * A corruptor crosses the board's full `1280` units at `CORRUPTOR_SPEED`
 * (`130`), which takes nearly ten seconds, and one entering at an edge is on the
 * board for all of it. A half-second sample cannot step over one.
 */
const POLL_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("keeps every corruptor off the board below the level they begin at", async () => {
  await startPlaying(h, { level: LEVEL });
  await h.debug.setFoeSpawning(true);

  const watch = await watchRoster(h, "corruptor", WATCH_SECONDS, POLL_SECONDS);

  await captureStill(h, "gated");
  assertEqual(
    watch.peak,
    0,
    `no corruptor joins the roster over ${WATCH_SECONDS} s of level-` +
      `${LEVEL} play, which is nearly three CORRUPTOR_MAX_INTERVALs ` +
      `(${CORRUPTOR_MAX_INTERVAL} s); corruptors seen on the board at once`,
  );
});
