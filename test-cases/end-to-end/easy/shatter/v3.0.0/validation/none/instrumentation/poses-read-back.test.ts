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
// a pure read of the state, so the value a pose wrote must be there the instant it
// is asked for. Advancing first would let a timer run the reading down and would
// grade the tick rather than the pose.
//
// EVERY VALUE IS DISTINGUISHING. No pose below writes a value the field could
// plausibly be holding already: the score is not zero, the lives are not three, the
// wave is not one, the angle is not the facing a life begins on, and every boolean
// is posed in BOTH directions, so a build that reports a hard-coded `true` fails on
// the leg that asked for `false`. A wrong model therefore reads as a different
// number rather than as the number that happened to be there.
//
// MUTE IS NOT HERE, AND ITS ABSENCE IS THE POINT. `specs/instrumentation.md` gives
// the surface no `setMuted`: mute belongs to the runtime layer and is reached the
// way a player reaches it, through the key `specs/controls.md` binds. All that is
// asked of the snapshot is that it reports the bit.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { DEG, SAUCER_FIRE_INTERVAL, SAUCER_WEAVE_INTERVAL } from "../constants";
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

/** The cadence's posed due, in seconds: neither the first delay nor a gap. */
const POSED_DUE = 7.5;

/** The posed draws: each a value the draw could decide, and none a default. */
const POSED_ENTRY_ROW = 333;
const POSED_AIM = 0.05;
const POSED_ROCK_SPEED = 95;

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
 * `specs/instrumentation.md` puts no arithmetic between the two, so the only thing
 * that may separate them is the rounding of a value that made a round trip through
 * the page's own JSON.
 */
const READ_BACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every value the surface poses", async () => {
  await startPlaying(h);

  // The run.
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setWave(POSED_WAVE);
  await h.debug.setWaveBanner(POSED_BANNER);

  // The ship.
  await h.debug.setShipPosition(POSED_SHIP.x, POSED_SHIP.y);
  await h.debug.setShipVelocity(POSED_SHIP_VELOCITY.vx, POSED_SHIP_VELOCITY.vy);
  await h.debug.setShipAngle(POSED_ANGLE);
  await h.debug.setShipInvuln(POSED_INVULN);
  await h.debug.setFireCooldown(POSED_COOLDOWN);

  // One rock, posed at rest and then given a velocity of its own.
  const rockId = await poseRock(
    h,
    "medium",
    ROCK_PLACE.x,
    ROCK_PLACE.y,
    POSED_ROCK_VELOCITY.vx,
    POSED_ROCK_VELOCITY.vy,
  );

  // And a saucer with all three faculties on, which is the opposite of the state
  // the second leg below poses them into.
  const saucerId = await poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y, {
    mind: true,
    gun: true,
    travel: true,
  });

  await h.debug.setSaucerVelocity(
    POSED_SAUCER_VELOCITY.vx,
    POSED_SAUCER_VELOCITY.vy,
  );
  // Up, which is the opposite of the `1` addSaucer brings a saucer on with.
  await h.debug.setSaucerWeave(-1);

  // The cadence's due, and the five posed draws.
  await h.debug.setSaucerDue(POSED_DUE);
  await h.debug.setNextSaucerEdge("right");
  await h.debug.setNextSaucerRow(POSED_ENTRY_ROW);
  await h.debug.setNextSaucerAim(POSED_AIM);
  await h.debug.setNextRockSpeed(POSED_ROCK_SPEED);
  await h.debug.setNextRecycleEdge("top");

  await captureStill(h, "posed");
  const s = await h.snapshot();

  assertCloseTo(s.saucerDue, POSED_DUE, READ_BACK_DIGITS, "setSaucerDue");
  assertEqual(s.nextSaucerEdge, "right", "setNextSaucerEdge");
  assertCloseTo(
    s.nextSaucerRow ?? Number.NaN,
    POSED_ENTRY_ROW,
    READ_BACK_DIGITS,
    "setNextSaucerRow",
  );
  assertCloseTo(
    s.nextSaucerAim ?? Number.NaN,
    POSED_AIM,
    READ_BACK_DIGITS,
    "setNextSaucerAim",
  );
  assertCloseTo(
    s.nextRockSpeed ?? Number.NaN,
    POSED_ROCK_SPEED,
    READ_BACK_DIGITS,
    "setNextRockSpeed",
  );
  assertEqual(s.nextRecycleEdge, "top", "setNextRecycleEdge");

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

  const rock = requireRock(s, rockId, "the rock whose velocity was posed");
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

  const saucer = requireSaucer(s, "the saucer whose faculties were posed");
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
  assertEqual(saucer.mind, true, "setSaucerMind(true)");
  assertEqual(saucer.gun, true, "setSaucerGun(true)");
  assertEqual(saucer.travel, true, "setSaucerTravel(true)");
  assertEqual(saucer.weave, -1, "setSaucerWeave(-1)");

  // The three clocks `addSaucer` fixes on arrival, read before a tick has run:
  // all three move once the game is stepped, so a reading taken after an advance
  // would grade the tick rather than the arrival (specs/instrumentation.md).
  assertCloseTo(
    saucer.fireClock,
    SAUCER_FIRE_INTERVAL,
    READ_BACK_DIGITS,
    "addSaucer brings it on with a full fire clock",
  );
  assertCloseTo(
    saucer.weaveClock,
    SAUCER_WEAVE_INTERVAL,
    READ_BACK_DIGITS,
    "addSaucer brings it on with a full weave clock",
  );
  assertCloseTo(
    saucer.age,
    0,
    READ_BACK_DIGITS,
    "addSaucer brings it on with its lifetime clock at zero",
  );

  // The mute bit is reported, and no operation sets it.
  assertEqual(typeof s.muted, "boolean", "muted");

  // Nothing any of those poses touched spawned or cleared anything.
  assertLength(s.rocks, 1, "the rock roster the poses left");
  assertLength(s.bullets, 0, "the bullet roster the poses left");
});

