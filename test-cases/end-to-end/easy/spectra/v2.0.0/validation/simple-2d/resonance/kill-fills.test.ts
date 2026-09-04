// resonance/kill-fills — destroying a Shard with a matching shot raises the meter
// by exactly `RESONANCE_KILL`.
//
// THE RULE. The second of the two events `specs/resonance.md` fills the meter
// from: "One of the player's bullets destroys a drone by matching its band |
// `RESONANCE_KILL` (`4`)". A Shard carries a fixed band for its life
// (`specs/drones.md`) and has no shell and no shimmer to swap it, so with no
// inversion running a cyan shot into a stored-cyan Shard is exactly the matching
// kill, reached with nothing else on the field that could move the meter.
//
// THE METER IS POSED AWAY FROM ZERO. From `0` a build that ADDS `RESONANCE_KILL`
// and a build that SETS the meter to it read the same number; posed at
// `POSED_METER` they read different ones, and a build that pays a kill the ABSORB
// figure (`6`) reads a third. The reading therefore names which wrong model the
// build implemented rather than only that one is there. `POSED_METER` also leaves
// the ceiling far out of reach, so the cap `resonance/caps-at-max` grades decides
// nothing here.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys at all is
// `bands/match-destroys`; what the kill SCORES is `scoring`'s; what an absorbed
// bullet adds is `resonance/absorb-fills`.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, RESONANCE_KILL, RESONANCE_MAX } from "../constants";
import { assertCloseTo, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseBystander } from "./wave";

/**
 * Where the meter is posed before the kill, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (`100`): clear of `0`, so adding and setting read
 * differently, and clear of the ceiling, so `POSED_METER + RESONANCE_KILL` (`24`)
 * is nowhere near the cap.
 */
const POSED_METER = 20;

/**
 * Where the target Shard stands.
 *
 * Mid-field on the ship's own lane: clear of both HUD strips (`FIELD_TOP` `64`,
 * `FIELD_BOTTOM` `656`), clear of `SHIP_Y` (`600`), and clear of the corner the
 * bystander holds.
 */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Geometry, not a tolerance: a Shard's contact reach against one of the player's
 * bullets is `SHARD_HALF` (`14`) + `PLAYER_BULLET_HALF` (`6`) = `20` units of
 * centre separation, so `140` places the bullet seven times clear of it and the
 * contact the meter reads is one the flight produced. `fireAt` derives the frames
 * from `PLAYER_BULLET_SPEED`, so the climb covers the whole gap.
 */
const SHOT_BELOW = 140;

/**
 * Decimal places the meter is read to.
 *
 * `specs/resonance.md` states the meter's figures as whole numbers, so the only
 * slack allowed is the round-off of a build that carries the meter as a fraction
 * of `RESONANCE_MAX` and reports it scaled.
 */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly RESONANCE_KILL when a matching shot destroys a Shard", async () => {
  startPosed(h);
  // A stage clears in the moment the last drone of its wave is destroyed
  // (specs/stages.md), and this scenario destroys the drone it poses; the
  // bystander leaves the wave a drone standing, so the meter is read on the live
  // wave rather than under the stage-cleared interstitial.
  poseBystander(h);
  h.debug.setResonance(POSED_METER);
  const target = poseDrone(h, "shard", TARGET.x, TARGET.y, { band: "cyan" });

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the kill is measured from",
  );

  await fireAt(h, TARGET.x, TARGET.y, "cyan", SHOT_BELOW);
  captureStill(h, "filled");

  const after = h.snapshot();
  assertNull(
    findDrone(after, target),
    "precondition: the cyan shot destroyed the stored-cyan Shard " +
      "(specs/bands.md)",
  );
  assertCloseTo(
    after.resonance,
    POSED_METER + RESONANCE_KILL,
    METER_DIGITS,
    `the meter after one matching kill: ${POSED_METER} + RESONANCE_KILL ` +
      `(${RESONANCE_KILL}) (specs/resonance.md), out of RESONANCE_MAX ` +
      `(${RESONANCE_MAX})`,
  );
});
