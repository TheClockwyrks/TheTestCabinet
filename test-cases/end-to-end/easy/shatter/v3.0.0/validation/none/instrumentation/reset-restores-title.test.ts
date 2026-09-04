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
// AND WHY MUTE AND THE CLOCK ARE THE EXCEPTIONS. `specs/instrumentation.md` says `options.seed`
// seeds the randomness and that "`muted` is left exactly as it stands; muting is
// the runtime's". So the sound is turned off through the key `specs/controls.md`
// binds — the way a player turns it off — before the reset, and it is still off
// after it. The reading is taken a tick later as well as at once, because the
// snapshot's `muted` is the game's copy of the RUNTIME's bit, refreshed in every
// update: a build that reset the runtime's own bit reports sound back on as soon as
// the next tick refreshes the copy, and that is the fault this leg is looking for.
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
// AND THE CLOCK IS THE OTHER. `specs/instrumentation.md` says of the auto-step
// setting that "`reset` leaves this setting exactly as it stands: the clock is the
// runtime's rather than a game value, so a reset taken under a held clock leaves
// the clock held". Every check in this project opens with the clock held and resets
// mid-scenario, so a build that re-armed the frame loop on `reset` would leave the
// rest of the project drifting on the wall clock at whatever rate the machine
// happened to render. The leg holds the clock, resets, and then reads the setting
// back and gives the page a second of real time to prove nothing ran.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  DEG,
  FACE_UP,
  KEY_MUTE,
  SAFE_X,
  SAFE_Y,
  START_LIVES,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseEnemyBullet,
  poseRock,
  poseSaucer,
  startPlaying,
  type Harness,
} from "../harness";

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
/** The real milliseconds the game is left alone after the reset, clock held. */
const RESET_WALL_MS = 1000;
/** Where the moving rock the clock leg poses is put. */
const ROCK = { x: 260, y: 620, vx: 120, vy: -80 } as const;
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

afterEach(async () => {
  await h.dispose();
});

it("puts every declared field back to its title value", async () => {
  await startPlaying(h);

  // Dress the run in values that are not the title's, on every roster and every
  // gate, so a reset that assigns nothing cannot pass.
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setWave(POSED_WAVE);
  await h.debug.setWaveBanner(POSED_BANNER);
  await h.debug.setMenuIndex(POSED_MENU_INDEX);
  await h.debug.setShipPosition(POSED_SHIP.x, POSED_SHIP.y);
  await h.debug.setShipVelocity(POSED_SHIP_VELOCITY.vx, POSED_SHIP_VELOCITY.vy);
  await h.debug.setShipAngle(POSED_ANGLE);
  await h.debug.setShipInvuln(POSED_INVULN);
  await h.debug.setFireCooldown(POSED_COOLDOWN);
  await poseRock(h, "large", 220, 180);
  await poseRock(h, "small", 1060, 620);
  await poseBullet(h, 260, 620, 0, 0);
  await poseEnemyBullet(h, 1020, 180, 0, 0);
  await poseSaucer(h, 640, 100, {
    vx: 0,
    vy: 0,
    mind: false,
    gun: false,
    travel: false,
  });
  await h.advance(1);

  await h.debug.reset();
  await captureStill(h, "reset");
  const s = await h.snapshot();

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
  await startPlaying(h);

  // Muted the way a player mutes, since no operation on the surface sets it: the
  // bit is read as the game opened it and then flipped through the key
  // `specs/controls.md` binds, so what the reset is asked to leave alone is a
  // value a reset could not have produced by accident.
  const opened = (await h.snapshot()).muted;
  await h.tap(KEY_MUTE);
  const toggled = (await h.snapshot()).muted;
  assertEqual(toggled, !opened, "the mute key toggled the sound");

  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).muted,
    toggled,
    "reset left the mute bit exactly as it stood",
  );

  // A tick later too: the snapshot's `muted` is the game's copy of the runtime's
  // bit, refreshed in every update, so a reset that cleared the runtime's own bit
  // shows up on the next refresh rather than on the reading above.
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).muted,
    toggled,
    "and the runtime's own mute bit survived the reset",
  );
});

it("leaves the clock held exactly as it stands", async () => {
  // The harness opens with `setAutoStep(false)` already called, which is the state
  // the sentence is about: a reset taken under a held clock.
  await startPlaying(h);
  await poseRock(h, "large", ROCK.x, ROCK.y, ROCK.vx, ROCK.vy);
  await h.advance(1);

  await h.debug.reset();

  assertEqual(
    (await h.snapshot()).autoStep,
    false,
    "reset left the clock held",
  );

  // And the setting is not the whole claim: a build could report the setting back
  // and still have re-armed its own loop. A second of real time with the page in
  // front is what settles it, since nothing may advance while the clock is held.
  const held = await h.snapshot();
  await h.page.bringToFront().catch(() => undefined);
  await h.page.waitForTimeout(RESET_WALL_MS);
  assertEqual(
    (await h.snapshot()).simTime,
    held.simTime,
    `nothing ran in ${RESET_WALL_MS}ms of wall time after the reset`,
  );
});
