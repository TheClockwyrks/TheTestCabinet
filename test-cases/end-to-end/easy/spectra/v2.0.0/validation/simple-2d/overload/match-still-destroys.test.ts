// overload/match-still-destroys — a matching shot destroys whatever the charge.
//
// specs/mode.md keeps the destroying half of specs/bands.md untouched under this
// mode: "A shot whose effective band matches still destroys the drone's exposed
// layer, whatever charge it carries." So the charge changes what a MISMATCH does and
// nothing about what a match does.
//
// THE CHARGE IS POSED AS HIGH AS PLAY EVER CARRIES IT — `OVERLOAD_AT - 1` (2), which
// specs/mode.md fixes as the ceiling ("play never carries it above `OVERLOAD_AT - 1`")
// — because that is the state a build implementing the charge is most likely to have
// made special. A drone one shot short of overloading is still an ordinary drone to a
// matching shot.
//
// THE SHOT IS THE MATCHING ONE, read off the drone rather than assumed: the band it
// reads as, which specs/bands.md says destroys it. A build that lets a charged drone
// shrug off a matching shot, or that treats every contact on a charged drone as a
// charge, leaves the drone on the roster and fails here.
//
// THE WORLD IS ONE SHARD AND ONE SHOT. `startPosed` empties the three rosters and
// shuts the three world gates, so nothing enters, nothing dives and nothing reaches
// the ship while the shot is in flight; the target is posed with every faculty off, so
// it holds its place, its band and its charge until the bullet arrives.
//
// WHAT THIS DOES NOT DECIDE. What a matching shot pays or pops, which are
// `scoring/*`'s and `bursts/spawns-on-kill`'s, and that a matching shot destroys an
// UNCHARGED drone, which is `bands/match-destroys`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  FORM_CENTER_X,
  OVERLOAD_AT,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a drone carrying charge when the shot's band matches", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
    charge: OVERLOAD_AT - 1,
  });

  const posed = droneOf(h.snapshot(), target);
  assertEqual(
    chargeOf(posed, "the Shard posed one charge short of an overload"),
    OVERLOAD_AT - 1,
    "the charge the drone carries into the matching shot " +
      "(specs/instrumentation.md)",
  );

  await fireAt(h, posed.x, posed.y, posed.effectiveBand, SHOT_BELOW);
  captureStill(h, "destroyed");

  assertNull(
    findDrone(h.snapshot(), target),
    `the Shard at charge ${String(OVERLOAD_AT - 1)} is gone from the roster ` +
      `after one ${posed.effectiveBand} bullet climbed ${String(SHOT_BELOW)} ` +
      `units at PLAYER_BULLET_SPEED ${String(PLAYER_BULLET_SPEED)} into its ` +
      `${String(SHARD_HALF)}-unit contact circle — a matching shot still ` +
      "destroys the drone's exposed layer, whatever charge it carries " +
      "(specs/mode.md)",
  );
});
