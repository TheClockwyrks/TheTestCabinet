// Wireworm — instrumentation/poses-read-back: every pose the surface carries is
// reported by `snapshot`.
//
// specs/instrumentation.md states the reason the snapshot shape is what it is:
// "Every field an operation can set is present, so every operation is verifiable
// by setting a value and reading it back." This point is that sentence, run over
// every pose the surface carries. A pose that quietly does nothing, writes a
// field the snapshot does not report, or rounds a value it was given away is a
// pose no other check in this project can trust, so the whole checklist rests on
// this one.
//
// NO FRAME RUNS BETWEEN A POSE AND ITS READING. A pose is a precondition, not an
// event: it puts the game into a situation, and the game's own rules run from
// there when a frame is advanced. Advancing one here would let the very rules
// this point is establishing the ground for — the phase timer counting down, the
// invulnerability draining, a worm taking a step — move the value between the
// write and the read. So every pose below is written and read on the same state,
// which is exactly the "set a value and read it back" the specification names,
// and the one frame the still needs is run after the reading is taken.
//
// MUTE IS DELIBERATELY ABSENT. There is no `setMuted`: specs/instrumentation.md
// gives the mute bit to the runtime and reaches it through the `mute` binding,
// and `snapshot().muted` reports the result. `controls.mute-m` and
// `audio.mute-silences` are the points that decide it.
//
// THE VALUES ARE CHOSEN TO BE DISTINGUISHING. Each is one no other field on the
// posed board carries and none is a default, so a pose that was dropped reads as
// the value it replaced rather than as the value it was given: a `menuIndex` of
// `2` is not `0`, a `dh` of `-1` is not the `+1` `addWorm` opens with, a gate
// posed `false` is not the `true` it defaults to, and a velocity of
// `(-123, 45)` is no foe's resting velocity.

import { afterEach, beforeEach, it } from "vitest";
import {
  tileCX,
  tileCY,
  wormLength,
  wormStepInterval,
} from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  lastBolt,
  lastFoe,
  lastWorm,
  wormOf,
  foeOf,
  boltOf,
  type Harness,
} from "../harness";

/** The screen, phase and menu row posed: none of them the title's own values. */
const SCREEN = "paused" as const;
const PHASE = "respawn" as const;
const PHASE_TIMER = 0.75;
const MENU_INDEX = 2;

/** The run posed: a score, a lives count and two levels, all distinguishing. */
const SCORE = 4271;
const LIVES = 5;
const LEVEL = 7;
const REACHED_LEVEL = 9;

/**
 * The cursor's posed center, inside the band on every one of its four bounds
 * (specs/board.md: `x` in `[16, 1264]`, `y` in `[672, 704]`), so the band's clamp
 * leaves it exactly where it was put and the reading is of the pose alone.
 */
const CURSOR_X = 300;
const CURSOR_Y = 680;

/** The two cursor timers posed, neither of them the `0` they rest at. */
const INVULNERABLE = 1.25;
const FIRE_COOLDOWN = 0.05;

/** The node posed, at the charge that tells every wrong answer apart. */
const NODE_C = 12;
const NODE_R = 6;
const NODE_CHARGE = 2;

/** The worm posed, and the two headings that are the reverse of `addWorm`'s. */
const WORM_C = 12;
const WORM_R = 9;
const WORM_DH = -1;
const WORM_DV = -1;

/**
 * The dropper posed, and a velocity no foe rests at. One foe carries all four of
 * the foe poses: each sets its own field, so the velocity, the hit flag and the
 * two faculties are read off the same foe.
 */
const FOE_C = 30;
const FOE_R = 4;
const FOE_VX = -123;
const FOE_VY = 45;

/** The bolt posed, at a center in logical units rather than on a tile. */
const BOLT_X = 400;
const BOLT_Y = 500;

