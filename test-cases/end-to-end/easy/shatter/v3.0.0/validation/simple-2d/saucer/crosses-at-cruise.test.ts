// saucer/crosses-at-cruise — a saucer crosses the field at 140 units per second.
//
// THE RULE. `specs/saucer.md`: "It crosses the field horizontally at
// `SAUCER_SPEED` (`140`), heading into the field from the edge it entered at",
// and `specs/instrumentation.md` has `addSaucer` bring one on "travelling right
// at `SAUCER_SPEED` with no vertical component". So the reading is the horizontal
// displacement two seconds of game time buys, against `2 x SAUCER_SPEED` (`280`).
// The velocity is left exactly as `addSaucer` set it: the crossing speed IS the
// requirement, and posing one over the top would hand the answer to the build.
//
// ITS MIND AND ITS GUN ARE OFF, WHICH IS THE WHOLE ISOLATION. The mind is what
// rerolls the vertical weave and what steers around the core, and neither belongs
// in a reading of how fast the craft crosses; the gun would put rounds on a field
// this check then has to explain. What is left is one powered craft holding one
// course — the well never pulls it (`specs/gravity.md`) — over an empty field,
// with both world gates shut by `startPlaying`.
//
// WHERE IT IS FLOWN. Along a row `300` units below the star's, from `x = 100`:
// the `280` units it covers end at `380`, so its centre is never nearer the
// star's than `300`, against the `48` at which `specs/saucer.md` says its circle
// would overlap the core. Nothing about the core can reach this reading, which
// matters because the mind that would steer around it is switched off.
//
// WHY THREE PERCENT. `8.4` units on a reading of `280`, and the item's own
// figure. A whole tick either side of the span is `1.17` units, so nothing
// conformant needs more than half a percent; what the rest leaves room for is a
// build whose tick clock rounds a two-second span differently. Every wrong cruise
// reads a different number: `120` reads `240`, `160` reads `320`, and a craft
// that only weaves reads nothing at all across.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { foldX } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";
import { poseVisit } from "./visit";

/** The two seconds of game time the displacement is read over. */
const CROSSING_TICKS = ticksFor(2);

/** Where the crossing begins: a row well below the star, near the left edge. */
const START = { x: 100, y: 660 };

/** What two seconds at the stated cruise covers: `280` units. */
const EXPECTED_SPAN = 2 * SAUCER_SPEED;

/** Three percent of that: `8.4` units. See the header. */
const SPAN_TOLERANCE = EXPECTED_SPAN * 0.03;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a saucer 2 x SAUCER_SPEED across in two seconds", async () => {
  startPlaying(h);
  const posed = poseVisit(h, START.x, START.y, { mind: false, gun: false });

  await h.advance(CROSSING_TICKS);
  const crossed = theSaucer(h.snapshot(), "crosses-at-cruise");
  captureStill(h, "cruise");

  const span = Math.abs(foldX(crossed.x - posed.x));
  assertLessThanOrEqual(
    Math.abs(span - EXPECTED_SPAN),
    SPAN_TOLERANCE,
    "the horizontal ground two seconds of game time covered, against " +
      "2 x SAUCER_SPEED (specs/saucer.md)",
  );
});
