// instrumentation/poses-read-back — every pose the item names is reported back
// by the snapshot.
//
// THE RULE. `specs/instrumentation.md`, Snapshot shape: "Every field an
// operation can set is present, so every operation is verifiable by setting a
// value and reading it back." This item is that verification, and it is the
// rule the whole surface is built to: each operation sets what its own row
// names, and `snapshot` reports it.
//
// NO FRAME RUNS BETWEEN A POSE AND ITS READING. Under this engine a pose acts
// on the live game at the moment of the call and a reading is built at the call
// (`specs/instrumentation.md`), so what comes back is the pose alone and never a
// tick of the game's own rules laid over it. That is also why the values below
// can be read back on any screen the sweep happens to be on.
//
// EVERY VALUE IS A DISTINCTIVE ONE. A build that reports a constant, or reports
// the field beside the one it was handed, has to produce a DIFFERENT number
// from the one posed — so `menuIndex` is `2` rather than `0`, the score is
// `4321` rather than a round figure, the ship's position and velocity have
// distinct x and y (and the velocity a negative component, so a build that
// dropped a sign reads differently), and the angle is neither zero nor
// `FACE_UP`.
//
// EVERY BOOLEAN IS POSED BOTH WAYS. The two world gates, the ship's contact
// gate and the saucer's three faculties each start ON (`specs/instrumentation.md`
// for the gates, and a saucer arrives with all three on), so a build that
// reports a hardcoded `true` would pass a check that only ever posed `true`.
// Each is therefore taken to `false`, read back, and returned to `true` and read
// back again.
//
// EACH SWITCH IS ALSO SHOWN TO BE ITS OWN. `specs/instrumentation.md` gives the
// saucer three separate faculties and says of each that it gates that one thing
// "alone", so posing one is read back beside the other two, which must not have
// moved. Two more one-way rules are read the same way: `setShipAngle` "changes
// no velocity", and `setShipPosition` and `setShipVelocity` are separate
// operations.
//
// MUTE IS NOT IN THE LIST, and deliberately. There is no `setMuted` under any
// engine: `muted` is the runtime's own bit, reached through the `mute` action
// (`specs/controls.md`) and reported by the snapshot.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { QUIET_CORNER, QUIET_CORNER_OPPOSITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseRock,
  poseSaucer,
  requireRock,
  requireSaucer,
  startPlaying,
  type Harness,
} from "../harness";
import type { Screen } from "../surface";

/** The five screens, every one of which is posed and read back. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "gameover",
];

/** The distinctive values every scalar pose is made with. */
const POSED = {
  menuIndex: 2,
  score: 4321,
  lives: 2,
  wave: 7,
  waveBanner: 0.75,
  shipX: 321,
  shipY: 654,
  shipVx: -123,
  shipVy: 234,
  /** Neither `0` nor `FACE_UP`, so no default reads as a pass. */
  shipAngle: 1.25,
  invuln: 1.75,
  /** Whole simulation ticks: `specs/instrumentation.md` fixes the unit. */
  fireCooldown: 13,
  rockVx: -77,
  rockVy: 44,
  /**
   * The saucer's posed velocity, in units per second.
   *
   * Neither the cruise `(SAUCER_SPEED, 0)` `addSaucer` brings a saucer on at nor
   * anything a weave reroll could produce, so no arrival and no decision of the
   * craft's own can leave this pair on the field by accident
   * (`specs/saucer.md`).
   */
  saucerVx: -33,
  saucerVy: 22,
} as const;

/**
 * How closely a posed number must read back, in decimal places.
 *
 * A pose is stored and reported, not computed, so the two are the same double;
 * six places is a double's own precision over figures of this size and is
 * nothing looser. Whole-number poses are compared exactly.
 */
const READ_BACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports back the screen and the menu index", () => {
  startPlaying(h);

  for (const screen of SCREENS) {
    h.debug.setScreen(screen);
    assertEqual(h.snapshot().screen, screen, `setScreen(${screen})`);
  }

  h.debug.setMenuIndex(POSED.menuIndex);
  assertEqual(
    h.snapshot().menuIndex,
    POSED.menuIndex,
    "setMenuIndex reads back",
  );
});

it("reports back the run's figures: score, lives, wave and banner", () => {
  startPlaying(h);

  h.debug.setScore(POSED.score);
  assertEqual(h.snapshot().score, POSED.score, "setScore reads back");

  h.debug.setLives(POSED.lives);
  assertEqual(h.snapshot().lives, POSED.lives, "setLives reads back");

  h.debug.setWave(POSED.wave);
  assertEqual(h.snapshot().wave, POSED.wave, "setWave reads back");

  h.debug.setWaveBanner(POSED.waveBanner);
  assertCloseTo(
    h.snapshot().waveBanner,
    POSED.waveBanner,
    READ_BACK_DIGITS,
    "setWaveBanner reads back, in seconds",
  );
});

