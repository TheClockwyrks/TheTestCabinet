// instrumentation/reset-seeds-randomness — `reset({ seed })` seeds the game's
// randomness, so two runs opened on one seed lay the same opening wave and a run
// opened on another lays a different one.
//
// THE RULE. `specs/instrumentation.md`: "`options.seed`, a number defaulting to
// `DEFAULT_SEED` (`1`), seeds all of the game's randomness", over a core in
// which "every draw `specs/simulation.md` lists runs off a generator seeded from
// the state's generator field ... so reseeding and replaying the same calls
// reproduces the same result exactly". `specs/simulation.md` lists "a wave's
// rock positions, their drift directions, and their base drift speeds" first
// among those draws, which is why the opening wave is what this reads.
//
// THE RUN IS OPENED THE WAY A PLAYER OPENS ONE. No pose on the surface starts a
// run, and there is not meant to be one: `reset` puts the game on the title with
// the highlight on `PLAY`, and confirming that entry opens a game on wave 1
// (`specs/ui.md`, `specs/progression.md`). So the layout read below is the one
// the game's own wave code laid from the seeded generator, not one the check
// arranged. That is also the whole reason this item exists as a check on the
// SEED rather than on the surface: a build whose randomness ignores the seed
// makes every seeded scenario in this suite irreproducible.
//
// WHAT IS COMPARED. Each rock's size, centre and velocity, in roster order —
// roster order being the order the wave spawned them, which the same seed must
// also reproduce. Positions are compared to four decimal places: the two runs
// replay the same arithmetic from the same seed, so they agree to a double's own
// precision, and a build that merely spawns near the same places fails.
//
// WHY A SECOND SEED. Two identical runs alone are also what a build with NO
// randomness at all produces — a fixed opening wave passes the first leg
// perfectly. The third run, on a different seed, is what separates "seeded" from
// "hardcoded".

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** The seed two runs are opened on, and the one the third is opened on. */
const SEED = 7;
const OTHER_SEED = 8;

/** The decimal places two runs on one seed must agree to. */
const LAYOUT_DIGITS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** One wave's layout as a comparable reading: size, centre and velocity. */
function layoutOf(snapshot: ShatterSnapshot): string[] {
  return snapshot.rocks.map(
    (rock) =>
      `${rock.size} ${rock.x.toFixed(LAYOUT_DIGITS)} ` +
      `${rock.y.toFixed(LAYOUT_DIGITS)} ${rock.vx.toFixed(LAYOUT_DIGITS)} ` +
      `${rock.vy.toFixed(LAYOUT_DIGITS)}`,
  );
}

/** Open a run on `seed` and answer the opening wave it laid. */
async function openRun(seed: number): Promise<string[]> {
  await startRun(h, seed);
  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "playing",
    `confirming PLAY after reset({ seed: ${seed} }) opens a game`,
  );
  assertGreaterThan(
    snapshot.rocks.length,
    0,
    `the run opened on seed ${seed} put an opening wave on the field`,
  );
  return layoutOf(snapshot);
}

it("lays the same opening wave twice on one seed, and a different one on another", async () => {
  const first = await openRun(SEED);
  const second = await openRun(SEED);

  assertDeepEqual(
    second,
    first,
    `two runs opened after reset({ seed: ${SEED} }) lay the same wave-1 layout`,
  );

  // The layout both runs on the one seed produced.
  await h.advance(1);
  captureStill(h, "seeded");

  const other = await openRun(OTHER_SEED);
  if (
    other.length === first.length &&
    other.every((rock, index) => rock === first[index])
  ) {
    fail(
      `a run opened after reset({ seed: ${OTHER_SEED} }) to lay a different ` +
        `wave-1 layout from one opened after reset({ seed: ${SEED} }) — the ` +
        "seed seeds all of the game's randomness (specs/instrumentation.md)",
      other,
    );
  }
});
