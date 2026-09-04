// instrumentation/reset-restores-title — after a run has been posed away from
// every one of its opening figures, `reset()` puts the whole of the declared state
// back to the title values `specs/instrumentation.md` lists, and leaves `muted`
// alone.
//
// WHY EVERY FIELD IS POSED AWAY FIRST. A `reset` that assigns nothing at all passes
// a check run against a game that was already at the title. So the run is dressed
// in values that are not the title's — a score, extra ships, a wave, a banner, a
// ship somewhere else entirely, both world gates shut, the contact gate shut, and a
// body on every roster — and then the whole list is read back. A build that resets
// four of the fields and forgets the fifth fails on the fifth.
//
// WHAT THE VARIANT ADDS IS ITS OWN ITEM. `specs/instrumentation.md` has `reset` empty
// the torpedo roster and fill the charge under `warhead`, and that is
// `instrumentation/reset-clears-the-torpedoes`, an item of the warhead checklist
// alone. It is not read here behind a probe of the build's own surface: a
// requirement gated on whether the build installed `addTorpedo` is one a build can
// shed by implementing less, and a `warhead` build that never wrote the torpedo
// would then pass this point on the strength of its omission while one that wrote
// the torpedo and forgot to clear it would fail.
//
// AND WHY MUTE IS THE ONE EXCEPTION. `specs/instrumentation.md` says `options.seed`
// seeds the randomness and that "`muted` is left exactly as it stands; muting is
// the runtime's". Under this engine the bit itself belongs to the engine's audio
// bus and the snapshot reports the game's copy of it, refreshed in every update. So
// the sound is turned off through the action `specs/controls.md` binds — the way a
// player turns it off — before the reset, and it is read back BOTH at once and a
// tick later: at once catches a reset that cleared the game's own copy, and a tick
// later catches one that reached the engine's bus, since the next update refreshes
// the copy from it.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, FACE_UP, SAFE_X, SAFE_Y, START_LIVES } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseEnemyBullet,
  poseRock,
  startPlaying,
  tapAction,
  type Harness,
} from "../harness";
import { poseIdleSaucer } from "./populated-field";

/** The score the run is dressed in before the reset. */
const POSED_SCORE = 8640;
/** The ships the run is dressed in: more than a new game's three. */
const POSED_LIVES = 6;
/** The wave the run is dressed in. */
const POSED_WAVE = 9;
/** The seconds of banner the run is dressed in. */
const POSED_BANNER = 1.2;
/** The menu entry the run is dressed in. */
const POSED_MENU_INDEX = 2;
/** Where the ship is put, well away from the safe point the title returns it to. */
const POSED_SHIP = { x: 240, y: 180 } as const;
/** The ship's posed velocity, so a reset has motion to take away. */
const POSED_SHIP_VELOCITY = { vx: -120, vy: 90 } as const;
/** The ship's posed facing: not `FACE_UP`, so a reset has a facing to restore. */
const POSED_ANGLE = 25 * DEG;
/** The ship's posed respawn grace, in seconds. */
const POSED_INVULN = 2;
/** The ship's posed fire gate, in whole ticks. */
const POSED_COOLDOWN = 17;

/** Where the bodies the reset must clear are put. */
const LARGE_PLACE = { x: 220, y: 180 } as const;
const SMALL_PLACE = { x: 1060, y: 620 } as const;
const BULLET_PLACE = { x: 260, y: 620 } as const;
const ENEMY_BULLET_PLACE = { x: 1020, y: 180 } as const;
const SAUCER_PLACE = { x: 640, y: 100 } as const;

/**
 * The decimal places a restored title figure is read back to.
 *
 * Six, which is to say exactly: `specs/instrumentation.md` lists the title values
 * as literal numbers, so nothing but floating-point rounding separates a
 * conforming build's reading from the figure the document names.
 */
