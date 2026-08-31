// Meltdown — surge/only-hp-scales: the wave number moves the hp and nothing else.
//
// THE RULE. `specs/waves.md`, immediately after the hp scaling: "Nothing else
// scales with the wave. Speeds, bounties, and leak values are the same on the
// last wave as on the first, and every other system is unchanged across a run."
// `specs/surge.md`'s roster is therefore the whole of what a Mote is worth and
// how fast it moves, on Wave 20 exactly as on Wave 1.
//
// WHY THIS ITEM EXISTS SEPARATELY FROM THE SCALING ONE. `surge/hp-scales-with-the-wave`
// is satisfied by a build that scales hp correctly; it says nothing about a build
// that scaled the hp AND the speed, or the hp AND the bounty, which is a very
// natural way to write "the waves get harder" and a real change to how a run
// plays — a deep wave of Motes at double speed paying double is a different game.
// So the three columns the specification names are read at the far end of a
// twenty-wave run and held to the roster's own figures.
//
// THE READING IS TAKEN ON WAVE 20 BECAUSE THAT IS WHERE A SCALING SHOWS. At
// `hpScale(20)` a Mote carries `12.78` times its base hp, so any build that
// applied the same factor to another column is out by an order of magnitude here,
// while on Wave 2 it would be out by `0.62` and every bound would have to be
// tight enough to see it. The wave is posed with `setWave`, which "rebuilds
// nothing, releases nothing, and clears nothing" (`specs/instrumentation.md`), so
// nothing but the wave number differs from the run the other items read.
//
// THREE READINGS, EACH IN ONE DIRECTION, EACH REACHED WHERE THE FIGURE LIVES.
// The speed is a field on the entered unit; the bounty is what a death pays into
// the money; the leak is what an exhaust charges in lives — and the last two are
// transitions no pose can reach (`surge/roster.ts`). Each opens its own run, so
// the gun a kill needed is not standing on the floor while the leak is read.
//
// THE PRECONDITION IS THE WAVE ITSELF, and deliberately not the hp. Asserting
// that the maximum hp had grown would make a build that scales NOTHING fail this
// item as well as the scaling one, and a build that scales nothing is exactly a
// build that passes this requirement. So what is asserted is that the run really
// stands on Wave 20.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import { SURGE_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { enterUnit, readBounty, readLeak } from "./roster";

/** The type read, and the row `specs/surge.md` gives it. */
const TYPE = "mote";
const ROW = SURGE_DEFS[TYPE];

/** The wave every reading is taken on: the last of a twenty-wave Containment run. */
const DEEP_WAVE = 20;

/**
 * How close the unslowed speed must come, as decimal places.
 *
 * Three places is `0.0005`. The roster's `60` is a constant and an unscaled
 * reading is that constant unchanged, so a conformant build reads it exactly. The
 * bound excludes every scaling a build could have applied: `hpScale(20)` would
 * read `766.8`, and even a hundredth of that factor is thousands of times this
 * bound away.
 */
const SPEED_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves a wave-20 Mote's speed, bounty and leak at the roster's figures", async () => {
  // THE SPEED: a field on the unit the deep wave entered.
  await startRun(h);
  await h.debug.setWave(DEEP_WAVE);
  const entered = await enterUnit(h, TYPE);
  await h.advance(1);
  await captureStill(h, "unscaled");

  assertEqual(
    (await h.snapshot()).wave,
    DEEP_WAVE,
    `precondition: the run stands on wave ${DEEP_WAVE}`,
  );
  assertCloseTo(
    entered.baseSpeed,
    ROW.speed,
    SPEED_DIGITS,
    `a wave-${DEEP_WAVE} ${TYPE}'s unslowed speed, which specs/waves.md leaves ` +
      "at the roster's figure",
  );

  // THE BOUNTY: what its death pays into the money, on the same deep wave.
  const bounty = await readBounty(h, TYPE, DEEP_WAVE);
  assertTrue(
    bounty.died,
    `precondition: the Arc's shot killed the wave-${DEEP_WAVE} ${TYPE}`,
  );
  assertEqual(
    bounty.paid,
    ROW.bounty,
    `the money a killed wave-${DEEP_WAVE} ${TYPE} paid, which specs/waves.md ` +
      "leaves at the roster's figure",
  );

  // THE LEAK: what its exhaust charges in lives, on the same deep wave.
  const leak = await readLeak(h, TYPE, DEEP_WAVE);
  assertTrue(
    leak.leaked,
    `precondition: the wave-${DEEP_WAVE} ${TYPE} reached its exhaust`,
  );
  assertEqual(
    leak.spent,
    ROW.leak,
    `the lives a leaked wave-${DEEP_WAVE} ${TYPE} cost, which specs/waves.md ` +
      "leaves at the roster's figure",
  );
});
