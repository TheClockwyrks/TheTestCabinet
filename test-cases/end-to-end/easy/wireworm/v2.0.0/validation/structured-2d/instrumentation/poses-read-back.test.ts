// Wireworm — instrumentation/poses-read-back: every pose the surface carries is
// reported by `snapshot`, so each one is verifiable by setting a value and
// reading it back.
//
// specs/instrumentation.md states the rule the whole surface is built to:
// "Every field an operation can set is present, so every operation is verifiable
// by setting a value and reading it back." That is what makes the rest of this
// suite mean anything — a scenario is only posed if the poses landed — so this
// point walks the operations one at a time and reads each one's own field.
//
// EVERY POSE IS READ AT THE CALL. Under this engine "a pose acts on the live
// game the moment it is called" and "a reading returns plain data built at the
// call" (specs/instrumentation.md), so no frame stands between a pose and the
// reading that checks it. That matters here: a frame would run the phase timer,
// the fire cooldown and the invulnerability down, and the check would be reading
// the update rather than the pose.
//
// EVERY BOOLEAN IS POSED BOTH WAYS. A field read back once could be a constant.
// Each of the nine flags — the worm's diving, stepping and body, the foe's hit,
// mind and travel, and the three world gates — is set to one value, read, set to
// the other, and read again, so a snapshot that simply always answers `true`
// fails on the second reading. The two headings are posed the same way, `-1`
// then `+1`, because `addWorm` starts a worm at `+1` on both (that file, The
// worms) and a single pose of `+1` would read back on a build that ignored it.
//
// MUTE IS DELIBERATELY ABSENT. There is no `setMuted` under any engine, and
// `muted` is "the game's copy of the runtime's mute bit" rather than a posed
// field, so nothing here can set it and read it back. `controls/mute-m` drives
// the real binding and `audio/mute-silences` reads the consequence.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That
// a posed critical node detonates is `nodes/*`'s, that a gate held off keeps the
// level's foes away is `instrumentation/foe-spawn-gate`'s, and that the band
// clamps a cursor posed outside it is `cursor/band-clamp`'s — so every position
// posed here is one the clamp leaves alone.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  foeById,
  poseBolt,
  poseFoe,
  poseWorm,
  startPlaying,
  tileCenter,
  wormById,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The tile the posed node stands on, and the charge posed onto it. */
const NODE_C = 24;
const NODE_R = 6;

/**
 * `2`, the distinguishing charge of the four specs/nodes.md names: a build that
 * creates the node and ignores the argument reads `0`, one that saturates every
 * node reads `3`, and one whose `setNode` created nothing reads absent.
 */
const NODE_CHARGE = 2;

/** Where the posed worm's head and the posed foe stand. */
const WORM_C = 9;
const WORM_R = 4;
const FOE_C = 30;
const FOE_R = 12;

/** The column a posed bolt climbs and the row it starts on. */
const BOLT_C = 34;
const BOLT_R = 19;

/**
 * The values posed into the scalar fields.
 *
 * Each is deliberately not the value `startPlaying` left behind — the screen is
 * `playing` there, the phase `active`, the level `1`, the cooldown `0` — so a
 * build that ignores a pose reads back the value it already held rather than the
 * one asked for, and the failure names the operation.
 */
