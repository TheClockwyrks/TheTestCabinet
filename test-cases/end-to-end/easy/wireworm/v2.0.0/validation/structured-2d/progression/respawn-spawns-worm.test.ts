// progression/respawn-spawns-worm — the level's worm enters afresh as the
// respawn ends.
//
// specs/progression.md, Losing a life: when the respawn timer runs out, the
// phase becomes `active` and the level's worm enters afresh AT THE LEVEL'S OWN
// LENGTH. specs/worm.md fixes that length as
// `WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1)`, which is what
// `wormLength` in `../constants` computes.
//
// THE LEVEL IS NOT 1, DELIBERATELY. At level `1` the level's own length is the
// base length, so a build that always enters a ten-segment worm would answer
// correctly by accident. The respawn is posed at a later level, where the
// level's length and the base length are different numbers, and only a build
// that entered the LEVEL'S worm reads the longer one.
//
// THE RESPAWN IS POSED, NOT DRIVEN. The requirement is what the END of a respawn
// puts on the board, so the respawn is posed with the two atomic operations that
// name it, on the empty, quiet board `startPlaying` leaves behind. The one world
// gate turned back on is `wormEntry`, because the level's and the respawn's worm
// entry IS the faculty this point is about (specs/instrumentation.md,
// setWormEntry); foe spawning and the cursor's contact test stay off, so nothing
// else arrives and nothing can cost a life while the timer runs.

import { afterEach, beforeEach, it } from "vitest";
import { RESPAWN_TIME, wormLength } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The level the respawn is posed at. `3` carries a worm of
 * `10 + 2 * 2 = 14` segments (specs/worm.md), four longer than the base length,
 * so a build entering a base-length worm at every level is told apart from one
 * entering the level's.
 */
const LEVEL = 3;

/**
 * How long past `RESPAWN_TIME` the worm is given to arrive, in seconds. Half a
 * second — thirty-odd frames of slack on a `1.4` s timer, so a build integrating
 * the countdown slightly differently is not failed for the last frame of it.
 */
const RESPAWN_GRACE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings in one worm of the level's length once the respawn ends", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setReachedLevel(LEVEL);
  h.debug.setWormEntry(true);
  h.debug.setPhase("respawn");
  h.debug.setPhaseTimer(RESPAWN_TIME);

  const entered = await h.until((snapshot) => snapshot.worms.length > 0, {
    maxFrames: ticksFor(RESPAWN_TIME + RESPAWN_GRACE),
  });
  captureStill(h, "entered");

  assertEqual(
    entered.hit,
    true,
    `a worm entering within ${RESPAWN_TIME + RESPAWN_GRACE} s of the respawn ` +
      `being posed`,
  );
  assertLength(entered.snapshot.worms, 1, "worms the respawn brought in");
  assertLength(
    entered.snapshot.worms[0]?.segments ?? [],
    wormLength(LEVEL),
    `segments the level ${LEVEL} worm enters with`,
  );
});
