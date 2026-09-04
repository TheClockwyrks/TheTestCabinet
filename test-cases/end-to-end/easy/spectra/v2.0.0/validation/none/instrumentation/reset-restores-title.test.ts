// Spectra — instrumentation/reset-restores-title: `reset()` puts every declared
// field back to the title-screen value the specification lists, and leaves `muted`
// where it stands.
//
// `specs/instrumentation.md` writes the list out in one sentence: `reset` restores
// `screen` to `"title"`, `phase` to `"live"`, `phaseTimer` to `0`, `menuIndex` to
// `0`, `score` to `0`, `lives` to `START_LIVES` (`3`), `stage` to `1`, `resonance`
// to `0`, and `inversion` to `0`; it empties the drone, bullet, and burst rosters
// and the live discharge; it places the ship at the center of its lane (`640`) on
// the cyan band with `0` seconds of fire lockout and `0` seconds of fire cooldown;
// it turns the three world gates `waveEntry`, `diveLaunching`, and `ship.contact`
// back on; it returns the wave's clocks to their fresh-wave values, `diveClock` at
// `0`; it sets `extraLifeAwarded` to `false` and `challengeHits` to `0`; and it
// sets `simTime` to `0`. Every one of those is read below, in that order, except
// the wave's entry and sway clocks and the gap the next dive waits for, which no
// field of the snapshot reports.
//
// EVERY FIELD IS POSED AWAY FROM ITS TITLE VALUE FIRST. A reset that restored
// nothing would pass on a game still sitting at the title, so the run this point
// resets is one in which not a single one of those fields holds the value it is
// about to be restored to: a score and a stage well into a run, one life, a menu
// row that is not the first, a screen and a phase that are neither, a ship at the
// far end of its lane on the other band with a lockout and a cooldown running, a
// meter most of the way up, an inversion running, all three rosters carrying
// entries, a wave discharging, all three world gates held off, a dive clock part
// way to its next launch, the extra-life latch paid, a challenge stage's tally of
// drones destroyed standing at a count, and accumulated simulation time.
//
// TWO OF THOSE CANNOT BE POSED AND HAVE TO BE DRIVEN. There is no operation that
// adds a burst and none that discharges (`specs/instrumentation.md`, The bursts
// and Resonance and the inversion), so a Shard is destroyed by a matching shot to
// leave a burst playing, and the meter is posed to `RESONANCE_MAX` and the
// discharge key pressed to leave a wave live — with the reset landing inside the
// `DISCHARGE_TIME` (`0.5` s) window, so "empties … the live discharge" is held to
// a wave that was actually running.
//
// `muted` IS THE ONE FIELD THAT MUST SURVIVE. "`muted` is left exactly as it
// stands, because muting is a player preference the runtime owns"
// (`specs/instrumentation.md`), so the bit is read immediately before the reset
// and held to that same reading afterwards. The `mute` binding is pressed first so
// the bit under test is more likely to be the interesting one, but the comparison
// is against what the snapshot ACTUALLY reported a moment earlier — whether that
// binding works is `controls/mute-m`'s point, and a build that failed it must not
// fail this one too.
//
// NO FRAME RUNS BETWEEN THE RESET AND THE READING. The harness holds the game off
// the wall clock, and `simTime` accumulates the time the sub-steps cover — so a
// check that advanced a frame first would be reading the update rather than the
// reset.
//
// WHAT THIS DOES NOT DECIDE. `discharge.radius`: the specification says the reset
// empties the live discharge and reports the radius as "the live wave's radius",
// and a build that stops the wave without zeroing a figure no live wave is being
// read from has still emptied it, so only `discharge.active` is read here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  BINDINGS,
  DISCHARGE_TIME,
  RESONANCE_MAX,
  SHIP_X_MAX,
  SHIP_X_MIN,
  START_LIVES,
} from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  framesFor,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The centre of the ship's lane, which `specs/instrumentation.md` places the ship
 * back at: `(SHIP_X_MIN + SHIP_X_MAX) / 2`, which is `640`.
 */
const LANE_CENTRE = (SHIP_X_MIN + SHIP_X_MAX) / 2;

/**
 * How far the restored ship may sit from that centre, in decimal digits for
 * `assertCloseTo`.
 *
 * Six, which is half a millionth of a logical unit: the specification names one
 * exact point and a build placing the ship anywhere else has not restored it, so
 * this is the float noise of reading a number back rather than an allowance.
 */
const PLACE_DIGITS = 6;

