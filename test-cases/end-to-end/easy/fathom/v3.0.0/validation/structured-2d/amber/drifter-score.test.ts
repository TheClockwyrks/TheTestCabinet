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
// unchanged" a reading rather than an arithmetic accident. A posed board carries
// no plankton at all, so the count is `0` either side and nothing here can clear
// the maze.
//
// THE DRIFTER IS HELD STILL. A drifter wanders the whole maze at `DRIFTER_SPEED`,
// and one that turns off the posed run before the forager arrives leaves the point
// failing a build that scores drifters perfectly well. `setDrifterMind(0, false)`
// holds it "exactly where it stands" while everything else in the game carries on,
// and it is "still eaten by a forager whose tile it shares, and still worth the
// ordinary bonus" (specs/instrumentation.md) — so the bite is still the game's
// own, and the only thing removed is the gamble.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_DRIFTER } from "../constants";
import { assertEqual } from "../assert";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

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
  // One drifter on a board that holds nothing else, waiting exactly where it is
  // put: specs/gameplay.md has the forager eat "a drifter whose center lies on the
  // forager's own tile", so the bite is arranged by moving the forager's center
  // onto that tile rather than by driving it there. Whether a held action carries
  // the forager anywhere is the movement points' subject, not this one's.
  const at = { tx: run.start.tx + DRIFTER_AT, ty: run.start.ty };
  h.debug.spawnDrifter(at.tx, at.ty);
  h.debug.setDrifterMind(0, false);
  // The forager is moved by this point, so the guard watches everything but where
  // it stands.
  const guard = await sceneGuard(h, { foragerParked: false });

  const bite = await captureReplay(h, "score", async () => {
    const before = h.snapshot();
    h.debug.setForagerTile(at.tx, at.ty);
    const eaten = await h.until(
      (s) => s.drifters.length < before.drifters.length,
      { maxFrames: BITE_BUDGET, poll: 1 },
    );
    const after = eaten.snapshot;
    await h.advance(TAIL_TICKS);
    return { before, after, hit: eaten.hit };
  });

  requireSceneHeld(bite.after, guard);

  assertEqual(
    bite.before.drifters.length,
    1,
    "the bonus drifters on the board when the forager was stood on one",
  );
  assertEqual(
    bite.after.drifters.length,
    bite.before.drifters.length - 1,
    `the bonus drifters left within ${BITE_BUDGET} ticks of the forager being ` +
      "stood on the one it was posed at",
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
