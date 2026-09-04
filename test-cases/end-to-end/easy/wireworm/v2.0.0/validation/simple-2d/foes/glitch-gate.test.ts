// foes/glitch-gate — no glitch appears at level 1.
//
// specs/foes.md: "Glitches begin at GLITCH_FROM_LEVEL (2), and none appears at
// level 1." The gate is the level's own spawning, so the check turns
// `setFoeSpawning` back ON — this item's requirement IS that faculty — and
// leaves it running for a long stretch of level-1 play, far longer than the
// GLITCH_MAX_INTERVAL a glitch would otherwise be overdue by.
//
// Nothing else is posed. The board `startPlaying` leaves is empty and quiet, so
// the only thing that can put a glitch on it is the spawner this check turned
// on, and the reading is the most glitches the roster ever held.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_FROM_LEVEL, GLITCH_MAX_INTERVAL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { watchRoster } from "./harness";

/** The level watched: the one below the gate. */
const LEVEL = GLITCH_FROM_LEVEL - 1;

/** The stretch of play watched, as the review item states it: one minute. */
const WATCH_SECONDS = 60;

/** How often the roster is read: a twentieth of a second. */
const POLL_FRAMES = ticksFor(0.05);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every glitch off the board below the level they begin at", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);

  const watch = await watchRoster(
    h,
    "glitch",
    ticksFor(WATCH_SECONDS),
    POLL_FRAMES,
  );
  captureStill(h, "gated");

  assertEqual(
    watch.peak,
    0,
    `no glitch joins the roster over ${WATCH_SECONDS} s of level-${LEVEL} ` +
      `play, which is five GLITCH_MAX_INTERVALs (${GLITCH_MAX_INTERVAL} s); ` +
      `glitches seen at once`,
  );
});
