// gravity/saucer-free — the well never touches the saucer.
//
// THE RULE. `specs/gravity.md`, "Which bodies are pulled", gives the saucer a
// flat `No`, on the same terms as the ship: "the ship and the saucer are powered
// craft with their own drive. The well never adds anything to their velocity,
// whatever their distance from the star, so each holds exactly the course it is
// steering." `specs/saucer.md` states it again: "it is a powered craft. The well
// never pulls it."
//
// SEPARATE FROM `gravity/ship-free`, because the two exemptions are written in
// different places in a build and a build can have one and not the other.
//
// THE POSE. A saucer brought on 120 units directly above the star, which
// `specs/instrumentation.md` says leaves it "travelling right at `SAUCER_SPEED`
// with no vertical component" — the cruise it enters the field at, so nothing
// about the course is this check's invention. Its closest approach to the star is
// the 120 it starts at, where the law gives `312.5` units per second squared, and
// it holds clear of the core the whole crossing.
//
// ONLY THE FACULTY THE REQUIREMENT EXERCISES IS LEFT ON. The saucer has three,
// each with its own gate (`specs/instrumentation.md`), and this item is about
// what the WELL does to a craft that is travelling:
//
//   mind    OFF. Its steering — the weave it rerolls every second, and the
//           avoidance that keeps it clear of the core — is the one thing that
//           legitimately changes its velocity, so a check about a velocity that
//           must not change cannot leave it on. With it off, `specs/saucer.md`'s
//           whole steering vocabulary is silent and the only thing that could
//           move the velocity is the fault this item hunts.
//   gun     OFF. It fires nothing, so nothing else is on the field to be pulled,
//           and the picture kept as this item's still is the saucer and the star.
//           Its firing is `saucer/fires-every-1p6s`'s item.
//   travel  ON. The requirement is that a craft CROSSING the well holds its
//           course, so the crossing is what is posed.
//
// TWO SECONDS, AND WHAT A PULLED SAUCER DOES IN THEM. Integrating
// `specs/gravity.md`'s law from this pose, a saucer the well pulled ends the two
// seconds at `(-57.6, -127.7)` units per second — it has swung round the star and
// is travelling BACKWARDS — against the `(140, 0)` it entered at. A build that
// lets the well touch it for a SINGLE tick already gains 2.60 units per second,
// five times the bound.
//
// THE CROSS-TRACK POSITION IS READ TOO, because it catches a different fault: a
// build that pulls its bodies by displacing them rather than by accelerating them
// reads a clean velocity and a `y` that has fallen toward the star. Only `y` is
// read — where the saucer got to ALONG its course is its travel, which is
// `saucer/crosses-at-cruise`'s item, not this one.

import { afterEach, beforeEach, it } from "vitest";
import { MU, SAUCER_SPEED, STAR_X, STAR_Y, TICK_DT } from "../../src/constants";
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
import { pullAt } from "../geometry";

/** How far above the star the saucer is brought on, in units. */
const DISTANCE = 120;

/** Where that puts it: directly above the star, on the field's own column. */
const POSE = { x: STAR_X, y: STAR_Y - DISTANCE };

/** The stretch of the crossing that is watched. */
const CROSSING_TICKS = ticksFor(2);

/**
 * How far either component of the velocity may fall from the cruise the saucer
 * entered at, in units per second.
 *
 * A conformant build reads exactly `(SAUCER_SPEED, 0)`: with its mind off,
 * `specs/instrumentation.md` says "nothing it decides changes its velocity", and
 * `specs/gravity.md` adds nothing to a powered craft. The bound is set against the
 * smallest wrong reading — a build that lets the well touch it for ONE tick gains
 * `MU / 120^2 * TICK_DT` = 2.60 units per second, five times this.
 */
const VELOCITY_TOLERANCE = 0.5;

/**
 * How far the saucer's cross-track position may move, in units.
 *
 * One unit. `specs/instrumentation.md` enters the saucer "with no vertical
 * component", and with its mind off nothing gives it one, so a conformant build
 * holds `y` exactly. A build that lets the well move the saucer at all leaves
 * that row: `specs/gravity.md`'s law integrated from this pose puts it 171 units
 * below the row after the two seconds.
 */
const CROSS_TRACK_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a crossing saucer's velocity untouched beside the star", async () => {
  startPlaying(h);
  poseSaucer(h, POSE.x, POSE.y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);

  await h.advance(CROSSING_TICKS);

  // The saucer crossing beside the star, untouched by the well.
  captureStill(h, "free");

  const saucer = requireSaucer(
    h.snapshot(),
    "the saucer brought on beside the star still up two seconds later, " +
      `well inside its SAUCER_LIFETIME (specs/saucer.md)`,
  );
  const pull = pullAt(POSE);
  const wouldAdd = `the law at ${DISTANCE} units would add ${(
    pull * TICK_DT
  ).toFixed(
    3,
  )} units per second every tick (MU ${MU} / ${DISTANCE}^2 = ${pull.toFixed(
    1,
  )})`;

  assertLessThanOrEqual(
    Math.abs(saucer.vx - SAUCER_SPEED),
    VELOCITY_TOLERANCE,
    `the saucer's vx two seconds into a crossing 120 units from the star, ` +
      `against the SAUCER_SPEED (${SAUCER_SPEED}) it entered at: the well never ` +
      `adds anything to a powered craft's velocity (specs/gravity.md, ` +
      `specs/saucer.md), while ${wouldAdd}`,
  );

  assertLessThanOrEqual(
    Math.abs(saucer.vy),
    VELOCITY_TOLERANCE,
    "the saucer's vy two seconds into a crossing it entered with no vertical " +
      "component and with its mind off, so nothing it decides changed it " +
      `(specs/instrumentation.md); the well adds nothing either, while ${wouldAdd}`,
  );

  assertLessThanOrEqual(
    Math.abs(saucer.y - POSE.y),
    CROSS_TRACK_TOLERANCE,
    `how far the saucer's centre moved off the row it entered on ` +
      `(y = ${POSE.y}), in units, over two seconds with its mind off ` +
      "(specs/gravity.md, specs/saucer.md)",
  );
});
