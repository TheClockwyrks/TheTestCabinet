// resonance/caps-at-max — an event that would carry the meter past the ceiling
// leaves it at exactly `RESONANCE_MAX`.
//
// THE RULE. `specs/resonance.md`: "It caps at `RESONANCE_MAX`. An event that
// would carry it past the ceiling leaves it at exactly `RESONANCE_MAX`."
//
// THE POSE IS ONE POINT SHORT AND THE EVENT IS WORTH MORE THAN ONE POINT, which
// is what makes the reading decisive. At `RESONANCE_MAX - 1` a matching kill is
// worth `RESONANCE_KILL` (`4`) — four times the room left — so the three models a
// build can implement read three different numbers: a build that caps reads
// `RESONANCE_MAX` (`100`), a build that adds without a ceiling reads
// `RESONANCE_MAX - 1 + RESONANCE_KILL` (`103`), and a build that wraps or resets
// on overflow reads something at or near `0`. A pose further from the ceiling
// would grade none of them.
//
// THE EVENT IS A MATCHING KILL because `specs/resonance.md` gives the meter only
// two fills and a kill is the smaller of the two: a build that caps a
// `RESONANCE_ABSORB` (`6`) but not a `RESONANCE_KILL` (`4`) has to fail
// somewhere, and the smaller figure is the harder case to get right.
//
// WHAT THIS DOES NOT DECIDE. That a matching kill fills the meter at all is
// `resonance/kill-fills`; that a full meter reports itself ready is
// `resonance/ready-at-full`.

import { afterEach, beforeEach, it } from "vitest";
import {
  FORM_CENTER_X,
  RESONANCE_KILL,
  RESONANCE_MAX,
} from "../../src/constants";
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
 * Where the meter is posed, in meter points: one point below the ceiling.
 *
 * The review item's own figure — "the meter posed one point below
 * `RESONANCE_MAX`" — and the value at which a kill worth `RESONANCE_KILL` (`4`)
 * overshoots by three.
 */
const POSED_METER = RESONANCE_MAX - 1;

/**
 * Where the target Shard stands.
 *
 * Mid-field on the ship's own lane, clear of both HUD strips (`FIELD_TOP` `64`,
 * `FIELD_BOTTOM` `656`), clear of `SHIP_Y` (`600`), and clear of the corner the
 * bystander holds.
 */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Geometry, not a tolerance: a Shard's contact reach against one of the player's
 * bullets is `SHARD_HALF` (`14`) + `PLAYER_BULLET_HALF` (`6`) = `20` units of
 * centre separation, so `140` places the bullet seven times clear of it.
 */
const SHOT_BELOW = 140;

/** Decimal places the meter is read to: whole-number figures, round-off only. */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops at exactly RESONANCE_MAX when a kill would carry it past", async () => {
  startPosed(h);
  // A stage clears in the moment the last drone of its wave is destroyed
  // (specs/stages.md); the bystander leaves the wave a drone standing, so the
  // meter is read on the live wave rather than under the interstitial.
  poseBystander(h);
  h.debug.setResonance(POSED_METER);
  const target = poseDrone(h, "shard", TARGET.x, TARGET.y, { band: "cyan" });

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter stands one point below its ceiling",
  );

  await fireAt(h, TARGET.x, TARGET.y, "cyan", SHOT_BELOW);
  captureStill(h, "capped");

  const after = h.snapshot();
  assertNull(
    findDrone(after, target),
    "precondition: the cyan shot destroyed the stored-cyan Shard " +
      "(specs/bands.md)",
  );
  assertCloseTo(
    after.resonance,
    RESONANCE_MAX,
    METER_DIGITS,
    `the meter after a kill worth RESONANCE_KILL (${RESONANCE_KILL}) landed ` +
      `with one point of room left: capped at RESONANCE_MAX ` +
      `(${RESONANCE_MAX}) rather than carried to ` +
      `${POSED_METER + RESONANCE_KILL} (specs/resonance.md)`,
  );
});
