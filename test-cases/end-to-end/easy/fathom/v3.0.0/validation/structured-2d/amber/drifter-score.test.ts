// amber/drifter-score — eating a bonus drifter pays SCORE_DRIFTER, and nothing else.
//
// specs/gameplay.md: "The forager eats a drifter whose center lies on the
// forager's own tile, which takes it off the board and scores the bonus."
// specs/progression.md's table fixes the bonus at `SCORE_DRIFTER` (`200`), over a
// score that "rises by the exact figure above and by nothing else" — so the three
// readings are one sum, one list, and one count that must not move.
//
// THE RUN IS STRIPPED OF ITS PLANKTON. A maze carries a plankton on every corridor
// tile, so a forager travelling three tiles into a drifter grazes three on the way
// and the `200` arrives buried under `30`. `setPlankton` takes them off the run —
// "not eating it, so it scores nothing and clears no maze"
// (specs/instrumentation.md) — which is also what makes "planktonRemaining is
// unchanged" a reading rather than an arithmetic accident. The fixture's sealed
// larder keeps the count above zero, so the empty run cannot clear the maze.
//
// THE DRIFTER IS HELD STILL. A drifter wanders the whole maze at `DRIFTER_SPEED`,
// and one that turns off the posed run before the forager arrives leaves the point
// failing a build that scores drifters perfectly well. `setCreatureAI(false)`
// holds it "exactly where it stands" while everything else keeps running,
// "plankton and drifters are still eaten and still score" included
// (specs/instrumentation.md), so the forager still travels, the bite is still the
// game's own, and the only thing removed is the gamble.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_DRIFTER } from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  DIR_KEY,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { denAll, requireSwim, sceneGuard, sceneHeld } from "../scene";

/** Tiles of straight corridor posed as the whole board. */
const RUN = 6;

/** How far along that run the drifter waits, in tiles. */
const DRIFTER_AT = 3;

/**
 * How long the bite may take under a held action, in ticks.
 *
 * Three tiles (96 units) at `FORAGER_SPEED` (128 units per second,
 * specs/movement.md) is three quarters of a second. Two seconds is a HARD ceiling
 * with room for a build that starts a beat late, so a build merely too slow fails
 * here rather than leaving the point undecided.
 */
const BITE_BUDGET = ticksFor(2);

/** Ticks held past the reading, purely so the clip shows the forager travelling on. */
const TAIL_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Eating a drifter scores SCORE_DRIFTER", async () => {
  startPlaying(h);
  const run = await poseStraightRun(h, RUN);
  for (let step = 0; step < RUN; step += 1) {
    h.debug.setPlankton(run.start.tx + step, run.start.ty, false);
  }
  const quiet = await denAll(h);
  // The drifter waits exactly where it is put, and so does every denned hunter.
  h.debug.setCreatureAI(false);
  h.debug.spawnDrifter(run.start.tx + DRIFTER_AT, run.start.ty);
  // The forager is this point's subject and is meant to travel, so the guard
  // watches everything but where it stands.
  const guard = await sceneGuard(h, quiet, { foragerParked: false });

  const bite = await captureReplay(h, "score", async () => {
    const before = h.snapshot();
    h.hold(DIR_KEY.right);
    const eaten = await h.until(
      (s) => s.drifters.length < before.drifters.length,
      { maxFrames: BITE_BUDGET, poll: 1 },
    );
    const after = eaten.snapshot;
    await h.advance(TAIL_TICKS);
    h.release(DIR_KEY.right);
    return { before, after, hit: eaten.hit };
  });

  assertNull(sceneHeld(bite.after, guard), "the scenario held to the end");
  if (!bite.hit) {
    requireSwim(
      bite.before.forager,
      bite.after.forager,
      "reach the drifter waiting on the run ahead of it",
    );
  }

  assertEqual(
    bite.before.drifters.length,
    1,
    "the bonus drifters on the board when the swim began",
  );
  assertEqual(
    bite.after.drifters.length,
    bite.before.drifters.length - 1,
    "the bonus drifters left once the forager reached the one it was posed at",
  );
  assertEqual(
    bite.after.score - bite.before.score,
    SCORE_DRIFTER,
    "the score rise across the bite, on a run stripped of its plankton",
  );
  assertEqual(
    bite.after.planktonRemaining,
    bite.before.planktonRemaining,
    "planktonRemaining across the bite, which eating a drifter does not touch",
  );
});
