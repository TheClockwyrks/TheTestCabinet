// foes/glitch-cap — the board never holds more than two glitches at once.
//
// specs/foes.md: "At most GLITCH_MAX_ON_BOARD (2) glitches are on the board at
// once. While two are on it, no further glitch enters."
//
// A cap only says anything where it BINDS, so the check makes it bind: two
// glitches are posed on the board and held there with their locomotion off, so
// neither descends off the bottom edge and the board is at the cap throughout.
// Their minds are off too — they are here as occupancy, not as actors, and a
// glitch that ate or darted would be doing something this item does not name.
//
// THE ENTRY IS POSED, NOT WAITED FOR. specs/foes.md brings a glitch in when the
// level's glitch clock reaches 0 — "When a clock reaches 0 its kind's entry or
// check happens and the clock is drawn again" — and `setSpawnTimer`
// (specs/instrumentation.md) poses the seconds left on that clock. So the clock
// is posed to run out inside the next update, that update runs, and the roster
// is read: that is the moment the spawner would enter a third glitch, and the
// cap is what keeps it out. The moment is posed several times over, each a
// fresh expiry of the same clock, so a build whose cap holds once and lapses on
// a later entry is caught too. Nothing waits on the interval the clock is
// redrawn to, so the check costs a handful of updates whatever a build's pacing.
//
// The level is 5, as the review item states, so the spawner is running at full
// pace. The droppers and corruptors it also brings in at that level are read
// past: the reading counts glitches alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { GLITCH_MAX_ON_BOARD } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";
import { expireClock, foesOfKind, poseStillFoe } from "./harness";

/** The level watched, as the review item states it. */
const LEVEL = 5;

/** How many times the glitch's clock is posed to run out. */
const EXPIRIES = 5;

/** Where the two held glitches stand: apart, and clear of the band. */
const HELD_TILES = [
  { c: 8, r: 8 },
  { c: 30, r: 9 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("admits no further glitch while the board is at the cap", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  for (const tile of HELD_TILES) {
    const id = poseStillFoe(h, "glitch", tile.c, tile.r);
    h.debug.setFoeMind(id, false);
  }
  h.debug.setFoeSpawning(true);

  assertEqual(
    foesOfKind(h.snapshot(), "glitch").length,
    GLITCH_MAX_ON_BOARD,
    `precondition: the ${HELD_TILES.length} held glitches stand on the ` +
      `board, so the cap of GLITCH_MAX_ON_BOARD (${GLITCH_MAX_ON_BOARD}) binds`,
  );

  let peak = 0;
  for (let expiry = 1; expiry <= EXPIRIES; expiry += 1) {
    peak = Math.max(peak, await expireClock(h, "glitch"));
  }
  captureStill(h, "cap");

  assertLessThanOrEqual(
    peak,
    GLITCH_MAX_ON_BOARD,
    `at most GLITCH_MAX_ON_BOARD (${GLITCH_MAX_ON_BOARD}) glitches stand on ` +
      `the board at once across ${EXPIRIES} expiries of the level-${LEVEL} ` +
      `glitch clock, with ${HELD_TILES.length} of them held there ` +
      `throughout; the most seen at once`,
  );
});
