// foes/glitch-cap — the board never holds more than two glitches at once.
//
// `specs/foes.md`: "At most GLITCH_MAX_ON_BOARD (2) glitches are on the board at
// once. While two are on it, no further glitch enters."
//
// A CAP ONLY SAYS ANYTHING WHERE IT BINDS, so this point makes it bind. Two
// glitches are posed and HELD on the board — their locomotion off, so neither
// descends off the bottom edge and the roster stands at the cap for the whole
// stretch — and the level's own spawning is then turned back on over it. A build
// that honours the cap adds none; a build that ignores it is caught by the peak
// the watch reports.
//
// THE HELD PAIR CARRY NOTHING BUT THEIR OCCUPANCY. Their minds are off as well
// as their travel: they are here to fill two places on the roster, and a glitch
// that ate its way through the board would be doing something this point does
// not name. `specs/instrumentation.md` gates each faculty on its own precisely
// so a scenario can pose one without the other.
//
// The level is `5`, as the review item states, so the spawner is running at full
// pace. The droppers and corruptors the level also brings in are read straight
// past: the count this point takes is of glitches alone.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_MAX_ON_BOARD } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { watchRoster } from "./watching";

/** The level watched, as the review item states it. */
const LEVEL = 5;

/** The stretch of play watched, as the review item states it: one minute. */
const WATCH_SECONDS = 60;

/**
 * How often the roster is read, in seconds. A glitch that entered would stand on
 * the board for over five seconds — it descends the board's height at
 * `GLITCH_V_SPEED` (`62`) — so a half-second sample cannot step over one.
 */
const POLL_SECONDS = 0.5;

/** Where the two held glitches stand: apart, and clear of the band. */
const HELD_TILES = [
  { c: 8, r: 8 },
  { c: 30, r: 9 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("admits no further glitch while the board is at the cap", async () => {
  await startPlaying(h, { level: LEVEL });
  for (const tile of HELD_TILES) {
    await poseFoe(h, "glitch", tile.c, tile.r, { mind: false, travel: false });
  }
  await h.debug.setFoeSpawning(true);

  const watch = await watchRoster(h, "glitch", WATCH_SECONDS, POLL_SECONDS);

  await captureStill(h, "cap");
  assertLessThanOrEqual(
    watch.peak,
    GLITCH_MAX_ON_BOARD,
    `at most GLITCH_MAX_ON_BOARD (${GLITCH_MAX_ON_BOARD}) glitches stand on ` +
      `the board at once over ${WATCH_SECONDS} s of level-${LEVEL} play, ` +
      `with ${HELD_TILES.length} of them held there throughout; the most ` +
      `seen at once`,
  );
});
