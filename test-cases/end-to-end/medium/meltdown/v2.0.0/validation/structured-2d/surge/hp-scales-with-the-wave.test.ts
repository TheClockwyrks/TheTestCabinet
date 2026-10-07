// Meltdown — surge/hp-scales-with-the-wave: hp climbs with the wave number.
//
// THE RULE. `specs/waves.md`, Per-wave scaling: "A unit released on wave `w`
// carries `hpScale(w)` times its base hp", where `hpScale(w) = 1 + 0.62 * (w - 1)`.
// `specs/surge.md` says the same from the other end: "A unit's maximum hp is its
// base hp scaled for the wave it belongs to, and its hp starts full."
//
// WHY THREE WAVES. The form is a straight line in `w`, and a line is fixed by two
// points; the third is what separates it from a curve. Wave 1 pins the intercept
// at exactly the base hp, wave 10 sits at `6.58` times it and wave 20 at `12.78`,
// so a build that got the slope right and the intercept wrong, or the intercept
// right and the slope wrong, misses at least one of the three. The Mote's `40`
// makes the three figures `40`, `263.2` and `511.2`, no two of which any wrong
// model lands on together.
//
// WHY A UNIT IS ADDED RATHER THAN RELEASED. `specs/instrumentation.md` gives
// `addUnit` the same scaling the spawner uses — "its `maxHp` is its base hp scaled
// for the current wave" — so the wave number is posed with `setWave` and the unit
// read on the frame it entered. Releasing a wave instead would fold in the
// progression's own type and count, which `surge/wave-type-*` and `surge/wave-size`
// decide, and would put a wave-10 Core on the floor rather than the Mote whose
// base hp this point is scaling.
//
// WHY THE MOTE, AND ON MEDIUM. Containment on Medium runs 20 waves
// (`specs/modes.md`), so wave 20 is a wave this run actually has. The Mote is the
// baseline row and is what the opening list fields most often, and reading one
// type at three waves keeps this point about the SCALING: whether the base hp
// itself is right is `surge/mote-stats`.
//
// WHAT EVERY WRONG MODEL READS. A build that never scales reads `40` three times;
// one that scales by the wave rather than by `w - 1` reads `65.2` on wave 1; one
// that multiplies by a per-wave factor instead of adding a per-wave step reads a
// curve that overshoots wave 20 enormously; one that used The Hundred's flat `6.0`
// (`specs/modes.md`) reads `240` at every wave; one that scaled the CURRENT hp of
// units already on the floor rather than the hp of a unit released now reads `40`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { SURGE_DEFS, hpScale } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseStill, unitOf } from "./scenario";

/** The base hp `specs/surge.md` gives the type this point scales. */
const BASE_HP = SURGE_DEFS.mote.hp;

/** The waves the line is read at: its intercept, its middle and its far end. */
const WAVES = [1, 10, 20] as const;

/**
 * How far a reported maximum hp may sit from the stated figure: one hit point.
 *
 * `specs/waves.md` fixes the product exactly and it is not a whole number — a
 * wave-10 Mote is `263.2` — while nothing in the specification forbids a build
 * from carrying hp as a whole number. One hit point admits the same figure
 * rounded, floored or ceiled and nothing else: the three readings this point takes
 * are `40`, `263.2` and `511.2`, and the nearest wrong model to any of them (a
 * build a wave out, which reads `238.4` at wave 10) misses by twenty-four.
 */
const HP_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives a unit added on wave w a maxHp of baseHp * hpScale(w)", async () => {
  for (const wave of WAVES) {
    startRun(h, "containment", "medium");
    h.debug.setWave(wave);
    const id = poseStill(h, "mote");
    const posed = h.snapshot();
    await h.advance(1);
    captureStill(h, "scaled");

    const unit = unitOf(posed, id);
    const stated = BASE_HP * hpScale(wave);
    assertBetween(
      unit.maxHp,
      stated - HP_TOLERANCE,
      stated + HP_TOLERANCE,
      `a Mote added on wave ${wave}: its maxHp, against the ` +
        `${BASE_HP} * (1 + 0.62 * ${wave - 1}) = ${stated} specs/waves.md ` +
        `states`,
    );
    assertEqual(
      unit.hp,
      unit.maxHp,
      `a Mote added on wave ${wave}: its hp, which starts full ` +
        `(specs/surge.md)`,
    );
  }
});
