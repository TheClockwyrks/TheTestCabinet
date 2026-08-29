// scoring/plankton — a plankton is worth SCORE_PLANKTON, and it leaves the board.
//
// `specs/gameplay.md`: "The forager eats the plankton on its own tile, the moment
// its center enters that tile. Eating takes the plankton off the board, lowers
// `planktonRemaining` by one, and adds to the score." `specs/progression.md`'s
// table fixes what it adds: `SCORE_PLANKTON` (`10`), and "It rises by the exact
// figure above and by nothing else."
//
// THREE READINGS, ONE BITE. The score rises by exactly ten, the remaining count
// falls by exactly one, and the tile is empty afterwards. The third is what stops
// a build passing on a pellet it scored but never took off the board, and it
// cannot be read out of `snapshot()` — nothing reports where the plankton are — so
// it is read the way a player would: the forager backs off the tile and swims onto
// it again. A pellet still there would score a second time.
//
// THE BOARD IS POSED AND STRIPPED TO ONE PELLET ON THE RUN. A maze carries a
// plankton on every corridor tile, so a forager swimming four tiles eats four and
// no single bite can be told from its neighbours. `setPlankton`
// (`specs/instrumentation.md`) takes the others off the run — which "is not eating
// it, so it scores nothing and clears no maze" — leaving exactly one pellet in the
// forager's path, on the tile at the far end of it. The fixture's own sealed
// larder keeps `planktonRemaining` above zero throughout, so no bite here can
// clear the maze and descend under the measurement.
//
// THE PELLET IS AT A DEAD END, so the forager comes to rest on the very tile it
// ate from and stays there while the reading is taken.

import { afterEach, beforeEach } from "vitest";
import { assertEqual } from "../assert";
import { ARROW_KEY, SCORE_PLANKTON } from "../constants";
import { placeForager, poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  ticks,
  type Harness,
  startPlaying,
} from "../harness";
import {
  check,
  denAll,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
} from "../scene";

/**
 * The board: five tiles of straight corridor, the forager resting on the first
 * and the one pellet this point measures on the last, which is a dead end.
 */
const ART = ["S...T"] as const;

/**
 * How long a single bite may take under a held key, in ticks.
 *
 * The pellet is four tiles (`4 * TILE`, 128 units) along the run, which
 * `FORAGER_SPEED` (128 units per second, `specs/movement.md`) covers in one
 * second. Two seconds is a HARD ceiling with room for a build that starts a beat
 * late, and a build slower than that fails here rather than leaving the point
 * undecided.
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
 * Ticks the forager swims back onto the eaten tile.
 *
 * Four tiles' worth against a two-tile retreat, so the forager is standing at the
 * dead end again however the retreat rounded, and pinned there by the rock beyond.
 */
const RETURN_TICKS = ticks(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

check(
  "scores SCORE_PLANKTON for a plankton and takes it off the board",
  async () => {
    await startPlaying(h);
    const board = await poseMaze(h, ART);
    const start = board.mark("S");
    const target = board.mark("T");
    await placeForager(h, start, "right");
    // Every tile of the run but the target loses its pellet, so the bite the point
    // measures is the only one the swim can take.
    for (let tx = start.tx; tx < target.tx; tx += 1) {
      await h.debug.setPlankton(tx, start.ty, false);
    }
    const quiet = await denAll(h);
    // The forager is this point's subject and is meant to travel, so the guard
    // watches everything but where it stands.
    const guard = await sceneGuard(h, quiet, { foragerParked: false });

    const bite = await captureReplay(h, "eat", async () => {
      const before = await h.snapshot();
      await h.hold(ARROW_KEY.right);
      const eaten = await h.until(
        (s) => s.planktonRemaining < before.planktonRemaining,
        { maxTicks: BITE_BUDGET, poll: 1 },
      );
      const after = eaten.snapshot;
      // Off the tile and back onto it, under the game's own movement code: a pellet
      // the build scored but left on the board is eaten a second time here.
      await h.release(ARROW_KEY.right);
      await h.hold(ARROW_KEY.left);
      await h.advance(BACK_TICKS);
      await h.release(ARROW_KEY.left);
      await h.hold(ARROW_KEY.right);
      await h.advance(RETURN_TICKS);
      await h.release(ARROW_KEY.right);
      return { before, after, revisited: await h.snapshot(), hit: eaten.hit };
    });

    requireSceneHeld(bite.revisited, guard);
    if (!bite.hit) {
      requireSwim(
        bite.before.forager,
        bite.after.forager,
        "reach the plankton ahead of it",
      );
    }

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
  },
);