/** The run posed before the reset — not one of these is a title-screen value. */
const SCORE = 8800;
const LIVES = 1;
const STAGE = 5;
const MENU_INDEX = 1;
const SCREEN = "gameOver" as const;
const PHASE = "ready" as const;
const PHASE_TIMER = 0.9;
const RESONANCE = 88;
const INVERSION = 3;
const SHIP_X = 1200;
const SHIP_BAND = "magenta" as const;
const LOCKOUT = 0.2;
const COOLDOWN = 0.1;
const DIVE_CLOCK = 1.7;
const POSED_CHALLENGE_HITS = 12;

/** Where the drones that outlive the kill stand, and where the popped one does. */
const STANDING: readonly { x: number; y: number }[] = [
  { x: 300, y: 200 },
  { x: 500, y: 240 },
];
const POP_AT = { x: 1000, y: 460 } as const;

/**
 * How far below the popped drone its shot starts, and the frames it is allowed.
 *
 * A Shard's contact reach is `SHARD_HALF` (14) plus `PLAYER_BULLET_HALF` (6), so
 * `60` puts the bullet in flight rather than in contact; at `PLAYER_BULLET_SPEED`
 * (760) it covers that in six frames of the suite's 100 Hz clock, and twenty-five
 * leaves ample slack for whichever frame the build resolves the contact on.
 */
const SHOT_BELOW = 60;
const SHOT_FRAMES = 25;

/** Where the two posed bullets hang, in columns nothing else occupies. */
const FRIENDLY_AT = { x: 150, y: 620 } as const;
const ENEMY_AT = { x: 1150, y: 120 } as const;

/** Frames the discharge press is given to release the wave. */
const RELEASE_FRAMES = 3;

