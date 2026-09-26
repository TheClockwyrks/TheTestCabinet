// foes/corruptor-gate — no corruptor appears below the level they begin at.
//
// specs/foes.md: "Corruptors begin at CORRUPTOR_FROM_LEVEL (5), and none appears
// at levels 1 through 4."
//
// The level watched is 4, the one immediately below the gate, as the review item
// states — the level a build with an off-by-one gate would let one through at.
//
// THE MOMENT A CORRUPTOR WOULD ENTER IS POSED, NOT WAITED FOR. specs/foes.md
// brings a corruptor in when the level's corruptor clock reaches 0, and
// `setSpawnTimer` (specs/instrumentation.md) poses the seconds left on that
// clock, so the clock is posed to run out inside the next update and that
// update runs. From level 5 that is exactly the moment a corruptor enters —
// `foes/corruptor-arrives` reads one arriving that way — and at level 4 it is
// the moment the gate has to hold. It is posed several times over, so a build
// whose gate holds the first expiry and lapses on a later one is caught as
// well, and nothing waits on the interval a clock is drawn to.
//
// The requirement IS the level's own spawning, so this is one of the few checks
// that turns `setFoeSpawning` back on. The glitch and dropper spawners run
// alongside it at this level — that is what `foeSpawning` gates — so the reading
// counts corruptors alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CORRUPTOR_FROM_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";
import { expireClock } from "./harness";

/** The level watched: the one below the gate. */
const LEVEL = CORRUPTOR_FROM_LEVEL - 1;

/** How many times the corruptor's clock is posed to run out. */
const EXPIRIES = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every corruptor off the board below the level they begin at", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);

  let peak = 0;
  for (let expiry = 1; expiry <= EXPIRIES; expiry += 1) {
    peak = Math.max(peak, await expireClock(h, "corruptor"));
  }
  captureStill(h, "gated");

  assertEqual(
    peak,
    0,
    `no corruptor joins the roster across ${EXPIRIES} expiries of the ` +
      `corruptor clock at level ${LEVEL}, below CORRUPTOR_FROM_LEVEL ` +
      `(${CORRUPTOR_FROM_LEVEL}); corruptors seen at once`,
  );
});
