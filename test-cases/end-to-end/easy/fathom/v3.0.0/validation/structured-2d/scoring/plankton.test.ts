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
// it is read the way a player would: the forager backs off the tile and travels
// onto it again. A pellet still there would score a second time.
//
// THE BOARD IS POSED AND STRIPPED TO ONE PELLET ON THE RUN. A maze carries a
// plankton on every corridor tile, so a forager travelling four tiles eats four
// and no single bite can be told from its neighbours. `setPlankton`
// (specs/instrumentation.md) takes the others off the run — which "is not eating
// it, so it scores nothing and clears no maze" — leaving exactly one pellet in the
// forager's path, on the tile at the far end of it. The fixture's own sealed
// larder keeps `planktonRemaining` above zero throughout, so no bite here can
// clear the maze and descend under the measurement.
//
// THE PELLET IS AT A DEAD END, so the forager comes to rest on the very tile it
// ate from and stays there while the reading is taken.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_PLANKTON } from "../../src/constants";
import { assertEqual } from "../assert";
import { placeForager, poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

/**
 * The board: five tiles of straight corridor with the forager resting on the
 * first and the pellet this point measures a bite of on the last, and — across
 * solid rock — a sealed pocket holding the spare that keeps the maze from
 * clearing when that bite is taken.
 */
const ART = ["S...T", "", "Q"] as const;

/**
 * How long a single bite may take under a held action, in ticks.
 *
 * The pellet is four tiles (`4 * TILE`, 128 units) along the run, which
 * `FORAGER_SPEED` (128 units per second, specs/movement.md) covers in one second.
 * Two seconds is a HARD ceiling with room for a build that starts a beat late, and
 * a build slower than that fails here rather than leaving the point undecided.
 */
const BITE_BUDGET = ticksFor(2);

/**
 * Ticks the forager stands off the eaten tile before its center is put back into
 * it.
 *
 * Half a second, which is ample for a build that scores on the frame after the
 * entry rather than on it.
 */
const BACK_TICKS = ticksFor(0.5);

/**
 * Ticks the forager stands on the eaten tile the second time.
 *
 * A second, which is far longer than any build needs to eat a pellet its center
 * has entered, so a pellet still standing there would be taken.
 */
const RETURN_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Plankton score SCORE_PLANKTON each", async () => {
  startPlaying(h);
  const board = await poseMaze(h, ART);
  const start = board.mark("S");
  const target = board.mark("T");
  const spare = board.mark("Q");
  await placeForager(h, start, "right");
  // Two pellets on the whole board: the one this point measures a bite of, and a
  // spare well clear of it so that eating the first is not the mouthful that
  // leaves none behind and clears the maze (specs/gameplay.md).
  h.debug.setPlankton(target.tx, target.ty, true);
  h.debug.setPlankton(spare.tx, spare.ty, true);
  // The forager is moved by this point, so the guard watches everything but where
  // it stands.
  const guard = await sceneGuard(h, { foragerParked: false });

  const bite = await captureReplay(h, "eat", async () => {
    const before = h.snapshot();
    // Carried onto the pellet rather than driven onto it: specs/gameplay.md eats
    // "the plankton on its own tile, the moment its center enters that tile", and
    // whether a held action carries the forager anywhere is the movement points'
    // subject rather than this one's.
    h.debug.setForagerTile(target.tx, target.ty);
    const eaten = await h.until(
      (s) => s.planktonRemaining < before.planktonRemaining,
      { maxFrames: BITE_BUDGET, poll: 1 },
    );
    const after = eaten.snapshot;
    // Off the tile and back onto it, its center entering that tile a second time:
    // a pellet the build scored but left on the board is eaten twice here.
    h.debug.setForagerTile(start.tx, start.ty);
    await h.advance(BACK_TICKS);
    h.debug.setForagerTile(target.tx, target.ty);
    await h.advance(RETURN_TICKS);
    return { before, after, revisited: h.snapshot(), hit: eaten.hit };
  });

  requireSceneHeld(bite.revisited, guard);
  assertEqual(
    bite.hit,
    true,
    `the forager ate the plankton it was stood on within ${BITE_BUDGET} ticks`,
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
    `the further score taken by travelling back onto tile ` +
      `(${target.tx}, ${target.ty}), which holds no plankton once it is eaten`,
  );
  assertEqual(
    bite.revisited.planktonRemaining,
    bite.after.planktonRemaining,
    "planktonRemaining after the forager returns to the eaten tile",
  );
});