it("reports every gate and faculty in both directions", async () => {
  // `startPlaying` opens with the two world gates and the ship's contact gate shut,
  // so each is posed OPEN first and then SHUT again: a build that reports a
  // hard-coded value for one of them fails on whichever leg disagrees with it.
  await startPlaying(h);
  const saucerId = await poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y, {
    mind: false,
    gun: false,
    travel: false,
  });

  const shut = await h.snapshot();
  assertEqual(shut.waveSpawning, false, "setWaveSpawning(false)");
  assertEqual(shut.saucerSpawning, false, "setSaucerSpawning(false)");
  assertEqual(shut.ship.collision, false, "setShipCollision(false)");
  const held = requireSaucer(shut, "the saucer posed with its faculties off");
  assertEqual(held.id, saucerId, "the saucer that was added");
  assertEqual(held.mind, false, "setSaucerMind(false)");
  assertEqual(held.gun, false, "setSaucerGun(false)");
  assertEqual(held.travel, false, "setSaucerTravel(false)");

  await h.debug.setWaveSpawning(true);
  await h.debug.setSaucerSpawning(true);
  await h.debug.setShipCollision(true);
  await h.debug.setSaucerMind(true);
  await h.debug.setSaucerGun(true);
  await h.debug.setSaucerTravel(true);
  await h.debug.setSaucerWeave(1);

  const open = await h.snapshot();
  assertEqual(open.waveSpawning, true, "setWaveSpawning(true)");
  assertEqual(open.saucerSpawning, true, "setSaucerSpawning(true)");
  assertEqual(open.ship.collision, true, "setShipCollision(true)");
  const running = requireSaucer(open, "the saucer posed with its faculties on");
  assertEqual(running.mind, true, "setSaucerMind(true)");
  assertEqual(running.gun, true, "setSaucerGun(true)");
  assertEqual(running.travel, true, "setSaucerTravel(true)");
  assertEqual(running.weave, 1, "setSaucerWeave(1)");
});

it("reports the screen and the menu entry it poses", async () => {
  // The menu entry is posed on the title screen, which is the one screen
  // `specs/ui.md` gives a menu with a second entry to highlight.
  await startPlaying(h);
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(POSED_MENU_INDEX);

  const title = await h.snapshot();
  assertEqual(title.screen, "title", "setScreen(title)");
  assertEqual(title.menuIndex, POSED_MENU_INDEX, "setMenuIndex");

  // And each of the other four screens reads back as itself, so a build that
  // reports one screen for another is named here rather than in whichever
  // scenario happened to pose it.
  for (const screen of ["howto", "paused", "gameover", "playing"] as const) {
    await h.debug.setScreen(screen);
    assertEqual((await h.snapshot()).screen, screen, `setScreen(${screen})`);
  }
});
