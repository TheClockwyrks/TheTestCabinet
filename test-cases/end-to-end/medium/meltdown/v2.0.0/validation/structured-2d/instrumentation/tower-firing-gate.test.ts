// Meltdown — instrumentation/tower-firing-gate: firing off holds a tower's guns.
//
// `specs/instrumentation.md`, the gate table: `firingEnabled` holds "The tower's
// targeting and firing: acquiring a target, resolving a shot, the damage and
// splash the shot deals, the slow a Rime applies, and the `heatPerShot` the shot
// adds."
//
// FOUR CONSEQUENCES, READ IN BOTH DIRECTIONS. Off, the tower reports `firing`
// false, resolves no shot, removes no hp and gains no heat; on, all four change.
// Both legs are needed and neither would do alone: the held leg passes on a build
// whose guns never work at all, and the running leg passes on a build that
// ignores the gate.
//
// THE HELD LEG IS POSED AT HEAT `0`, which is what makes "gains no heat" a
// reading rather than an argument. `specs/heat.md` scales every cooling term by
// the tower's own heat, so a tower at `0` in open air neither gains nor loses
// while its thermal model runs exactly as an idle tower's does — and the only
// thing that could move its heat is the `heatPerShot` the gate is holding. The
// thermal model is left running on purpose: that it goes on running is
// `tower-firing-gate-leaves-the-thermal-model`'s point, and pinning it here would
// pose away the very thing that makes this reading honest.
//
// THE MARK IS IN RANGE, STILL, AND UNKILLABLE. `specs/combat.md` measures range
// from the footprint's centre, so the mark sits three tiles from the anchor, well
// inside the Arc's `6.0`; its motion is off so it cannot walk out of range or
// leak; and its hp is far above anything the drive removes, so the running leg
// reads a subtraction rather than a death — a kill would end the firing halfway
// through and make "no shot" and "one shot" hard to tell apart.
//
// THE TWO LEGS ARE DRIVEN ONE AFTER THE OTHER ON A FLOOR RESET BETWEEN THEM,
// rather than side by side, so each leaves a still of its own for the reviewer
// and neither tower can reach the other's mark.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { poseMarkFor, QUIET_SITE, readTower } from "./ground";

/** The gun posed, at the heat a placed tower opens on. */
const TYPE = "arc";
const POSED_HEAT = 0;

/** The game time each leg is driven for, in seconds. */
const WINDOW = 1;

/**
 * How many shots that window must hold, from `specs/combat.md`'s fire clock:
 * one shot each time the accumulator reaches `1 / fireRate`, the first a whole
 * interval after the target is acquired.
 */
const ARC = TOWER_DEFS[TYPE];
const SHOTS_IN_WINDOW = Math.floor(
  WINDOW * (ARC.kind === "emitter" ? ARC.fireRate : 0),
);

/**
 * How far a held reading may sit from zero, in the unit of what is read.
 *
 * The gate holds the faculty outright, so a conformant build reports exactly
 * zero damage and exactly the heat it was posed at; the allowance is for the
 * float a build stores them in and for nothing else. It is many orders below the
 * whole hp a single shot removes.
 */
const HELD_TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** One gun at the quiet anchor with a durable, stationary mark beside it. */
function poseGunAndMark(): number {
  startRun(h);
  h.debug.addTower(TYPE, QUIET_SITE.col, QUIET_SITE.row, 0);
  const id = h.snapshot().towers[0].id;
  h.debug.setTowerHeat(id, POSED_HEAT);
  poseMarkFor(h, QUIET_SITE);
  return id;
}

it("holds the guns off, and lets them run when the gate is opened", async () => {
  assertGreaterThan(
    SHOTS_IN_WINDOW,
    0,
    "precondition: the window is long enough for the Arc's rate to land a shot",
  );

  // ---- The gate closed ---------------------------------------------------
  const held = poseGunAndMark();
  h.debug.setTowerFiring(held, false);
  await h.advance(ticksFor(WINDOW));
  captureStill(h, "gated");
  const gated = readTower(h.snapshot(), held, "the tower with its guns held");

  assertEqual(gated.firing, false, "firing, with the gate closed");
  assertLessThan(
    gated.damageDealt,
    HELD_TOLERANCE,
    "the hp a held tower removed over a second",
  );
  assertEqual(gated.kills, 0, "the kills a held tower took over a second");
  assertLessThan(
    Math.abs(gated.heat - POSED_HEAT),
    HELD_TOLERANCE,
    "the heat a held tower gained over a second, posed at 0 in open air",
  );

  // ---- The gate open, on an identical floor ------------------------------
  const running = poseGunAndMark();
  h.debug.setTowerFiring(running, true);
  await h.advance(ticksFor(WINDOW));
  captureStill(h, "firing");
  const firing = readTower(h.snapshot(), running, "the same tower firing");

  assertEqual(firing.firing, true, "firing, with the gate open");
  assertGreaterThan(
    firing.damageDealt,
    0,
    "the hp a firing tower removed over a second",
  );
  assertGreaterThan(
    firing.heat,
    POSED_HEAT,
    "the heat a firing tower reached from 0 over a second",
  );
});
