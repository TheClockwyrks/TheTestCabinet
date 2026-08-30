// instrumentation/pellet-sequence-deterministic — the pellet generator is seeded,
// and reseeding it replays the same draws.
//
// WHAT specs/instrumentation.md REQUIRES. The one draw the game makes is the cell
// each pellet spawns on, it runs off a generator `reset` seeds, and the game
// keeps that generator's whole state, "so reseeding and replaying the same calls
// reproduces the same pellet sequence exactly". `reset({ seed })` names the seed.
//
// HOW THE RUN IS MADE REPRODUCIBLE. The only thing this point may vary is the
// generator, so everything else is posed identically in both runs: the same
// cleared board, the same chain, the same direction, and the same pellet cell fed
// to each eat. `setPellet` is explicitly NOT a spawn — "the generator is not
// drawn from and the seeded sequence is left where it stands" — so placing the
// next meal by hand steers the head without disturbing the draw under test. Each
// eat then spawns the pellet the generator chose, which is what is recorded.
//
// THE BOARD IS CLEARED FIRST because a mode's obstacle course is not what this
// point is about, and clearing it makes the two runs read the same under either
// mode. Both runs clear it identically, so the valid set the generator draws
// from is the same set in both.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { DEFAULT_SEED, type Cell } from "../constants";
import {
  ahead,
  captureReplay,
  chainFrom,
  clearObstacles,
  createHarness,
  type Harness,
} from "../harness";

/** Eats driven per run: enough draws that two agreeing sequences is no accident. */
const EATS = 12;

/** Where the chain starts, with a clear run to the right for every eat. */
const HEAD: Cell = { col: 3, row: 8 };

/** The seed both runs are laid with. */
const SEED = DEFAULT_SEED + 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Seed the game, drive `EATS` eats along one row, and answer the cell the
 * generator put each replacement pellet on.
 *
 * Every call the run makes is fixed, in this order, so two runs differ in
 * nothing but the generator's state.
 */
async function drawSequence(seed: number): Promise<Cell[]> {
  const { debug } = h;
  await debug.reset({ seed });
  await clearObstacles(h);
  await debug.setSnake(chainFrom(HEAD, "right", 3));
  await debug.setDirection("right");
  await debug.clearTurns();
  await debug.setPelletRespawn(true);
  await debug.setScreen("playing");

  const drawn: Cell[] = [];
  let head = HEAD;
  for (let eat = 0; eat < EATS; eat += 1) {
    const meal = ahead(head, "right");
    await debug.setPellet(meal.col, meal.row);
    const after = await h.tick();
    assertEqual(after.pellet === null, false, `a pellet after eat ${eat + 1}`);
    drawn.push(after.pellet as Cell);
    head = meal;
  }
  return drawn;
}

it("places the same pellets, in the same order, from the same seed", async () => {
  const first = await drawSequence(SEED);
  assertEqual(first.length, EATS, "pellets drawn by the first run");

  const second = await captureReplay(h, "seeded", () => drawSequence(SEED));

  // Whether the draw VARIES is a different requirement, decided by
  // `growth/respawn-varies`; what is decided here is only that it repeats.
  assertDeepEqual(
    second,
    first,
    "the same seed and the same sequence of calls",
  );
});