/**
 * The tolerance on a posed number read straight back.
 *
 * Six decimal places, which is float noise rather than a rounding a build is
 * allowed: specs/instrumentation.md says the value is read back, so nothing here
 * gives a build room to store a figure at a coarser resolution than it was given.
 */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every posed value through snapshot", async () => {
  // ---- The screen and the run -------------------------------------------

  h.debug.setScreen(SCREEN);
  h.debug.setPhase(PHASE);
  h.debug.setPhaseTimer(PHASE_TIMER);
  h.debug.setMenuIndex(MENU_INDEX);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setLevel(LEVEL);
  h.debug.setReachedLevel(REACHED_LEVEL);

  // ---- The three world gates --------------------------------------------

  h.debug.setFoeSpawning(false);
  h.debug.setWormEntry(false);
  h.debug.setCursorContact(false);

  // ---- The cursor and its bolts -----------------------------------------

  h.debug.setCursor(CURSOR_X, CURSOR_Y);
  h.debug.setCursorInvulnerable(INVULNERABLE);
  h.debug.setFireCooldown(FIRE_COOLDOWN);
  h.debug.addBolt(BOLT_X, BOLT_Y);
  const boltId = lastBolt(h.snapshot()).id;

  // ---- The node field ----------------------------------------------------

  h.debug.setNode(NODE_C, NODE_R, NODE_CHARGE);

  // ---- The worm ----------------------------------------------------------

  h.debug.addWorm(WORM_C, WORM_R);
  const wormId = lastWorm(h.snapshot()).id;
  h.debug.setWormHeading(wormId, WORM_DH);
  h.debug.setWormDescent(wormId, WORM_DV);
  h.debug.setWormDiving(wormId, true);
  h.debug.setWormStepping(wormId, false);
  h.debug.setWormBody(wormId, false);

  // ---- The foe -----------------------------------------------------------
  //
  // One of them, a dropper, because the hit flag is the one specs/foes.md gives a
  // dropper and every foe pose sets one field: applying all four to the same foe
  // and reading all four back is what says so.
  h.debug.addFoe("dropper", tileCX(FOE_C), tileCY(FOE_R));
  const foeId = lastFoe(h.snapshot()).id;
  h.debug.setFoeVelocity(foeId, FOE_VX, FOE_VY);
  h.debug.setFoeHit(foeId, true);
  h.debug.setFoeMind(foeId, false);
  h.debug.setFoeTravel(foeId, false);

  // The one reading, taken before any frame runs.
  const posed = h.snapshot();

  // The board each pose was applied to, drawn by the one frame this check runs.
  await h.advance(1);
  captureStill(h, "posed");

  // ---- What the snapshot must report -------------------------------------

  assertEqual(posed.screen, SCREEN, "setScreen");
  assertEqual(posed.phase, PHASE, "setPhase");
  assertCloseTo(posed.phaseTimer, PHASE_TIMER, EXACT, "setPhaseTimer");
  assertEqual(posed.menuIndex, MENU_INDEX, "setMenuIndex");
  assertEqual(posed.score, SCORE, "setScore");
  assertEqual(posed.lives, LIVES, "setLives");
  assertEqual(posed.level, LEVEL, "setLevel");
  assertEqual(posed.reachedLevel, REACHED_LEVEL, "setReachedLevel");

  // The two derived readings follow the posed level, which specs/worm.md fixes
  // as closed forms of it.
  assertCloseTo(
    posed.wormStepInterval,
    wormStepInterval(LEVEL),
    EXACT,
    "wormStepInterval follows the posed level (specs/worm.md)",
  );
  assertEqual(
    posed.wormLength,
    wormLength(LEVEL),
    "wormLength follows the posed level (specs/worm.md)",
  );

  assertEqual(posed.foeSpawning, false, "setFoeSpawning");
  assertEqual(posed.wormEntry, false, "setWormEntry");
  assertEqual(posed.cursor.contact, false, "setCursorContact");

  assertCloseTo(posed.cursor.x, CURSOR_X, EXACT, "setCursor's x");
  assertCloseTo(posed.cursor.y, CURSOR_Y, EXACT, "setCursor's y");
  assertCloseTo(
    posed.cursor.invulnerable,
    INVULNERABLE,
    EXACT,
    "setCursorInvulnerable",
  );
  assertCloseTo(posed.fireCooldown, FIRE_COOLDOWN, EXACT, "setFireCooldown");

  assertEqual(chargeAt(posed, NODE_C, NODE_R), NODE_CHARGE, "setNode");

  const worm = wormOf(posed, wormId);
  assertEqual(worm.dh, WORM_DH, "setWormHeading");
  assertEqual(worm.dv, WORM_DV, "setWormDescent");
  assertEqual(worm.diving, true, "setWormDiving");
  assertEqual(worm.stepping, false, "setWormStepping");
  assertEqual(worm.body, false, "setWormBody");

  const foe = foeOf(posed, foeId);
  assertCloseTo(foe.vx, FOE_VX, EXACT, "setFoeVelocity's vx");
  assertCloseTo(foe.vy, FOE_VY, EXACT, "setFoeVelocity's vy");
  assertEqual(foe.hit, true, "setFoeHit");
  assertEqual(foe.mind, false, "setFoeMind");
  assertEqual(foe.travel, false, "setFoeTravel");

  const bolt = boltOf(posed, boltId);
  assertEqual(bolt === null, false, "addBolt appends the bolt to the roster");
  assertCloseTo(bolt?.x ?? Number.NaN, BOLT_X, EXACT, "addBolt's x");
  assertCloseTo(bolt?.y ?? Number.NaN, BOLT_Y, EXACT, "addBolt's y");
});
