// foes/glitch-gate — no glitch appears at level 1.
//
// specs/foes.md: "Glitches begin at GLITCH_FROM_LEVEL (2), and none appears at
// level 1." The gate is the level's own spawning, so the check turns
// `setFoeSpawning` back ON — this item's requirement IS that faculty.
//
// THE MOMENT A GLITCH WOULD ENTER IS POSED, NOT WAITED FOR. specs/foes.md brings
// a glitch in when the level's glitch clock reaches 0, and `setSpawnTimer`
// (specs/instrumentation.md) poses the seconds left on that clock, so the clock
// is posed to run out inside the next update and that update runs. From level 2
// that is exactly the moment a glitch enters — `instrumentation/set-spawn-timer`
// reads one arriving that way — and at level 1 it is the moment the gate has to
// hold. It is posed several times over, so a build whose gate holds the first
// expiry and lapses on a later one is caught as well, and nothing waits on the
// interval a clock is drawn to.
//
// Nothing else is posed. The board `startPlaying` leaves is empty and quiet, so
// the only thing that can put a glitch on it is the spawner this check turned
// on, and the reading is the most glitches the roster ever held.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_FROM_LEVEL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { expireClock } from "./harness";

/** The level watched: the one below the gate. */
const LEVEL = GLITCH_FROM_LEVEL - 1;

/** How many times the glitch's clock is posed to run out. */
const EXPIRIES = 5;

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

  let peak = 0;
  for (let expiry = 1; expiry <= EXPIRIES; expiry += 1) {
    peak = Math.max(peak, await expireClock(h, "glitch"));
  }
  captureStill(h, "gated");

  assertEqual(
    peak,
    0,
    `no glitch joins the roster across ${EXPIRIES} expiries of the glitch ` +
      `clock at level ${LEVEL}, below GLITCH_FROM_LEVEL (${GLITCH_FROM_LEVEL}); ` +
      `glitches seen at once`,
  );
});
