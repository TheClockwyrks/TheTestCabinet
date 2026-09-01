// progression/wave-persists — the live wave survives a lost life intact.
//
// specs/progression.md, of the ready hold: "The wave carries on where it was:
// every drone keeps its phase, its position, and its band, and any dive in
// progress runs on."
//
// SO THE MEASUREMENT IS A BEFORE AND AN AFTER of the whole roster. Every drone
// standing when the life is lost is looked for again once the hold has ended, and
// each is required to be the same drone — the same id, the same kind, the same
// phase, the same slot, the same stored band and the same centre. That is the one
// direction this point grades, and it is where the two wrong models separate: a
// build that rebuilds the stage's wave after a death loses the posed ids and the
// posed slots, and a build that clears the field on a death comes back with an
// empty roster.
//
// WHY THE DRONES ARE PROPS. Each is posed with every faculty off, as `poseDrone`
// defaults them: no travel, no oscillation, no firing. That is isolation rather
// than convenience. specs/field.md has a slotted drone ride the wave's own sway,
// specs/drones.md has a Flux's band clock run, and specs/swarm.md has a dive
// fire, so a drone left with its faculties on would be somewhere else, on another
// band, and possibly shooting at the ship by the time the hold ended, and the
// reading would be about the sway and the shimmer rather than about the wave
// persisting. With locomotion gated, specs/instrumentation.md has the drone "hold
// its exact center and keep its phase", so the rule under test is the only thing
// left that can move any of these fields.
//
// THREE KINDS, at three different slots and on both bands, so a build that keeps
// only the kind it happens to rebuild, or that resets every drone to the band
// `addDrone` gives, is caught.
//
// THE LOSS IS REAL, NOT POSED. Nothing here writes `phase`, `lives` or the
// roster. One enemy bullet of the band opposite the ship's falls into the hull,
// and the build's own contact rules open and close the hold. The drones sit in
// the formation grid, `y` from `140` to `332` (specs/field.md), far above the
// bullet's path from `480` down the ship's lane, so nothing about the wave can
// interfere with the loss and nothing about the loss can reach the wave except
// through the rule under test.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_SPEED,
  READY_HOLD,
  START_LIVES,
  bulletSpeedScale,
} from "../../src/constants";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  poseFormation,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/** The band the ship holds, and the opposite one the bullet carries. */
const SHIP_BAND = "cyan" as const;
const BULLET_BAND = "magenta" as const;

/**
 * How far a drone's centre or slot may have moved across the hold, in logical
 * units.
 *
 * specs/progression.md says the wave keeps its position, and every drone here has
 * its locomotion gated off, so the specification's answer is "not at all". Half a
 * logical unit is a rounding allowance — smaller than the pixel a 1280-wide stage
 * draws at 1:1 — rather than room for movement.
 */
const HOLD_STILL = 0.5;

/** The drones posed into the formation: three kinds, three slots, both bands. */
const WAVE = [
  { kind: "shard", col: 1, row: 0 },
  { kind: "flux", col: 4, row: 1, band: "magenta" },
  { kind: "prism", col: 7, row: 2 },
] as const;

/** How far above the ship's centre the bullet starts, in logical units. */
const DROP_ABOVE = 120;

/** The speed an enemy bullet falls at on stage 1 (specs/stages.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/** Frames the fall is given to open the hold: geometry, plus two of slack. */
const FALL_TICKS = ticksFor(DROP_ABOVE / FALL_SPEED) + 2;

/** Frames the return to `live` is given: twice `READY_HOLD` (`1.3` s). */
const RETURN_TICKS = ticksFor(READY_HOLD * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every drone standing, in its phase and at its slot, after the hold", async () => {
  startPosed(h);
  poseFormation(h, [...WAVE]);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setLives(START_LIVES);
  // The one world gate this point's requirement rests on: without a contact test
  // no life is lost and there is no hold for the wave to survive.
  h.debug.setShipContact(true);

  const before = h.snapshot();
  assertLength(
    before.drones,
    WAVE.length,
    "the drones posed into the formation",
  );

  poseEnemyBulletAbove(h, BULLET_BAND, DROP_ABOVE);

  const opened = await h.until((s) => s.phase === "ready", {
    maxFrames: FALL_TICKS,
  });
  assertEqual(
    opened.hit,
    true,
    `losing a life to a ${BULLET_BAND} bullet dropped ${DROP_ABOVE} units ` +
      `above a ${SHIP_BAND} ship putting the wave into its ready phase inside ` +
      `${FALL_TICKS} frames (${seconds(FALL_TICKS)} s) at ENEMY_BULLET_SPEED ` +
      `${ENEMY_BULLET_SPEED} (specs/progression.md) — without the hold there ` +
      "is nothing for the wave to survive",
  );

  const returned = await h.until((s) => s.phase === "live", {
    maxFrames: RETURN_TICKS,
  });
  captureStill(h, "persisted");
  assertEqual(
    returned.hit,
    true,
    "the wave returning to its live phase when the hold ended, inside " +
      `${seconds(RETURN_TICKS)} s — twice READY_HOLD ${READY_HOLD} ` +
      "(specs/progression.md)",
  );

  const after = returned.snapshot;
  assertLength(
    after.drones,
    before.drones.length,
    "the drones on the field after the ready hold — specs/progression.md: the " +
      "wave carries on where it was. An empty roster is a build that clears " +
      "the field on a death",
  );
  for (const was of before.drones) {
    const where = `drone ${was.id}, the ${was.kind} posed at (${was.slotX}, ${was.slotY})`;
    const now = droneOf(after, was.id);
    assertEqual(now.kind, was.kind, `${where}: its kind across the hold`);
    assertEqual(
      now.phase,
      was.phase,
      `${where}: its phase across the hold (specs/progression.md)`,
    );
    assertEqual(
      now.band,
      was.band,
      `${where}: its stored band across the hold (specs/progression.md)`,
    );
    assertBetween(
      now.slotX,
      was.slotX - HOLD_STILL,
      was.slotX + HOLD_STILL,
      `${where}: its slot's x across the hold (specs/progression.md)`,
    );
    assertBetween(
      now.slotY,
      was.slotY - HOLD_STILL,
      was.slotY + HOLD_STILL,
      `${where}: its slot's y across the hold (specs/progression.md)`,
    );
    assertBetween(
      now.x,
      was.x - HOLD_STILL,
      was.x + HOLD_STILL,
      `${where}: its centre's x across the hold, with its locomotion gated off`,
    );
    assertBetween(
      now.y,
      was.y - HOLD_STILL,
      was.y + HOLD_STILL,
      `${where}: its centre's y across the hold, with its locomotion gated off`,
    );
  }
});