it("reports back the ship's position, velocity, facing, grace and gun gate", () => {
  startPlaying(h);

  h.debug.setShipPosition(POSED.shipX, POSED.shipY);
  const placed = h.snapshot().ship;
  assertEqual(placed.x, POSED.shipX, "setShipPosition reads back: x");
  assertEqual(placed.y, POSED.shipY, "setShipPosition reads back: y");

  h.debug.setShipVelocity(POSED.shipVx, POSED.shipVy);
  const moving = h.snapshot().ship;
  assertEqual(moving.vx, POSED.shipVx, "setShipVelocity reads back: vx");
  assertEqual(moving.vy, POSED.shipVy, "setShipVelocity reads back: vy");
  assertEqual(moving.x, POSED.shipX, "setShipVelocity moves no position: x");
  assertEqual(moving.y, POSED.shipY, "setShipVelocity moves no position: y");

  h.debug.setShipAngle(POSED.shipAngle);
  const turned = h.snapshot().ship;
  assertCloseTo(
    turned.angle,
    POSED.shipAngle,
    READ_BACK_DIGITS,
    "setShipAngle reads back, in radians",
  );
  // "It changes no velocity" (specs/instrumentation.md, The ship).
  assertEqual(turned.vx, POSED.shipVx, "setShipAngle changes no velocity: vx");
  assertEqual(turned.vy, POSED.shipVy, "setShipAngle changes no velocity: vy");

  h.debug.setShipInvuln(POSED.invuln);
  assertCloseTo(
    h.snapshot().ship.invuln,
    POSED.invuln,
    READ_BACK_DIGITS,
    "setShipInvuln reads back, in seconds",
  );

  h.debug.setFireCooldown(POSED.fireCooldown);
  assertEqual(
    h.snapshot().ship.fireCooldown,
    POSED.fireCooldown,
    "setFireCooldown reads back, in whole ticks",
  );
});

it("reports back a rock's posed velocity", () => {
  startPlaying(h);
  const id = poseRock(h, "medium", QUIET_CORNER.x, QUIET_CORNER.y);

  h.debug.setRockVelocity(id, POSED.rockVx, POSED.rockVy);
  const rock = requireRock(h.snapshot(), id, "the posed rock");
  assertEqual(rock.vx, POSED.rockVx, "setRockVelocity reads back: vx");
  assertEqual(rock.vy, POSED.rockVy, "setRockVelocity reads back: vy");
  assertEqual(rock.x, QUIET_CORNER.x, "setRockVelocity moves no position: x");
  assertEqual(rock.y, QUIET_CORNER.y, "setRockVelocity moves no position: y");
});

it("reports back the saucer's posed velocity", () => {
  startPlaying(h);
  poseSaucer(h, QUIET_CORNER_OPPOSITE.x, QUIET_CORNER_OPPOSITE.y);

  h.debug.setSaucerVelocity(POSED.saucerVx, POSED.saucerVy);
  const saucer = requireSaucer(h.snapshot(), "the posed saucer");
  assertEqual(saucer.vx, POSED.saucerVx, "setSaucerVelocity reads back: vx");
  assertEqual(saucer.vy, POSED.saucerVy, "setSaucerVelocity reads back: vy");
  assertEqual(
    saucer.x,
    QUIET_CORNER_OPPOSITE.x,
    "setSaucerVelocity moves no position: x",
  );
  assertEqual(
    saucer.y,
    QUIET_CORNER_OPPOSITE.y,
    "setSaucerVelocity moves no position: y",
  );
});

it("reports back the two world gates and the ship's contact gate, both ways", () => {
  startPlaying(h);

  for (const enabled of [false, true]) {
    h.debug.setWaveSpawning(enabled);
    assertEqual(
      h.snapshot().waveSpawning,
      enabled,
      `setWaveSpawning(${enabled}) reads back`,
    );

    h.debug.setSaucerSpawning(enabled);
    assertEqual(
      h.snapshot().saucerSpawning,
      enabled,
      `setSaucerSpawning(${enabled}) reads back`,
    );

    h.debug.setShipCollision(enabled);
    assertEqual(
      h.snapshot().ship.collision,
      enabled,
      `setShipCollision(${enabled}) reads back`,
    );
  }
});

it("reports back each of the saucer's three faculties, both ways and alone", async () => {
  startPlaying(h);
  poseSaucer(h, QUIET_CORNER_OPPOSITE.x, QUIET_CORNER_OPPOSITE.y);

  const faculties = ["mind", "gun", "travel"] as const;
  const pose = {
    mind: (enabled: boolean) => h.debug.setSaucerMind(enabled),
    gun: (enabled: boolean) => h.debug.setSaucerGun(enabled),
    travel: (enabled: boolean) => h.debug.setSaucerTravel(enabled),
  };

  // A saucer arrives with all three on (specs/instrumentation.md, addSaucer).
  const arrived = requireSaucer(h.snapshot(), "the posed saucer");
  for (const faculty of faculties) {
    assertEqual(arrived[faculty], true, `a saucer arrives with ${faculty} on`);
  }

  // What all three are expected to read at each step of the sweep, so the two a
  // pose did not name are checked as well as the one it did.
  const expected: Record<(typeof faculties)[number], boolean> = {
    mind: true,
    gun: true,
    travel: true,
  };

  for (const enabled of [false, true]) {
    for (const posed of faculties) {
      pose[posed](enabled);
      expected[posed] = enabled;

      const saucer = requireSaucer(h.snapshot(), "the posed saucer");
      for (const faculty of faculties) {
        assertEqual(
          saucer[faculty],
          expected[faculty],
          faculty === posed
            ? `posing ${faculty} ${enabled ? "on" : "off"} reads back`
            : // Each gates its own faculty "alone"
              // (specs/instrumentation.md), so the two a pose did not name
              // are wherever the sweep last left them.
              `posing ${posed} leaves ${faculty} as it stood`,
        );
      }
    }
  }

  // The fully posed game every value above was read back from.
  h.debug.setScreen("playing");
  await h.advance(1);
  captureStill(h, "posed");
});