const TITLE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts every declared field back to its title value", async () => {
  startPlaying(h);

  // Dress the run in values that are not the title's, on every roster and every
  // gate, so a reset that assigns nothing cannot pass.
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  h.debug.setWaveBanner(POSED_BANNER);
  h.debug.setMenuIndex(POSED_MENU_INDEX);
  h.debug.setShipPosition(POSED_SHIP.x, POSED_SHIP.y);
  h.debug.setShipVelocity(POSED_SHIP_VELOCITY.vx, POSED_SHIP_VELOCITY.vy);
  h.debug.setShipAngle(POSED_ANGLE);
  h.debug.setShipInvuln(POSED_INVULN);
  h.debug.setFireCooldown(POSED_COOLDOWN);
  poseRock(h, "large", LARGE_PLACE.x, LARGE_PLACE.y);
  poseRock(h, "small", SMALL_PLACE.x, SMALL_PLACE.y);
  poseBullet(h, BULLET_PLACE.x, BULLET_PLACE.y, 0, 0);
  poseEnemyBullet(h, ENEMY_BULLET_PLACE.x, ENEMY_BULLET_PLACE.y, 0, 0);
  poseIdleSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y);
  await h.advance(1);

  // Read with NO tick between the reset and the reading. Under this engine a pose
  // is a transition the harness runs through `engine.apply`, so the state read
  // here IS the state `reset` returned: a build that deferred the restore to its
  // own update would be storing an unreset state, and is caught here rather than
  // being handed a frame to finish the job in. It also keeps the reading clear of
  // anything the title screen itself does with a tick — `specs/ui.md` lets a build
  // drift dimmed rocks behind the menu.
  h.debug.reset();
  const s = h.snapshot();

  // One frame AFTER the reading, so the still shows the title the reset restored
  // rather than the run it replaced. It cannot touch the reading above.
  await h.advance(1);
  captureStill(h, "reset");

  assertEqual(s.screen, "title", "reset restores the screen");
  assertEqual(
    s.menuIndex,
    0,
    "reset restores the highlight to the first entry",
  );
  assertEqual(s.score, 0, "reset restores the score");
  assertEqual(s.lives, START_LIVES, "reset restores the ships");
  assertEqual(s.wave, 0, "reset restores the wave");
  assertCloseTo(s.waveBanner, 0, TITLE_DIGITS, "reset clears the banner");

  assertLength(s.rocks, 0, "reset empties the rocks");
  assertLength(s.bullets, 0, "reset empties the ship's bullets");
  assertLength(s.enemyBullets, 0, "reset empties the saucer bullets");
  assertNull(s.saucer, "reset removes the saucer");

  assertCloseTo(s.ship.x, SAFE_X, TITLE_DIGITS, "reset returns the ship's x");
  assertCloseTo(s.ship.y, SAFE_Y, TITLE_DIGITS, "and its y");
  assertCloseTo(s.ship.vx, 0, TITLE_DIGITS, "reset puts the ship at rest, vx");
  assertCloseTo(s.ship.vy, 0, TITLE_DIGITS, "and vy");
  assertCloseTo(s.ship.angle, FACE_UP, TITLE_DIGITS, "reset faces it up");
  assertCloseTo(s.ship.invuln, 0, TITLE_DIGITS, "reset clears the grace");
  assertEqual(s.ship.fireCooldown, 0, "reset clears the fire gate");
  assertEqual(s.ship.collision, true, "reset turns the contact gate back on");

  assertEqual(s.waveSpawning, true, "reset turns the wave gate back on");
  assertEqual(s.saucerSpawning, true, "reset turns the saucer gate back on");
  assertCloseTo(s.simTime, 0, TITLE_DIGITS, "reset returns the clock to zero");
});

it("leaves the mute bit exactly as it stands", async () => {
  startPlaying(h);
  await h.advance(1);

  // Muted the way a player mutes, since no operation on the surface sets it: the
  // bit is read as the game opened it and then flipped through the action
  // `specs/controls.md` binds, so what the reset is asked to leave alone is a
  // value a reset could not have produced by accident.
  const opened = h.snapshot().muted;
  await tapAction(h, "mute");
  const toggled = h.snapshot().muted;
  assertEqual(toggled, !opened, "the mute action toggled the sound");

  h.debug.reset();
  assertEqual(
    h.snapshot().muted,
    toggled,
    "reset left the mute bit exactly as it stood",
  );

  // A tick later too: the snapshot's `muted` is the game's copy of the engine's
  // bit, refreshed in every update, so a reset that cleared the engine's own bit
  // shows up on the next refresh rather than on the reading above.
  await h.advance(1);
  assertEqual(
    h.snapshot().muted,
    toggled,
    "and the engine's own mute bit survived the reset",
  );
});
