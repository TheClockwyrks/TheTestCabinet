// gravity/pull-magnitude — the well pulls by MU / d^2, read at three distances.
//
// THE RULE. `specs/gravity.md`, "The law": every tick, each pulled body gains an
// acceleration toward the star of `aMag = MU / (dEff * dEff)`, with `MU` =
// `4 500 000` and `dEff = max(d, SOFTEN)`. The file states the figure it comes to
// at each of the three distances this check reads:
//
//     d = 200   ->   112.5      d = 150   ->   200      d = 120   ->   312.5
//
// all three of them outside `SOFTEN` (`90`), so none of them is the cap — that
// edge is `gravity/softening-cap`'s own item. This item is the law's MAGNITUDE
// and nothing else: which way the pull points is `gravity/pull-direction`'s.
//
// WHAT IS READ. The SPEED a round posed at rest gains over exactly one tick,
// which `specs/simulation.md` makes `aMag * TICK_DT`. `well.ts` explains why the
// reading is taken that way; the short of it is that a body at rest does not move
// inside the tick, so the distance the pull was computed at is the distance this
// check posed, and one tick is one application of the law rather than a path an
// integrator could shade.
//
// WHY THREE DISTANCES, AND WHY THE LAW NEEDS ALL THREE. One reading fixes a
// number, not a law. The three are `200 : 150 : 120`, whose specified
// accelerations stand at `1 : 1.78 : 2.78` — so every wrong model reads as a
// different set of numbers, and a failure names which one the build implemented:
//
//   a constant pull            same figure at all three; fails at least two
//   MU / d rather than MU / d^2  22 500 : 30 000 : 37 500, out by two orders
//   MU / d^3                   0.56 : 1.33 : 2.60, under a hundredth of the
//                              wanted at every one of the three
//   the softening cap applied everywhere  555.6 at all three, wrong at all three
//   the wrong MU               every reading off by the same ratio
//
// WHY THE THREE BEARINGS ARE OFF-AXIS AND DIFFERENT. A set posed on one axis —
// three rounds straight above the star — cannot tell `d` from `|dy|`, so a build
// measuring its distance along an axis, or as `|dx| + |dy|`, would read exactly
// right. Each round is posed on its own off-axis bearing instead, where the
// distance is a genuine hypotenuse and no cheaper measure comes to the same
// number. The bearings are `35`, `155` and `275` degrees: well apart, none of
// them on an axis or a diagonal, and the three land far enough from each other to
// be told apart in the still.
//
// WHY 5 PERCENT. The figure the review item states, and it is generous by a wide
// margin: a body at rest reads the law with no integrator between it and the
// answer, so a conformant build lands on the specified figure to floating point.
// What 5 percent leaves room for is a build that rounds `MU`, or that applies its
// pull over a slightly different sub-step of the tick — while the nearest wrong
// model above is out by 78 percent.

import { afterEach, beforeEach, it } from "vitest";
import { MU, TICK_DT } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { DEG, pullAt, speedOf } from "../geometry";
import { aroundTheStar, gainsAtRest } from "./well";

/**
 * The three distances the specification tabulates, each with the bearing its
 * round is posed on.
 *
 * Every one is outside `SOFTEN` (`90`), so every one is the uncapped law.
 */
const SAMPLES: readonly { distance: number; bearing: number }[] = [
  { distance: 200, bearing: 35 * DEG },
  { distance: 150, bearing: 155 * DEG },
  { distance: 120, bearing: 275 * DEG },
];

/**
 * How far a reading may fall from the figure the law gives, as a fraction of it.
 *
 * 5 percent, the figure the review item states. See the header: a body at rest
 * reads the law directly, so a conformant build has nothing to spend this on,
 * and the nearest wrong model is out by more than fifteen times it.
 */
const TOLERANCE_FRACTION = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pulls a body at 200, 150 and 120 units by MU / d^2 over one tick", async () => {
  startPlaying(h);

  const at = SAMPLES.map((sample) =>
    aroundTheStar(sample.distance, sample.bearing),
  );
  const gained = await gainsAtRest(h, at);

  // The three rounds the pull was sampled from, on the tick it was sampled on.
  captureStill(h, "sample");

  for (let i = 0; i < SAMPLES.length; i += 1) {
    const { distance } = SAMPLES[i];
    // The law, straight off specs/gravity.md: MU / dEff^2, over one TICK_DT.
    const wanted = pullAt(at[i]) * TICK_DT;
    assertLessThanOrEqual(
      Math.abs(speedOf(gained[i]) - wanted),
      TOLERANCE_FRACTION * wanted,
      `the speed a body at rest ${distance} units from the star gains over one ` +
        `tick: MU (${MU}) / ${distance}^2 = ${(MU / (distance * distance)).toFixed(1)} ` +
        `units per second squared over TICK_DT, which is ${wanted.toFixed(5)} ` +
        `units per second (specs/gravity.md, specs/simulation.md)`,
    );
  }
});