/** Seconds of accumulated play, so `simTime` is something to be reset from. */
const PLAY_SECONDS = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("restores every declared field to its title value and leaves muted alone", async () => {
  // The runtime's mute bit, reached the only way there is: the real binding, which
  // specs/controls.md reads from every screen (specs/instrumentation.md, What the
  // runtime provides instead).
  await h.tap(BINDINGS.mute[0]);

  await startPosed(h);
  await h.advance(framesFor(PLAY_SECONDS));

  // The rosters. The standing drones leave the wave a drone under either reading
  // of "its wave" (specs/stages.md), so the kill below does not end the live wave.
  for (const at of STANDING) {
    await poseDrone(h, "shard", at.x, at.y, { band: "cyan" });
  }
  const target = await poseDrone(h, "shard", POP_AT.x, POP_AT.y, {
    band: "cyan",
  });
  const shot = await shootDrone(h, target, "cyan", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  assertEqual(
    shot.hit && droneById(shot.snapshot, target) === undefined,
    true,
    `the Shard at (${POP_AT.x}, ${POP_AT.y}) destroyed by a matching shot ` +
      `(specs/bands.md) — without the kill there is no burst for reset to empty`,
  );

  await h.debug.addPlayerBullet(FRIENDLY_AT.x, FRIENDLY_AT.y, "cyan");
  await h.debug.addEnemyBullet(ENEMY_AT.x, ENEMY_AT.y, "magenta");

  // The live wave, lit last so the reset lands well inside its DISCHARGE_TIME.
  await h.debug.setResonance(RESONANCE_MAX);
  await h.hold(BINDINGS.discharge[0]);
  const fired = await h.until((s) => s.discharge.active, {
    maxFrames: RELEASE_FRAMES,
  });
  await h.release(BINDINGS.discharge[0]);
  assertTrue(
    fired.hit,
    `a discharge wave to be live within ${RELEASE_FRAMES} frames of the ` +
      `${BINDINGS.discharge[0]} key going down with the meter at ` +
      `RESONANCE_MAX (${RESONANCE_MAX}) (specs/resonance.md) — this point ` +
      `cannot hold reset to emptying a wave that never ran`,
  );

  // And the rest of the run, posed with no frame between here and the reset, so
  // every one of these values is still standing when it lands. The meter is posed
  // after the discharge, which spent it.
  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setStage(STAGE);
  await h.debug.setMenuIndex(MENU_INDEX);
  await h.debug.setPhaseTimer(PHASE_TIMER);
  await h.debug.setResonance(RESONANCE);
  await h.debug.setInversion(INVERSION);
  await h.debug.setShipX(SHIP_X);
  await h.debug.setShipBand(SHIP_BAND);
  await h.debug.setFireLockout(LOCKOUT);
  await h.debug.setFireCooldown(COOLDOWN);
  await h.debug.setExtraLifeAwarded(true);
  await h.debug.setChallengeHits(POSED_CHALLENGE_HITS);
  await h.debug.setDiveClock(DIVE_CLOCK);
  await h.debug.setWaveEntry(false);
  await h.debug.setDiveLaunching(false);
  await h.debug.setShipContact(false);
  await h.debug.setScreen(SCREEN);
  await h.debug.setPhase(PHASE);

  const before = await h.snapshot();
  assertGreaterThan(
    before.simTime,
    0,
    "the simulation time accumulated before the reset, which specs/" +
      "instrumentation.md has reset return to 0 — with none accrued there " +
      "would be nothing to restore",
  );
  assertGreaterThan(
    before.drones.length,
    0,
    "the drones standing before the reset, which it empties",
  );
  assertGreaterThan(
    before.bullets.length,
    0,
    "the bullets in flight before the reset, which it empties",
  );
  assertGreaterThan(
    before.bursts.length,
    0,
    `the bursts playing before the reset, which it empties — the kill above ` +
      `left one, and a burst plays for BURST_DURATION (specs/assets.md)`,
  );
  assertEqual(
    before.discharge.active,
    true,
    `the wave still live at the moment of the reset, inside its ` +
      `DISCHARGE_TIME (${DISCHARGE_TIME} s) window (specs/resonance.md)`,
  );

  await h.debug.reset();
  // Read with no frame between: simTime accumulates the time the sub-steps cover,
  // so a frame run between the reset and this reading would be reading the update.
  const title = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing reset still leaves the picture of the
  // screen it produced.
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "snapshot().screen after reset()");
  assertEqual(title.phase, "live", "snapshot().phase after reset()");
  assertEqual(title.phaseTimer, 0, "snapshot().phaseTimer after reset()");
  assertEqual(title.menuIndex, 0, "snapshot().menuIndex after reset()");
  assertEqual(title.score, 0, "snapshot().score after reset()");
  assertEqual(
    title.lives,
    START_LIVES,
    `snapshot().lives after reset(), which specs/instrumentation.md restores ` +
      `to START_LIVES (${START_LIVES})`,
  );
  assertEqual(title.stage, 1, "snapshot().stage after reset()");
  assertEqual(title.resonance, 0, "snapshot().resonance after reset()");
  assertEqual(
    title.inversion,
    0,
    "snapshot().inversion, in seconds remaining, after reset()",
  );

  assertLength(title.drones, 0, "the drones on the field after reset()");
  assertLength(title.bullets, 0, "the bullets in flight after reset()");
  assertLength(title.bursts, 0, "the bursts playing after reset()");
  assertEqual(
    title.discharge.active,
    false,
    `whether a discharge wave is still live after reset(), taken inside the ` +
      `DISCHARGE_TIME (${DISCHARGE_TIME} s) window of one that was`,
  );

  assertCloseTo(
    title.ship.x,
    LANE_CENTRE,
    PLACE_DIGITS,
    "snapshot().ship.x after reset(), which specs/instrumentation.md places " +
      "at the centre of the ship's lane",
  );
  assertEqual(title.ship.band, "cyan", "snapshot().ship.band after reset()");
  assertEqual(
    title.ship.lockout,
    0,
    "snapshot().ship.lockout, in seconds, after reset()",
  );
  assertEqual(
    title.ship.cooldown,
    0,
    "snapshot().ship.cooldown, in seconds, after reset()",
  );
  assertEqual(
    title.ship.contact,
    true,
    "snapshot().ship.contact after reset(), which restores the gate to on",
  );
  assertEqual(
    title.waveEntry,
    true,
    "snapshot().waveEntry after reset(), which restores the gate to on",
  );
  assertEqual(
    title.diveLaunching,
    true,
    "snapshot().diveLaunching after reset(), which restores the gate to on",
  );
  assertEqual(
    title.diveClock,
    0,
    "snapshot().diveClock, in seconds since the last launch, after reset()",
  );
  assertEqual(
    title.extraLifeAwarded,
    false,
    "snapshot().extraLifeAwarded after reset(), the run's one-extra-life latch",
  );
  assertEqual(
    title.challengeHits,
    0,
    "snapshot().challengeHits after reset(), the challenge stage's tally of " +
      "drones destroyed",
  );
  assertEqual(title.simTime, 0, "snapshot().simTime after reset()");

  // And the one field reset must not touch.
  assertEqual(
    title.muted,
    before.muted,
    "snapshot().muted after reset(), against the bit the snapshot reported a " +
      "moment before it — muting is a player preference the runtime owns, and " +
      "reset leaves it exactly as it stands",
  );
});