const SCREEN = "howto" as const;
const PHASE = "respawn" as const;
const PHASE_TIMER = 0.75;
const MENU_INDEX = 2;
const SCORE = 4321;
const LIVES = 5;
const LEVEL = 7;
const REACHED_LEVEL = 9;
const CURSOR_X = 417;
const CURSOR_Y = 688;
const INVULNERABLE = 1.25;
const FIRE_COOLDOWN = 0.09;
const FOE_VX = 33;
const FOE_VY = -44;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every posed field back through snapshot", async () => {
  startPlaying(h);

  // The board the poses below are applied to: one node, one worm, one foe, one
  // bolt. The foe is held still so the picture and the readings are of the same
  // board; its travel is posed and read back on its own account further down.
  h.debug.setNode(NODE_C, NODE_R, NODE_CHARGE);
  const worm = poseWorm(h, WORM_C, WORM_R);
  const foe = poseFoe(h, "glitch", FOE_C, FOE_R);
  h.debug.setFoeTravel(foe, false);
  poseBolt(h, tileCX(BOLT_C), tileCY(BOLT_R));

  await h.advance(1);
  // Taken before the readings below, so a failing pose still leaves the picture
  // of the board it was applied to.
  captureStill(h, "posed");

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = <T>(
    pose: () => void,
    read: (s: WirewormSnapshot) => T,
    want: T,
    what: string,
  ): void => {
    pose();
    assertEqual(read(h.snapshot()), want, what);
  };

  // ---- The screen and the run ---------------------------------------------

  readsBack(
    () => h.debug.setScreen(SCREEN),
    (s) => s.screen,
    SCREEN,
    `snapshot().screen after setScreen(${JSON.stringify(SCREEN)})`,
  );
  readsBack(
    () => h.debug.setPhase(PHASE),
    (s) => s.phase,
    PHASE,
    `snapshot().phase after setPhase(${JSON.stringify(PHASE)})`,
  );
  readsBack(
    () => h.debug.setPhaseTimer(PHASE_TIMER),
    (s) => s.phaseTimer,
    PHASE_TIMER,
    `snapshot().phaseTimer after setPhaseTimer(${PHASE_TIMER})`,
  );
  readsBack(
    () => h.debug.setMenuIndex(MENU_INDEX),
    (s) => s.menuIndex,
    MENU_INDEX,
    `snapshot().menuIndex after setMenuIndex(${MENU_INDEX})`,
  );
  readsBack(
    () => h.debug.setScore(SCORE),
    (s) => s.score,
    SCORE,
    `snapshot().score after setScore(${SCORE})`,
  );
  readsBack(
    () => h.debug.setLives(LIVES),
    (s) => s.lives,
    LIVES,
    `snapshot().lives after setLives(${LIVES})`,
  );
  readsBack(
    () => h.debug.setLevel(LEVEL),
    (s) => s.level,
    LEVEL,
    `snapshot().level after setLevel(${LEVEL})`,
  );
  readsBack(
    () => h.debug.setReachedLevel(REACHED_LEVEL),
    (s) => s.reachedLevel,
    REACHED_LEVEL,
    `snapshot().reachedLevel after setReachedLevel(${REACHED_LEVEL})`,
  );

  // ---- The three world gates, each posed both ways -------------------------

  for (const enabled of [true, false]) {
    readsBack(
      () => h.debug.setFoeSpawning(enabled),
      (s) => s.foeSpawning,
      enabled,
      `snapshot().foeSpawning after setFoeSpawning(${enabled})`,
    );
    readsBack(
      () => h.debug.setWormEntry(enabled),
      (s) => s.wormEntry,
      enabled,
      `snapshot().wormEntry after setWormEntry(${enabled})`,
    );
    readsBack(
      () => h.debug.setCursorContact(enabled),
      (s) => s.cursor.contact,
      enabled,
      `snapshot().cursor.contact after setCursorContact(${enabled})`,
    );
  }

  // ---- The cursor and its bolts -------------------------------------------

  // A point well inside the band, so the clamp specs/cursor.md fixes has nothing
  // to do here and the reading is of the pose alone.
  h.debug.setCursor(CURSOR_X, CURSOR_Y);
  const placed = h.snapshot();
  assertEqual(
    placed.cursor.x,
    CURSOR_X,
    `snapshot().cursor.x after setCursor(${CURSOR_X}, ${CURSOR_Y})`,
  );
  assertEqual(
    placed.cursor.y,
    CURSOR_Y,
    `snapshot().cursor.y after setCursor(${CURSOR_X}, ${CURSOR_Y})`,
  );

  readsBack(
    () => h.debug.setCursorInvulnerable(INVULNERABLE),
    (s) => s.cursor.invulnerable,
    INVULNERABLE,
    `snapshot().cursor.invulnerable, in SECONDS, after ` +
      `setCursorInvulnerable(${INVULNERABLE})`,
  );
  readsBack(
    () => h.debug.setFireCooldown(FIRE_COOLDOWN),
    (s) => s.fireCooldown,
    FIRE_COOLDOWN,
    `snapshot().fireCooldown after setFireCooldown(${FIRE_COOLDOWN})`,
  );

  // A bolt is appended to the roster and reported at the center it was placed at
  // (specs/instrumentation.md, Identity).
  const at = tileCenter(BOLT_C, BOLT_R - 1);
  const bolt = poseBolt(h, at.x, at.y);
  const flying = h.snapshot().bolts.find((entry) => entry.id === bolt);
  assertEqual(
    `${flying?.x},${flying?.y}`,
    `${at.x},${at.y}`,
    `snapshot().bolts entry for the bolt addBolt(${at.x}, ${at.y}) appended`,
  );

  // ---- The node field ------------------------------------------------------

  assertEqual(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    NODE_CHARGE,
    `the charge snapshot() reports on tile (${NODE_C}, ${NODE_R}) after ` +
      `setNode(${NODE_C}, ${NODE_R}, ${NODE_CHARGE}) — null means no node ` +
      `was created`,
  );

  // ---- The worm's headings and its two faculties ---------------------------

  for (const heading of [-1, 1]) {
    readsBack(
      () => h.debug.setWormHeading(worm, heading),
      (s) => wormById(s, worm)?.dh,
      heading,
      `snapshot() worm ${worm}'s dh after setWormHeading(${worm}, ${heading})`,
    );
    readsBack(
      () => h.debug.setWormDescent(worm, heading),
      (s) => wormById(s, worm)?.dv,
      heading,
      `snapshot() worm ${worm}'s dv after setWormDescent(${worm}, ${heading})`,
    );
  }

  for (const flag of [true, false]) {
    readsBack(
      () => h.debug.setWormDiving(worm, flag),
      (s) => wormById(s, worm)?.diving,
      flag,
      `snapshot() worm ${worm}'s diving after setWormDiving(${worm}, ${flag})`,
    );
    readsBack(
      () => h.debug.setWormStepping(worm, flag),
      (s) => wormById(s, worm)?.stepping,
      flag,
      `snapshot() worm ${worm}'s stepping after ` +
        `setWormStepping(${worm}, ${flag})`,
    );
    readsBack(
      () => h.debug.setWormBody(worm, flag),
      (s) => wormById(s, worm)?.body,
      flag,
      `snapshot() worm ${worm}'s body after setWormBody(${worm}, ${flag})`,
    );
  }

  // ---- The foe's velocity, its hit flag and its two faculties --------------

  h.debug.setFoeVelocity(foe, FOE_VX, FOE_VY);
  const steered = foeById(h.snapshot(), foe);
  assertEqual(
    `${steered?.vx},${steered?.vy}`,
    `${FOE_VX},${FOE_VY}`,
    `snapshot() foe ${foe}'s velocity, in units per second, after ` +
      `setFoeVelocity(${foe}, ${FOE_VX}, ${FOE_VY})`,
  );

  for (const flag of [true, false]) {
    readsBack(
      () => h.debug.setFoeHit(foe, flag),
      (s) => foeById(s, foe)?.hit,
      flag,
      `snapshot() foe ${foe}'s hit after setFoeHit(${foe}, ${flag})`,
    );
    readsBack(
      () => h.debug.setFoeMind(foe, flag),
      (s) => foeById(s, foe)?.mind,
      flag,
      `snapshot() foe ${foe}'s mind after setFoeMind(${foe}, ${flag})`,
    );
    readsBack(
      () => h.debug.setFoeTravel(foe, flag),
      (s) => foeById(s, foe)?.travel,
      flag,
      `snapshot() foe ${foe}'s travel after setFoeTravel(${foe}, ${flag})`,
    );
  }
});
