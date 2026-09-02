// scoring/plankton — a plankton is worth SCORE_PLANKTON, and it leaves the board.
//
// specs/gameplay.md: "The forager eats the plankton on its own tile, the moment
// its center enters that tile. Eating takes the plankton off the board, lowers
// `planktonRemaining` by one, and adds to the score." specs/progression.md's table
// fixes what it adds: `SCORE_PLANKTON` (`10`), and "It rises by the exact figure
// above and by nothing else."
//
// THREE READINGS, ONE BITE. The score rises by exactly ten, the remaining count
// falls by exactly one, and the tile is empty afterwards. The third is what stops
// a build passing on a pellet it scored but never took off the board, and it
// cannot be read out of `snapshot()` — nothing reports where the plankton are — so
// it is read the way a player would: the forager backs off the tile and swims onto
// it again. A pellet still there would score a second time.
//
// THE BOARD CARRIES ONE PELLET ON THE RUN, AND THREE THE FORAGER CANNOT REACH.
// `poseMaze` opens on a board `clearPlankton` emptied, so `setPlankton`
// (specs/instrumentation.md) lays exactly one pellet in the forager's path, on the
// tile at the far end of it, and no bite can be confused with a neighbour's. The
// three in the sealed pocket keep `planktonRemaining` above zero throughout, so
// the bite this point measures cannot also clear the maze and descend under the
// measurement.
//
// THE PELLET IS AT A DEAD END, so the forager comes to rest on the very tile it
// ate from and stays there while the reading is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_PLANKTON } from "../constants";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  DIR_KEY,
  requireForagerMotion,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

/**
 * The board: five tiles of straight corridor, the forager resting on the first
 * and the one pellet this point measures on the last, which is a dead end.
 */
const ART = ["S...T" + " ".repeat(8) + "K.."] as const;

/**
 * How many pellets stand in the fixture's sealed pocket, well clear of the run.
 *
 * Three tiles of corridor nothing joins to the run, so a plankton on each of them
 * is one the forager can never reach. They are what keeps `planktonRemaining`
 * above zero across the bite: eating the plankton that leaves none behind clears
 * the maze (specs/gameplay.md), which would descend and end the measurement.
 */
const POCKET_TILES = 3;

/**
 * How long a single bite may take under a held action, in ticks.
 *
 * The pellet is four tiles (`4 * TILE`, 128 units) along the run, which
 * `FORAGER_SPEED` (128 units per second, specs/movement.md) covers in one second.
 * Two seconds is a HARD ceiling with room for a build that starts a beat late, and
 * a build slower than that fails here rather than leaving the point undecided.
 */
const BITE_BUDGET = ticks(2);

/**
 * Ticks the forager backs away from the eaten tile before returning to it.
 *
 * Two tiles' worth at `FORAGER_SPEED`, which is far enough that the return is a
 * real entry into the tile rather than a wobble across its own center.
 */
const BACK_TICKS = ticks(0.5);

/**
 * Ticks the forager travels back onto the eaten tile, in ticks.
 *
 * Four tiles' worth against a two-tile retreat, so the forager is standing at the
 * dead end again however the retreat rounded, and pinned there by the rock beyond.
 */
const RETURN_TICKS = ticks(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Plankton score SCORE_PLANKTON each", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const start = board.mark("S");
  const target = board.mark("T");
  h.debug.setForagerTile(start.tx, start.ty);
  h.debug.setForagerDir("right");
  // One pellet on the run, at its far end, and three in the sealed pocket.
  const pocket = board.mark("K");
  h.debug.setPlankton(target.tx, target.ty, true);
  for (let step = 0; step < POCKET_TILES; step += 1) {
    h.debug.setPlankton(pocket.tx + step, pocket.ty, true);
  }
  // The forager is this point's subject and is meant to travel, so the guard
  // watches everything but where it stands.
  const watch = await sceneGuard(h, { foragerParked: false });

  const bite = await captureReplay(h, "eat", async () => {
    const before = h.snapshot();
    h.hold(DIR_KEY.right);
    const eaten = await h.until(
      (s) => s.planktonRemaining < before.planktonRemaining,
      { maxFrames: BITE_BUDGET, poll: 1 },
    );
    const after = eaten.snapshot;
    // Off the tile and back onto it, under the game's own movement code: a
    // pellet the build scored but left on the board is eaten a second time here.
    h.release(DIR_KEY.right);
    h.hold(DIR_KEY.left);
    await h.advance(BACK_TICKS);
    h.release(DIR_KEY.left);
    h.hold(DIR_KEY.right);
    await h.advance(RETURN_TICKS);
    h.release(DIR_KEY.right);
    return { before, after, revisited: h.snapshot(), hit: eaten.hit };
  });

  requireSceneHeld(bite.revisited, watch);
  requireForagerMotion(
    bite.before,
    bite.after,
    "reach the plankton ahead of it",
  );
  assertEqual(
    bite.hit,
    true,
    `the forager reached the plankton four tiles along and ate it inside ` +
      `${BITE_BUDGET} ticks, which is the bite this point prices`,
  );

  assertEqual(
    bite.after.score - bite.before.score,
    SCORE_PLANKTON,
    `the score rise across the bite taken at tile (${target.tx}, ${target.ty})`,
  );
  assertEqual(
    bite.before.planktonRemaining - bite.after.planktonRemaining,
    1,
    "the fall in planktonRemaining across the bite",
  );
  assertEqual(
    bite.revisited.score - bite.after.score,
    0,
    `the further score taken by swimming back onto tile ` +
      `(${target.tx}, ${target.ty}), which holds no plankton once it is eaten`,
  );
  assertEqual(
    bite.revisited.planktonRemaining,
    bite.after.planktonRemaining,
    "planktonRemaining after the forager returns to the eaten tile",
  );
});
