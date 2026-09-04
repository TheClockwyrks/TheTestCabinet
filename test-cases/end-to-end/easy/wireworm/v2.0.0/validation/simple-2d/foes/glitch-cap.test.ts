// foes/glitch-cap — the board never holds more than two glitches at once.
//
// specs/foes.md: "At most GLITCH_MAX_ON_BOARD (2) glitches are on the board at
// once. While two are on it, no further glitch enters."
//
// A cap only says anything where it BINDS, so the check makes it bind: two
// glitches are posed on the board and held there with their locomotion off, so
// neither descends off the bottom edge and the board is at the cap for the whole
// stretch. Their minds are off too — they are here as occupancy, not as actors,
// and a glitch that ate or darted would be doing something this item does not
// name. From there the level's own spawning is turned on (this item's
// requirement IS that faculty) and the roster is watched: a build that honours
// the cap adds none, and a build that ignores it is caught by the peak.
//
// The level is 5, as the review item states, so the spawner is running at full
// pace. The droppers and corruptors it also brings in at that level are read
// past: the reading counts glitches alone.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_MAX_ON_BOARD } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseStillFoe, watchRoster } from "./harness";

/** The level watched, as the review item states it. */
const LEVEL = 5;

/** The stretch of play watched, as the review item states it: one minute. */
const WATCH_SECONDS = 60;

/**
 * How often the roster is read. A glitch that entered would stand on the board
 * for seconds — it descends the height of the board at GLITCH_V_SPEED — so a
 * twentieth of a second cannot step over one.
 */
const POLL_FRAMES = ticksFor(0.05);

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
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  for (const tile of HELD_TILES) {
    const id = poseStillFoe(h, "glitch", tile.c, tile.r);
    h.debug.setFoeMind(id, false);
  }
  h.debug.setFoeSpawning(true);

  const watch = await watchRoster(
    h,
    "glitch",
    ticksFor(WATCH_SECONDS),
    POLL_FRAMES,
  );
  captureStill(h, "cap");

  assertLessThanOrEqual(
    watch.peak,
    GLITCH_MAX_ON_BOARD,
    `at most GLITCH_MAX_ON_BOARD (${GLITCH_MAX_ON_BOARD}) glitches stand on ` +
      `the board at once over ${WATCH_SECONDS} s of level-${LEVEL} play, ` +
      `with ${HELD_TILES.length} of them held there throughout; the most ` +
      `seen at once`,
  );
});
