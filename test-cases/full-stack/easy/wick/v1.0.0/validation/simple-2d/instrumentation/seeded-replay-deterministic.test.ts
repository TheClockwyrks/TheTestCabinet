// instrumentation/seeded-replay-deterministic — two runs given the same seed,
// the same operations, and the same ticks report identical `run` and
// `rngState`, the same spawns and the same offers included.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "A deterministic
// core": "Given the same seed, the same sequence of operations, and the same
// number of ticks, the game reaches the same `run` and `rngState` every time",
// resting on "Seeded randomness. The game holds one pseudo-random generator,
// seeded by `reset` ... and every random draw comes from it: a spawn's angle
// and type, an offer draw, ...".
//
// THE SCENARIO CONSUMES THE STREAM, because determinism over a run that never
// draws is vacuous. Each session starts a fresh run from the seed with the
// director, the enemies' motion, and the weapons on, so the window spawns draw
// their angles and types and Taper fights what arrives; a queued level-up then
// opens the overlay, so the offer draw is consumed too. The two sessions run
// on two engines, so nothing is shared but the seed and the script.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  openLevelUp,
  type Harness,
  type WickSnapshot,
} from "../harness";

const SEED = 7;
/** Ticks the run fights for: three window-0 spawns and Taper's first swings. */
const FOUGHT_TICKS = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** One seeded session: the same operations, the same elapsed ticks. */
async function driveSeeded(on: Harness): Promise<WickSnapshot> {
  isolate(on, { seed: SEED, keepTaper: true });
  enable(on, "spawning", "enemyMotion", "weaponFire", "effectMotion");
  await on.tick(FOUGHT_TICKS);
  return openLevelUp(on, 1);
}

it("replays a seeded run to an identical snapshot", async () => {
  const first = await captureReplay(h, "seeded", () => driveSeeded(h));

  const other = await createHarness();
  let replayed: WickSnapshot;
  try {
    replayed = await driveSeeded(other);
  } finally {
    other.dispose();
  }

  // The stream was drawn from: spawns landed and an overlay drew offers, so
  // the equality below says something about the draws.
  assertGreaterThan(
    first.run.enemies.length,
    0,
    "the spawns the director drew",
  );
  assertGreaterThan(first.run.offers.length, 0, "the offers the overlay drew");
  assertDeepEqual(replayed.run.enemies, first.run.enemies, "the same spawns");
  assertDeepEqual(replayed.run.offers, first.run.offers, "the same offers");
  assertDeepEqual(replayed.run, first.run, "the two sessions' runs");
  assertDeepEqual(
    replayed.rngState,
    first.rngState,
    "the two sessions' rngState",
  );
});
