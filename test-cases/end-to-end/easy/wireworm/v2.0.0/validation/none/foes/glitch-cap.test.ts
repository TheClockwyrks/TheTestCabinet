// foes/glitch-cap — the board never holds more than two glitches at once.
//
// `specs/foes.md`: "At most GLITCH_MAX_ON_BOARD (2) glitches are on the board at
// once. While two are on it, no further glitch enters."
//
// A CAP ONLY SAYS ANYTHING WHERE IT BINDS, so this point makes it bind. Two
// glitches are posed and HELD on the board — their locomotion off, so neither
// descends off the bottom edge and the roster stands at the cap throughout —
// and the level's own spawning is then turned back on over it. A build that
// honours the cap adds none; a build that ignores it is caught by the peak.
//
// THE HELD PAIR CARRY NOTHING BUT THEIR OCCUPANCY. Their minds are off as well
// as their travel: they are here to fill two places on the roster, and a glitch
// that ate its way through the board would be doing something this point does
// not name. `specs/instrumentation.md` gates each faculty on its own precisely
// so a scenario can pose one without the other.
//
// THE ENTRY IS POSED, NOT WAITED FOR. `specs/foes.md` brings a glitch in when
// the level's glitch clock reaches 0 — "When a clock reaches 0 its kind's entry
// or check happens and the clock is drawn again" — and `setSpawnTimer`
// (`specs/instrumentation.md`) poses the seconds left on that clock. So the
// clock is posed to run out inside the next update, that update runs, and the
// roster is read: that is the moment the spawner would enter a third glitch,
// and the cap is what keeps it out. The moment is posed several times over,
// each a fresh expiry of the same clock, so a build whose cap holds once and
// lapses on a later entry is caught too. Nothing waits on the interval the
// clock is redrawn to, so the point costs a handful of updates whatever a
// build's pacing.
//
// The level is `5`, as the review item states, so the spawner is running at full
// pace. The droppers and corruptors the level also brings in are read straight
// past: the count this point takes is of glitches alone.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_MAX_ON_BOARD } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  foesOfKind,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { expireClock } from "./watching";

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

afterEach(async () => {
  await h?.dispose();
});

it("admits no further glitch while the board is at the cap", async () => {
  await startPlaying(h, { level: LEVEL });
  for (const tile of HELD_TILES) {
    await poseFoe(h, "glitch", tile.c, tile.r, { mind: false, travel: false });
  }
  await h.debug.setFoeSpawning(true);

  assertEqual(
    foesOfKind(await h.snapshot(), "glitch").length,
    GLITCH_MAX_ON_BOARD,
    `precondition: the ${HELD_TILES.length} held glitches stand on the ` +
      `board, so the cap of GLITCH_MAX_ON_BOARD (${GLITCH_MAX_ON_BOARD}) binds`,
  );

  let peak = 0;
  for (let expiry = 1; expiry <= EXPIRIES; expiry += 1) {
    peak = Math.max(peak, await expireClock(h, "glitch"));
  }

  await captureStill(h, "cap");
  assertLessThanOrEqual(
    peak,
    GLITCH_MAX_ON_BOARD,
    `at most GLITCH_MAX_ON_BOARD (${GLITCH_MAX_ON_BOARD}) glitches stand on ` +
      `the board at once across ${EXPIRIES} expiries of the level-${LEVEL} ` +
      `glitch clock, with ${HELD_TILES.length} of them held there ` +
      `throughout; the most seen at once`,
  );
});
