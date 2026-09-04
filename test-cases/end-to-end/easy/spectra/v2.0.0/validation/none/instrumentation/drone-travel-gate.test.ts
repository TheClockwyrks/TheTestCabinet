// Spectra — instrumentation/drone-travel-gate: a drone whose travel is gated off
// reports the same centre after a second of game time as it did at the call, while
// one beside it with travel on has moved.
//
// `specs/instrumentation.md` gives the operation exactly one faculty:
// `setDroneTravel(id, enabled)` "Gates the drone's locomotion alone: its advance
// along an entrance path, its ride on the formation sway, its dive, and its
// return. Off, it holds its exact center and keeps its phase; nothing is
// cancelled, completed, or resolved early. Its band clock and its firing run on."
//
// THE WITNESS IS A DIVE, WHICH IS THE FASTEST THING A DRONE DOES. `specs/swarm.md`
// flies one at `DIVE_SPEED` (`300`) units per second along a path that bends
// toward the ship, so a second of it is three hundred units of travel — while a
// drone resting in formation would only ride the sway, whose whole amplitude is
// `SWAY_AMP` (`20`) and which is near its turning point half the time. A build
// whose gate merely slows a drone rather than stopping it is nowhere near the
// tolerance below.
//
// AND THE TWO DRONES DIFFER IN NOTHING BUT THE GATE. Both are Shards, both posed
// into a dive from the same row, both with their firing gated off — so what the
// reading separates is the one faculty this point is about. The firing is off
// because a dive that shot at the ship would be exercising `specs/swarm.md`'s
// enemy fire in a point about locomotion; `instrumentation/drone-fire-gate` is
// where that gate is decided.
//
// WHAT THIS DOES NOT DECIDE. Not how fast a dive travels, which is
// `swarm/dive-speed`, nor where it goes, which is
// `swarm/dive-bends-toward-player` — only that one drone held its centre and the
// other did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { DIVE_SPEED } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  framesFor,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the two Shards are posed: the same row, far enough apart to be alone. */
const HELD_AT = { x: 300, y: 200 } as const;
const MOVER_AT = { x: 1000, y: 200 } as const;

/** How long the field is driven for while the gate is held off, in seconds. */
const DRIVE_SECONDS = 1;

/**
 * How far the held drone's centre may sit from where it was posed, in decimal
 * digits for `assertCloseTo` — six, which is half a millionth of a logical unit.
 *
 * A hold is a hold: the specification says the drone "holds its exact center", so
 * this is the float noise of reading a number back and not an allowance for
 * drift. A build integrating even a hundredth of `DIVE_SPEED` against the second
 * below misses it by three units.
 */
const HOLD_DIGITS = 6;

/**
 * How far the ungated drone must have travelled, in logical units.
 *
 * Ten. `specs/swarm.md` flies a dive at `DIVE_SPEED` (`300`) units per second,
 * which is three hundred units of path over the second below, so this is a
 * thirtieth of the figure — set where "it never moved" ends rather than at the
 * speed itself, which `swarm/dive-speed` grades. A swooping path that curved back
 * on itself would still leave far more than this between its ends.
 */
const MOVED_MIN = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds a gated drone at the centre it was posed at, while an ungated one flies", async () => {
  await startPosed(h);

  const held = await poseDrone(h, "shard", HELD_AT.x, HELD_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: false,
    fire: false,
  });
  const mover = await poseDrone(h, "shard", MOVER_AT.x, MOVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
    fire: false,
  });

  const posed = await h.snapshot();
  const heldBefore = requireDrone(
    posed,
    held,
    "the drone with travel gated off",
  );
  const moverBefore = requireDrone(posed, mover, "the drone with travel on");

  await h.advance(framesFor(DRIVE_SECONDS));
  // Before the assertions, so a failing gate still leaves the picture of the held
  // drone beside the one that flew.
  await captureStill(h, "held");

  const driven = await h.snapshot();
  const heldAfter = requireDrone(
    driven,
    held,
    "the drone with travel gated off",
  );
  assertCloseTo(
    heldAfter.x,
    heldBefore.x,
    HOLD_DIGITS,
    `the gated drone's centre x after ${DRIVE_SECONDS} s of game time with ` +
      `setDroneTravel(${held}, false) held — a dive would carry it ` +
      `DIVE_SPEED (${DIVE_SPEED}) units in that second (specs/swarm.md)`,
  );
  assertCloseTo(
    heldAfter.y,
    heldBefore.y,
    HOLD_DIGITS,
    `the gated drone's centre y after ${DRIVE_SECONDS} s of game time with ` +
      `setDroneTravel(${held}, false) held`,
  );

  const moverAfter = requireDrone(driven, mover, "the drone with travel on");
  assertGreaterThan(
    distance(moverAfter, moverBefore),
    MOVED_MIN,
    `how far the drone posed into the same dive WITH travel on covered over ` +
      `that second — without it, a drone that held still while the gate was ` +
      `off says nothing about the gate`,
  );
});
