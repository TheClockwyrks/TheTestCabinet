// amber/drifter-score — eating a bonus drifter pays SCORE_DRIFTER, and nothing else.
//
// specs/gameplay.md: "The forager eats a drifter whose center lies on the
// forager's own tile, which takes it off the board and scores the bonus."
// specs/progression.md's table fixes the bonus at `SCORE_DRIFTER` (`200`), over a
// score that "rises by the exact figure above and by nothing else" — so the three
// readings are one sum, one list, and one count that must not move.
//
// THE RUN CARRIES NO PLANKTON. A maze carries a plankton on every corridor tile,
// so a forager travelling three tiles into a drifter would graze three on the way
// and the `200` would arrive buried under `30`. `poseStraightRun` poses its board
// on a world `clearPlankton` emptied, so the run is bare and the `200` stands
// alone. The pellets this check does lay out are the three in the fixture's SEALED
// pocket, which the forager can never reach: they are what makes
// "planktonRemaining is unchanged" a reading rather than an arithmetic accident.
//
// THE DRIFTER IS HELD STILL, AND IT IS THE ONLY BODY BESIDE THE FORAGER. A drifter
// wanders the whole maze at `DRIFTER_SPEED`, and one that turns off the posed run
// before the forager arrives leaves the point failing a build that scores drifters
// perfectly well. `setDrifterMind(0, false)` holds that one drifter "exactly where
// it stands" while everything else keeps running, "still eaten by a forager whose
// tile it shares, and still worth the ordinary bonus" (specs/instrumentation.md),
// so the forager still travels, the bite is still the game's own, and the only
// thing removed is the gamble.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_DRIFTER } from "../constants";
import { poseStraightRun, spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  DIR_KEY,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

/** Tiles of straight corridor posed as the whole board. */
const RUN = 6;

/**
 * How many pellets stand in the fixture's sealed pocket, well clear of the run.
 *
 * `poseStraightRun`'s `spare` pocket is three tiles of corridor nothing joins to
 * the run, so a plankton on each of them is one the forager can never reach: the
 * count they hold is what "planktonRemaining is unchanged" is read against.
 */
const POCKET_TILES = 3;

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
const BITE_BUDGET = ticks(2);

/** Ticks held past the reading, purely so the clip shows the forager swimming on. */
const TAIL_TICKS = ticks(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Eating a drifter scores SCORE_DRIFTER", async () => {
  await startPlaying(h);
  const run = await poseStraightRun(h, RUN, { spare: true });
  // The sealed pocket sits eight tiles past the end of the run, so these are the
  // pellets the forager can never reach.
  const pocket = run.start.tx + RUN + 8;
  for (let step = 0; step < POCKET_TILES; step += 1) {
    h.debug.setPlankton(pocket + step, run.start.ty, true);
  }
  await spawnDrifter(
    h,
    { tx: run.start.tx + DRIFTER_AT, ty: run.start.ty },
    {
      mind: false,
    },
  );
  // The drifter waits exactly where it is put.
  h.debug.setDrifterMind(0, false);
  // The forager is this point's subject and is meant to travel, so the guard
  // watches everything but where it stands.
  const watch = await sceneGuard(h, { foragerParked: false });

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

  requireSceneHeld(bite.after, watch);
  assertEqual(
    bite.hit,
    true,
    `the forager travelled the ${DRIFTER_AT} tiles to the drifter and ate it ` +
      "under a held action, inside the budget this check allows",
  );

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
    bite.before.planktonRemaining,
    POCKET_TILES,
    "the plankton standing in the sealed pocket when the swim began, which the " +
      "forager can never reach",
  );
  assertEqual(
    bite.after.planktonRemaining,
    bite.before.planktonRemaining,
    "planktonRemaining across the bite, which eating a drifter does not touch",
  );
});
