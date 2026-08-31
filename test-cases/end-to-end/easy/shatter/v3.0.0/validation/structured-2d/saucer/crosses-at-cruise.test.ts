// saucer/crosses-at-cruise — the saucer crosses the field at SAUCER_SPEED.
//
// THE RULE. `specs/saucer.md`, Entry and travel: a saucer "crosses the field
// horizontally at `SAUCER_SPEED` (`140`)". `specs/instrumentation.md` has
// `addSaucer` bring one on "travelling right at `SAUCER_SPEED` with no vertical
// component", so a posed craft is already on the course the rule fixes and this
// point reads how far that course carries it.
//
// WHAT IS READ. The horizontal displacement over two seconds of game time, along
// the shortest wrapped separation (`specs/field.md`), against `2 x SAUCER_SPEED`
// (`280`) within three percent. Displacement rather than the reported `vx`,
// because a build could report a cruise it does not fly: what a player sees is
// where the craft gets to.
//
// TWO OF THE THREE FACULTIES ARE SHUT. `specs/saucer.md` gives the saucer three
// separable faculties and this requirement is its TRAVEL alone.
// `setSaucerMind(false)` stops the weave — which would put vertical motion into
// the reading and, more to the point, is a decision rather than a crossing — and
// stops the core steering; `setSaucerGun(false)` leaves the two seconds free of
// rounds. `setSaucerTravel` is left ON, because the locomotion IS the requirement.
//
// THE LANE IS CLEAR OF EVERYTHING. The crossing runs along `y = 100` from `x = 200`
// to `x = 480`, whose closest approach to the star is `305` units — six times the
// `48` at which a saucer's circle would touch the core — so nothing about the
// star's neighbourhood enters a reading about speed, and the well never pulls a
// saucer in any case (`specs/gravity.md`). The lane crosses no seam, so the two
// readings are two hundred units apart in plain coordinates as well as wrapped
// ones.
//
// THE THREE PERCENT is a tolerance on the READING, not on the figure. A saucer is
// powered and undragged, so a conformant build's displacement is `280` units to
// floating-point precision; three percent is `8.4` units, which is under a tick's
// worth of travel at any speed the game uses and an order of magnitude short of
// the nearest figure a build might have reached for instead (`SAUCER_WEAVE_SPEED`
// `90`, or the `260` a `130`-unit Small drift would give).

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_W, SAUCER_SPEED } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { shortestDelta } from "../geometry";

/** Where the crossing starts. See the header for why this lane. */
const START_X = 200;
const LANE_Y = 100;

/** How much game time the crossing is read over, in seconds. */
const SPAN = 2;

/** How far the cruise must carry it over that span, in units. */
const EXPECTED = SPAN * SAUCER_SPEED;

/** The three percent of that the item allows the reading. */
const TOLERANCE = 0.03 * EXPECTED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a saucer 2 x SAUCER_SPEED across the field in two seconds of game time", async () => {
  startPlaying(h);
  poseSaucer(h, START_X, LANE_Y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);

  const before = requireSaucer(h.snapshot(), "the saucer posed at cruise");
  await h.advance(ticksFor(SPAN));
  const after = requireSaucer(
    h.snapshot(),
    `the saucer still on the field ${SPAN} s into its crossing`,
  );
  // The saucer two seconds into its crossing.
  captureStill(h, "cruise");

  assertLessThanOrEqual(
    Math.abs(Math.abs(shortestDelta(before.x, after.x, FIELD_W)) - EXPECTED),
    TOLERANCE,
    `how far the crossing missed ${EXPECTED} units by over ${SPAN} s of game ` +
      `time — a saucer crosses at SAUCER_SPEED (${SAUCER_SPEED}) ` +
      `(specs/saucer.md); it went from x = ${before.x.toFixed(1)} to ` +
      `x = ${after.x.toFixed(1)}`,
  );
});
