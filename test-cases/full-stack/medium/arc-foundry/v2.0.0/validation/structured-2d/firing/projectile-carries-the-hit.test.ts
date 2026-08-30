// firing/projectile-carries-the-hit — the damage rides the shot rather than the trigger.
//
// specs/components.md fixes where the damage lands: "Every shot is a traveling
// projectile, and the projectile carries the hit ... When the projectile comes
// within `PROJECTILE_HIT_R` (`6`) of that position it applies its damage and any
// ability the shot carries, and is removed."
//
// So a build that removes health the moment it fires plays a completely different
// game — a maze the Load can never outrun — and this is the point that separates
// the two. One shot is fired at a held unit near the far edge of a Capacitor's
// radius and the unit's health is sampled every frame of the flight. Three
// readings decide it: the health never moves while a projectile is in flight, the
// frame the health moves is a frame with no projectile left on it, and the health
// moved by exactly one shot's damage.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { PROJECTILE_HIT_R } from "../../src/constants";
import {
  captureReplay,
  componentDamage,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  ticks,
  unitById,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Near the far edge of the Scrap Capacitor's `100`, so the flight is long. */
const TARGET_RANGE = 95;

/** How long the shot is waited for and flown, in seconds. */
const PATIENCE = 4;

/** One frame of the flight, as the check saw it. */
interface Frame {
  inFlight: number;
  hp: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes no health until the shot arrives, and removes the shot with it", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  const target = parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });
  const startHp = unitById(h.snapshot(), target).hp;

  const flight = await captureReplay(h, "hit", async () => {
    const frames: Frame[] = [];
    await h.until(
      (s) => {
        frames.push({
          inFlight: s.projectiles.length,
          hp: unitById(s, target).hp,
        });
        return unitById(s, target).hp < startHp;
      },
      { maxFrames: ticks(PATIENCE), poll: 1 },
    );
    return frames;
  });

  const landed = flight.findIndex((frame) => frame.hp < startHp);
  assertGreaterThan(
    landed,
    -1,
    `the shot landing within ${PATIENCE}s on a unit ${TARGET_RANGE} from the ` +
      `centre`,
  );

  // The health held for the whole flight.
  const early = flight
    .slice(0, landed)
    .filter((frame) => frame.inFlight > 0 && frame.hp !== startHp);
  assertEqual(
    early.length,
    0,
    "frames on which health moved while a projectile was still in flight",
  );

  const opened = flight.findIndex((frame) => frame.inFlight > 0);
  assertGreaterThan(
    opened,
    -1,
    "a frame with the shot in flight before it landed",
  );
  assertGreaterThan(
    landed,
    opened,
    `the frame the damage landed on, counted from the frame the shot appeared ` +
      `(${TARGET_RANGE} units of travel at ${PROJECTILE_HIT_R} of hit radius ` +
      `is many frames of flight, not none)`,
  );

  // The projectile was removed on the update that applied its damage.
  assertEqual(
    flight[landed]!.inFlight,
    0,
    "projectiles still in flight on the frame the damage landed",
  );
  assertCloseTo(
    startHp - flight[landed]!.hp,
    componentDamage("capacitor", 1),
    6,
    "the health one shot removed (specs/components.md)",
  );
});
