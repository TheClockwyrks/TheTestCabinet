// Meltdown — instrumentation/reset-seeds-randomness: `reset({ seed })` seeds the
// game's randomness, so the same seed replays and a different seed does not.
//
// THE RULE. `specs/instrumentation.md`: "`options.seed`, a number defaulting to
// `DEFAULT_SEED` (`1`), seeds all of the game's randomness", and the surface rests
// on "seeded randomness ... reseeding and replaying the same calls reproduces the
// same result exactly. The vent each unit enters at is drawn from it."
// `specs/waves.md` names that draw as the game's ONLY randomness: "Each unit's
// vent is drawn from the game's seeded generator, the two vents equally likely.
// That draw is the only randomness in the game, so a run replayed from the same
// seed releases the same sequence of vents."
//
// SO THE VENT SEQUENCE IS THE WHOLE OBSERVABLE. There is nothing else in this
// game a seed can reach, which is why the reading is a released wave's vents and
// not a sampled generator.
//
// THE SHAPE IS A REPLAY AND A CONTRAST, and both halves are needed. Two runs from
// seed `7` must draw the identical sequence — a build whose generator is seeded
// from the wall clock, or from nothing, fails there. And a run from seed `8` must
// draw a different one — a build that ignores the seed and always draws the same
// sequence, or that alternates the vents on a counter with no randomness at all,
// passes the first half and fails here.
//
// WHY THE SEQUENCE IS THIS LONG. Two vents, equally likely, means two sequences
// drawn from different seeds agree by chance with probability `2^-n`. At `DRAWS`
// (`20`) that is under one in a million, which is the whole reason the contrast is
// worth asserting at all; at three or four units it would be a coin toss.
//
// WHY THE RUN'S OWN RELEASE IS TURNED ON. The vent is drawn BY the spawner, on
// the frame it releases a unit. `addUnit` takes its vent as an argument
// (`specs/instrumentation.md`), so a posed unit draws nothing — the wave has to be
// released for real. This is therefore one of the items the world gate belongs to.
//
// AND WHY THE LIVES ARE POSED ENORMOUS. Twenty units crossing an empty floor all
// leak eventually, and the twentieth leak would take the lives to `0` and end the
// run mid-release (`specs/waves.md`). The lives are a run figure this item is not
// about, so they are posed out of the way rather than defended with towers.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThanOrEqual,
  assertNotEqual,
} from "../assert";
import { WAVE_SPAWN_INTERVAL, type Vent } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** How many vents are drawn from each seed, and how long the release is watched. */
const DRAWS = 20;
/**
 * The window the release is followed over, and the spacing between two samples.
 *
 * Twenty units one every `WAVE_SPAWN_INTERVAL` takes `19 * 0.6` seconds; the
 * margin is a whole further wave's worth. The spacing is well under one interval
 * and every unit lives for several seconds on an empty floor, so no unit can
 * appear and be gone between two samples. Neither figure is a tolerance.
 */
const WATCH_SECONDS = WAVE_SPAWN_INTERVAL * DRAWS + 12;
const SAMPLE_SECONDS = 0.2;
/** Frames of game time per second inside a sample. Coarse, because none is read. */
const SAMPLE_HZ = 30;

/** Lives no leak in this scenario can exhaust. */
const UNENDING_LIVES = 1_000_000;

/** The two seeds contrasted, neither of them `DEFAULT_SEED`. */
const SEED_A = 7;
const SEED_B = 8;

let h: Harness;

/**
 * Reseed, release a wave, and hand back the vents its first {@link DRAWS} units
 * entered at, in release order.
 *
 * Release order is id order: an added entity is appended to its roster and keeps
 * its id for its whole life (`specs/instrumentation.md`), so sorting the units
 * ever seen by id recovers the order they arrived in even after the early ones
 * have leaked.
 */
async function ventsFrom(seed: number, picture: boolean): Promise<Vent[]> {
  const { debug } = h;
  await debug.reset({ seed });
  await debug.setScreen("playing");
  await debug.setPhase("wave");
  await debug.setLives(UNENDING_LIVES);
  await debug.setWavePending(DRAWS);

  const seen = new Map<number, Vent>();
  await h.skipUntil(
    (snapshot) => {
      for (const unit of snapshot.surge) seen.set(unit.id, unit.vent);
      return seen.size >= DRAWS;
    },
    {
      maxSeconds: WATCH_SECONDS,
      pollSeconds: SAMPLE_SECONDS,
      hz: SAMPLE_HZ,
    },
  );
  if (picture) await captureStill(h, "seeded");

  assertGreaterThanOrEqual(
    seen.size,
    DRAWS,
    `units released from a wave of ${DRAWS} under seed ${seed}, ` +
      `so there are ${DRAWS} vent draws to read`,
  );
  return [...seen.entries()]
    .sort(([left], [right]) => left - right)
    .slice(0, DRAWS)
    .map(([, vent]) => vent);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the same vents twice from one seed and different vents from another", async () => {
  const first = await ventsFrom(SEED_A, false);
  const again = await ventsFrom(SEED_A, true);
  assertDeepEqual(again, first, `the vents seed ${SEED_A} draws, replayed`);

  const other = await ventsFrom(SEED_B, false);
  assertNotEqual(
    other.join(","),
    first.join(","),
    `the vents seed ${SEED_B} draws, against seed ${SEED_A}'s`,
  );
});
