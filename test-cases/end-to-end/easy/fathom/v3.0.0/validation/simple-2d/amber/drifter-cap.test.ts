// amber/drifter-cap — the maze holds no more than DRIFTER_MAX drifters.
//
// specs/gameplay.md: "The cadence tops the maze up to `DRIFTER_MAX` (`2`)
// drifters at once and stops there, so a maze already holding `DRIFTER_MAX` of
// them admits none until one is eaten." Two readings, and a build can break
// either alone: a ceiling that does not hold turns a maze left alone into a field
// of free bonuses, and a ceiling that never lifts stops the second amber light
// arriving for the rest of the dive however many the player eats.
//
// THE TWO DRIFTERS ARE SPAWNED RATHER THAN WAITED FOR. `spawnDrifter` adds one
// "whatever the cadence is doing and whatever the ceiling would otherwise allow"
// (specs/instrumentation.md), so the maze is standing at its ceiling in a couple
// of calls instead of fifty seconds. Both are spawned with their minds off, which
// holds each exactly where it was put while leaving it eaten by a forager that
// reaches it — so the one this check later eats is on a tile it chose, and neither
// can wander onto the forager and lift the ceiling by accident.
//
// THE STRETCH IS FAR LONGER THAN THE CADENCE. Two and a half intervals, so a build
// that admits on the cadence regardless of the ceiling has had two chances to do
// it, and the reading is taken at several points across the stretch rather than
// only at its end.
//
// THE BOARD IS THE GAME'S OWN, because the cadence runs on the maze the build laid
// out and its condition is that "plankton remain" there. The roster is taken off
// it, which specs/instrumentation.md's `clearPredators` does without touching the
// plankton: over the minute and a half this watches, a released hunter would
// otherwise reach the forager and end the dive under the measurement.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan } from "../assert";
import { DRIFTER_INTERVAL, DRIFTER_MAX } from "../constants";
import { spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { corridorTiles } from "../maze";
import { ticks } from "../harness";

/** How long the ceiling is watched, in intervals of the cadence. */
const WATCH_INTERVALS = 2.5;

/** Ticks of that watch, run off camera between readings. */
const WATCH_TICKS = ticks(DRIFTER_INTERVAL * WATCH_INTERVALS);

/** How many readings the watch is broken into. */
const CHECKPOINTS = 5;

/** Ticks allowed for the bite once the forager stands on a drifter's tile. */
const EAT_TICKS = ticks(0.25);

/** How long the admission after the bite is waited for, in ticks. */
const REFILL_TICKS = ticks(DRIFTER_INTERVAL + 4);

/** How often that wait reads, in ticks. */
const REFILL_POLL = 30;

/** Ticks of live play the clip carries once the maze is back at its ceiling. */
const CLIP_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("admits none while the maze holds DRIFTER_MAX, and one once it does not", async () => {
  const opened = await startPlaying(h);
  /** The tile the forager opens on, which it goes back to after the bite. */
  const home = { tx: opened.forager.tx, ty: opened.forager.ty };
  h.debug.clearPredators();
  h.debug.clearDrifters();
  assertGreaterThan(
    opened.planktonRemaining,
    0,
    "plankton left in the maze the cadence is timed on, which is the " +
      "condition specs/gameplay.md admits a drifter under",
  );

  // Two tiles well apart on the board the game laid out, so neither drifter is
  // standing where the forager already is.
  const corridors = corridorTiles(opened);
  assertGreaterThan(
    corridors.length,
    DRIFTER_MAX,
    "corridor tiles on the board to stand the ceiling's worth of drifters on",
  );
  const stands = [
    corridors[Math.floor(corridors.length / 3)],
    corridors[Math.floor((2 * corridors.length) / 3)],
  ];
  for (const tile of stands) {
    await spawnDrifter(h, tile, { mind: false });
  }
  assertEqual(
    h.snapshot().drifters.length,
    DRIFTER_MAX,
    "the drifters standing on the board before the ceiling is watched",
  );

  // The ceiling, watched across two and a half cadences.
  for (let checkpoint = 1; checkpoint <= CHECKPOINTS; checkpoint += 1) {
    await h.skip(Math.round(WATCH_TICKS / CHECKPOINTS));
    const seen = h.snapshot();
    assertEqual(
      seen.drifters.length,
      DRIFTER_MAX,
      "the drifters in the maze " +
        `${(seen.simTime - opened.simTime).toFixed(1)} s into a stretch of ` +
        `${String(WATCH_INTERVALS)} cadences, on a maze already holding ` +
        `DRIFTER_MAX (${String(DRIFTER_MAX)}) of them (specs/gameplay.md)`,
    );
  }

  // And the ceiling lifts on the bite. The drifter is held where it stands and
  // the forager put on its tile, which is the contact specs/gameplay.md defines.
  const eaten = h.snapshot().drifters[0];
  h.debug.setForagerTile(eaten.tx, eaten.ty);
  await h.advance(EAT_TICKS);
  assertEqual(
    h.snapshot().drifters.length,
    DRIFTER_MAX - 1,
    "the drifters left once the forager stood on one of their tiles",
  );
  // And back where it began, off the tile the bite was taken on. specs/gameplay.md
  // admits the next drifter "at the den gate", and a forager left standing there
  // would eat each admission on the tick it arrived — so the refill this point is
  // waiting for would never be seen however long it waited.
  h.debug.setForagerTile(home.tx, home.ty);

  const refilled = await captureReplay(h, "cap", async () => {
    const seen = await h.until((s) => s.drifters.length >= DRIFTER_MAX, {
      maxFrames: REFILL_TICKS,
      poll: REFILL_POLL,
    });
    await h.advance(CLIP_TICKS);
    return seen;
  });
  assertEqual(
    refilled.hit,
    true,
    `the maze was topped back up to DRIFTER_MAX (${String(DRIFTER_MAX)}) ` +
      `within one DRIFTER_INTERVAL (${String(DRIFTER_INTERVAL)} s) of one ` +
      "being eaten (specs/gameplay.md)",
  );
});
