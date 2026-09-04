// foes/corruptor-gate — no corruptor appears below the level they begin at.
//
// specs/foes.md: "Corruptors begin at CORRUPTOR_FROM_LEVEL (5), and none appears
// at levels 1 through 4."
//
// The level watched is 4, the one immediately below the gate, as the review item
// states — the level a build with an off-by-one gate would let one through at.
// It is watched for a minute, which is nearly three CORRUPTOR_MAX_INTERVALs, so
// a corruptor that was going to enter has had every chance to.
//
// The requirement IS the level's own spawning, so this is one of the few checks
// that turns `setFoeSpawning` back on. The glitch and dropper spawners run
// alongside it at this level — that is what `foeSpawning` gates — so the reading
// counts corruptors alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
} from "../../src/constants";
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
const LEVEL = CORRUPTOR_FROM_LEVEL - 1;

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

it("keeps every corruptor off the board below the level they begin at", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);

  const watch = await watchRoster(
    h,
    "corruptor",
    ticksFor(WATCH_SECONDS),
    POLL_FRAMES,
  );
  captureStill(h, "gated");

  assertEqual(
    watch.peak,
    0,
    `no corruptor joins the roster over ${WATCH_SECONDS} s of level-${LEVEL} ` +
      `play, which is nearly three CORRUPTOR_MAX_INTERVALs ` +
      `(${CORRUPTOR_MAX_INTERVAL} s); corruptors seen at once`,
  );
});
