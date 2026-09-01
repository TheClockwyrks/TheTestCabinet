// instrumentation/poses-read-back — every pose the surface carries is reported by
// `snapshot`, so setting a value and reading it back really does verify the
// operation.
//
// THIS IS THE RULE THE WHOLE SURFACE IS BUILT TO. `specs/instrumentation.md` states
// it directly: "Every field an operation can set is present, so every operation is
// verifiable by setting a value and reading it back." Every other item in this
// group, and most of the scenarios in every other group, poses a field and then
// reads the game through the snapshot — so a build whose `setScore` writes the
// score but whose snapshot reports a stale copy of it makes a liar of every one of
// them. This is the item that names that fault once, in one place.
//
// NOTHING IS ADVANCED BETWEEN A POSE AND ITS READING. `snapshot()` is specified as
// a pure read of the state, and under this engine a pose is a transition the
// harness runs through `engine.apply` — so the state the reading is taken against
// IS the state the pose returned. Advancing first would let a timer run the reading
// down and would grade the tick rather than the pose.
//
// EVERY VALUE IS DISTINGUISHING. No pose below writes a value the field could
// plausibly be holding already: the score is not zero, the lives are not three, the
// wave is not one, the angle is not the facing a life begins on, and every boolean
// is posed in BOTH directions, so a build that reports a hard-coded `true` fails on
// the leg that asked for `false`. A wrong model therefore reads as a different
// number rather than as the number that happened to be there.
//
// MUTE IS NOT HERE, AND ITS ABSENCE IS THE POINT. `specs/instrumentation.md` gives
// the surface no `setMuted`: muting is the engine's and is reached the way a player
// reaches it, through the action `specs/controls.md` binds. All that is asked of
// the snapshot is that it reports the bit.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../../src/constants";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  poseSaucer,
  rockById,
  startPlaying,
  theSaucer,
  type Harness,
} from "../harness";

/** The score posed: no multiple of anything, and nothing a fresh run reports. */
const POSED_SCORE = 4321;
/** The ships posed: more than the three a new game begins with. */
const POSED_LIVES = 5;
/** The wave posed: not the one `startPlaying` left, and not zero. */
const POSED_WAVE = 7;
/** The banner posed, in seconds: a fraction, so a build storing ticks is caught. */
const POSED_BANNER = 0.75;
/** The menu entry posed: the second one, which `TITLE_ITEMS` has. */
const POSED_MENU_INDEX = 1;

/** Where the ship is posed: on the field, clear of the star and of its safe point. */
const POSED_SHIP = { x: 300, y: 200 } as const;
/** The ship's posed velocity, in units per second. */
const POSED_SHIP_VELOCITY = { vx: 55, vy: -35 } as const;
/** The ship's posed facing: 40 degrees clockwise from `+x`, in radians. */
const POSED_ANGLE = 40 * DEG;
/** The ship's posed respawn grace, in seconds. */
const POSED_INVULN = 1.25;
/** The ship's posed fire gate, in whole ticks. */
const POSED_COOLDOWN = 13;

/** Where the rock whose velocity is posed stands. */
const ROCK_PLACE = { x: 260, y: 620 } as const;
/** The rock's posed velocity, in units per second. */
const POSED_ROCK_VELOCITY = { vx: 77, vy: -44 } as const;

/** Where the saucer whose faculties are posed hangs. */
const SAUCER_PLACE = { x: 1000, y: 140 } as const;

/**
 * The saucer's posed velocity, in units per second.
 *
 * Neither the cruise `(SAUCER_SPEED, 0)` `addSaucer` brings a saucer on at nor
 * anything a weave reroll could produce, so no arrival and no decision of the
 * craft's own can leave this pair on the field by accident (`specs/saucer.md`).
 */
const POSED_SAUCER_VELOCITY = { vx: -33, vy: 22 } as const;

/**
 * The decimal places a posed number is read back to.
 *
 * Six, which is to say exactly. A pose writes a number and a read returns it;
 * `specs/instrumentation.md` puts no arithmetic between the two, so nothing but
 * floating-point rounding can separate them.
 */
