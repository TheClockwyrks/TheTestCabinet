// amber/drifter-score — eating a bonus drifter pays SCORE_DRIFTER, and nothing else.
//
// `specs/gameplay.md`: "The forager eats a drifter whose center lies on the
// forager's own tile, which takes it off the board and scores the bonus."
// `specs/progression.md`'s table fixes the bonus at `SCORE_DRIFTER` (`200`), over
// a score that "rises by the exact figure above and by nothing else" — so the
// three readings are one sum, one list, and one count that must not move.
//
// THE BOARD CARRIES NOTHING BUT THE DRIFTER. `poseMaze` empties it, so a forager
// swimming three tiles into the drifter grazes no plankton on the way and the
// `200` arrives on its own rather than buried under `30`. Nothing is eaten that
// was not the drifter, so no maze can clear under the measurement and no hunter
// can arrive during it.
//
// THE DRIFTER IS HELD STILL. A drifter wanders the whole maze at `DRIFTER_SPEED`,
// and one that turns off the posed run before the forager arrives leaves the point
// failing a build that scores drifters perfectly well. `setDrifterMind(index,
// false)` holds it "exactly where it stands" while it is "still eaten by a forager
// whose tile it shares, and still worth the ordinary bonus"
// (`specs/instrumentation.md`), so the forager still swims, the bite is still the
// game's own, and the only thing removed is the gamble.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ARROW_KEY, SCORE_DRIFTER } from "../constants";
import { poseStraightRun, spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  ticks,
  type Harness,
  startPlaying,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

/** Tiles of straight corridor posed as the whole board. */
const RUN = 6;

/** How far along that run the drifter waits, in tiles. */
const DRIFTER_AT = 3;

/**
 * How long the bite may take under a held key, in ticks.
 *
 * Three tiles (96 units) at `FORAGER_SPEED` (128 units per second,
 * `specs/movement.md`) is three quarters of a second. Two seconds is a HARD
 * ceiling with room for a build that starts a beat late, so a build merely too
 * slow fails here rather than leaving the point undecided.
 */
const BITE_BUDGET = ticks(2);

/** Ticks held past the reading, purely so the clip shows the forager swimming on. */
const TAIL_TICKS = ticks(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scores SCORE_DRIFTER for a bonus drifter and takes it off the board", async () => {
  await startPlaying(h);
  const run = await poseStraightRun(h, RUN);
  // The drifter waits exactly where it is put.
  await spawnDrifter(
    h,
    { tx: run.start.tx + DRIFTER_AT, ty: run.start.ty },
    { mind: false },
  );
  // The forager is this point's subject and is meant to travel, so the guard
  // watches everything but where it stands.
  const guard = await sceneGuard(h, { foragerParked: false });

  const bite = await captureReplay(h, "score", async () => {
    const before = await h.snapshot();
    await h.hold(ARROW_KEY.right);
    const eaten = await h.until(
      (s) => s.drifters.length < before.drifters.length,
      { maxTicks: BITE_BUDGET, poll: 1 },
    );
    const after = eaten.snapshot;
    await h.advance(TAIL_TICKS);
    await h.release(ARROW_KEY.right);
    return { before, after, hit: eaten.hit };
  });

  requireSceneHeld(bite.after, guard);
  assertEqual(
    bite.hit,
    true,
    "the forager reached the drifter waiting three tiles along the run and ate " +
      "it, under a held movement action",
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
    bite.after.planktonRemaining,
    bite.before.planktonRemaining,
    "planktonRemaining across the bite, which eating a drifter does not touch",
  );
});