const READ_BACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every value the surface poses", () => {
  startPlaying(h);

  // The run.
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  h.debug.setWaveBanner(POSED_BANNER);

  // The ship.
  h.debug.setShipPosition(POSED_SHIP.x, POSED_SHIP.y);
  h.debug.setShipVelocity(POSED_SHIP_VELOCITY.vx, POSED_SHIP_VELOCITY.vy);
  h.debug.setShipAngle(POSED_ANGLE);
  h.debug.setShipInvuln(POSED_INVULN);
  h.debug.setFireCooldown(POSED_COOLDOWN);

  // One rock, posed at rest and then given a velocity of its own.
  const rockId = poseRock(
    h,
    "medium",
    ROCK_PLACE.x,
    ROCK_PLACE.y,
    POSED_ROCK_VELOCITY.vx,
    POSED_ROCK_VELOCITY.vy,
  );

  // And a saucer, which `addSaucer` brings on with all three faculties running —
  // the opposite of the state the second leg below poses them into.
  const saucerId = poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y);
  h.debug.setSaucerVelocity(POSED_SAUCER_VELOCITY.vx, POSED_SAUCER_VELOCITY.vy);

  captureStill(h, "posed");
  const s = h.snapshot();

  assertEqual(s.score, POSED_SCORE, "setScore");
  assertEqual(s.lives, POSED_LIVES, "setLives");
  assertEqual(s.wave, POSED_WAVE, "setWave");
  assertCloseTo(s.waveBanner, POSED_BANNER, READ_BACK_DIGITS, "setWaveBanner");

  assertCloseTo(s.ship.x, POSED_SHIP.x, READ_BACK_DIGITS, "setShipPosition x");
  assertCloseTo(s.ship.y, POSED_SHIP.y, READ_BACK_DIGITS, "setShipPosition y");
  assertCloseTo(
    s.ship.vx,
    POSED_SHIP_VELOCITY.vx,
    READ_BACK_DIGITS,
    "setShipVelocity vx",
  );
  assertCloseTo(
    s.ship.vy,
    POSED_SHIP_VELOCITY.vy,
    READ_BACK_DIGITS,
    "setShipVelocity vy",
  );
  assertCloseTo(s.ship.angle, POSED_ANGLE, READ_BACK_DIGITS, "setShipAngle");
  assertCloseTo(s.ship.invuln, POSED_INVULN, READ_BACK_DIGITS, "setShipInvuln");
  assertEqual(s.ship.fireCooldown, POSED_COOLDOWN, "setFireCooldown");

  const rock = rockById(s, rockId, "the rock whose velocity was posed");
  assertCloseTo(
    rock.vx,
    POSED_ROCK_VELOCITY.vx,
    READ_BACK_DIGITS,
    "setRockVelocity vx",
  );
  assertCloseTo(
    rock.vy,
    POSED_ROCK_VELOCITY.vy,
    READ_BACK_DIGITS,
    "setRockVelocity vy",
  );

  const saucer = theSaucer(s, "the saucer whose faculties were posed");
  assertEqual(saucer.id, saucerId, "the saucer that was added");
  assertCloseTo(
    saucer.vx,
    POSED_SAUCER_VELOCITY.vx,
    READ_BACK_DIGITS,
    "setSaucerVelocity vx",
  );
  assertCloseTo(
    saucer.vy,
    POSED_SAUCER_VELOCITY.vy,
    READ_BACK_DIGITS,
    "setSaucerVelocity vy",
  );
  assertEqual(saucer.mind, true, "addSaucer brings its mind on");
  assertEqual(saucer.gun, true, "addSaucer brings its gun on");
  assertEqual(saucer.travel, true, "addSaucer brings its travel on");

  // The mute bit is reported, and no operation sets it.
  assertEqual(typeof s.muted, "boolean", "muted");

  // Nothing any of those poses touched spawned or cleared anything.
  assertLength(s.rocks, 1, "the rock roster the poses left");
  assertLength(s.bullets, 0, "the bullet roster the poses left");
});

it("reports every gate and faculty in both directions", () => {
  // `startPlaying` opens with the two world gates and the ship's contact gate
  // shut, and `addSaucer` opens with all three faculties on, so each is posed the
  // OTHER way and then back: a build that reports a hard-coded value for one of
  // them fails on whichever leg disagrees with it.
  startPlaying(h);
  const saucerId = poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);
  h.debug.setSaucerTravel(false);

  const shut = h.snapshot();
  assertEqual(shut.waveSpawning, false, "setWaveSpawning(false)");
  assertEqual(shut.saucerSpawning, false, "setSaucerSpawning(false)");
  assertEqual(shut.ship.collision, false, "setShipCollision(false)");
  const held = theSaucer(shut, "the saucer posed with its faculties off");
  assertEqual(held.id, saucerId, "the saucer that was added");
  assertEqual(held.mind, false, "setSaucerMind(false)");
  assertEqual(held.gun, false, "setSaucerGun(false)");
  assertEqual(held.travel, false, "setSaucerTravel(false)");

  h.debug.setWaveSpawning(true);
  h.debug.setSaucerSpawning(true);
  h.debug.setShipCollision(true);
  h.debug.setSaucerMind(true);
  h.debug.setSaucerGun(true);
  h.debug.setSaucerTravel(true);

  const open = h.snapshot();
  assertEqual(open.waveSpawning, true, "setWaveSpawning(true)");
  assertEqual(open.saucerSpawning, true, "setSaucerSpawning(true)");
  assertEqual(open.ship.collision, true, "setShipCollision(true)");
  const running = theSaucer(open, "the saucer posed with its faculties on");
  assertEqual(running.mind, true, "setSaucerMind(true)");
  assertEqual(running.gun, true, "setSaucerGun(true)");
  assertEqual(running.travel, true, "setSaucerTravel(true)");
});

it("reports the screen and the menu entry it poses", () => {
  // The menu entry is posed on the title screen, which is the one screen
  // `specs/ui.md` gives a menu with a second entry to highlight.
  startPlaying(h);
  h.debug.setScreen("title");
  h.debug.setMenuIndex(POSED_MENU_INDEX);

  const title = h.snapshot();
  assertEqual(title.screen, "title", "setScreen(title)");
  assertEqual(title.menuIndex, POSED_MENU_INDEX, "setMenuIndex");

  // And each of the other four screens reads back as itself, so a build that
  // reports one screen for another is named here rather than in whichever
  // scenario happened to pose it.
  for (const screen of ["howto", "paused", "gameover", "playing"] as const) {
    h.debug.setScreen(screen);
    assertEqual(h.snapshot().screen, screen, `setScreen(${screen})`);
  }
});
