// audio/mute-silences — with sound muted, the game starts no sound at all.
//
// `specs/ui.md` states the rule at SOURCE strength, and that is what makes it
// assertable: "While sound is muted the game starts no sound at all: a muted cue
// is not played and then silenced, it is not played, so no source is started and
// no node is scheduled for it."
//
// So the measurement is: mute the game, then raise three of the nine events on a
// posed field — a shot, a flip, and a matching kill — and read the build's raw
// source count across the whole of it. `validation/audio-init.js` counts what
// goes through the two doors a browser can emit sound through (a Web Audio source
// being `start()`ed, whatever kind it is, and an `<audio>` element being played),
// so a build that mutes by riding a gain node down to zero still shows every
// source it started, and fails the rule as stated rather than being caught by an
// unstated one.
//
// THE THREE EVENTS ARE ASSERTED TO HAVE HAPPENED. A build that answers no key and
// destroys nothing would emit no sound either, and would pass a check that read
// only the silence. So each event is confirmed on its own before the silence is:
// a bullet left the ship, the ship's band changed, and the drone left the roster.
//
// THE ORDER IS FIRE, THEN FLIP, THEN KILL, and it is forced. `specs/bands.md` has
// the flip start a `FLIP_LOCKOUT` (`0.30`) second lockout "during which the ship
// cannot fire", so a flip before the shot would block it. The kill is driven by a
// bullet placed on the field rather than by the cannon, so the lockout does not
// reach it.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST, before the game is muted. A build is free
// to open its audio context only from a genuine browser gesture, and a check that
// never gave it one would read silence from a build that was merely waiting —
// silence proving nothing. Arming first means the build had every opportunity to
// make a sound and did not.
//
// WHAT THIS DOES NOT DECIDE. That `KeyM` is mute's binding, or that the HUD shows
// the mute state, which are `controls/mute-m`'s and `screens/mute-indicator`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { BINDINGS, FIRE_INTERVAL, PLAYER_BULLET_SPEED } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  framesFor,
  playerBullets,
  poseBystander,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseShotBelow } from "./cues";

/** The keys `specs/controls.md` binds the three actions this check uses. */
const MUTE_KEY = BINDINGS.mute[0];
const FIRE_KEY = BINDINGS.a[0];
const FLIP_KEY = BINDINGS.b[0];

/** Where the target Shard stands: clear of the ship's lane and of the bystander. */
const TARGET_X = 400;
const TARGET_Y = 300;

/** How far below the drone the bullet starts, in logical units. */
const SHOT_BELOW = 200;

/**
 * Frames the held fire key is given to put a bullet on the field.
 *
 * `startPosed` leaves the cooldown, the cap and the lockout all clear, so a
 * conforming build fires on the first frame it reads the key down; a build that
 * waits out a whole cadence tick still fires inside `FIRE_INTERVAL` (`0.16`).
 * Two frames of slack cover the frame the key-down is delivered on.
 */
const FIRE_FRAMES = framesFor(FIRE_INTERVAL) + 2;

/**
 * Frames the shot is given to climb into the drone.
 *
 * The time to climb the whole `SHOT_BELOW` at `PLAYER_BULLET_SPEED` (`760`) —
 * geometry, not a tolerance — plus two frames for the frame it is placed on.
 */
const CLIMB_FRAMES = framesFor(SHOT_BELOW / PLAYER_BULLET_SPEED) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts no sound at all while the game is muted", async () => {
  // Armed BEFORE the mute, so the build's audio has been opened by a genuine
  // browser gesture and the silence below is a choice rather than a wait. The key
  // is bound to nothing, so this changes no game state.
  await h.armAudio();
  // An empty, quiet, live wave, then exactly two drones: the target, and the
  // bystander that keeps the wave from clearing on the kill and raising a fourth
  // event inside the window.
  await startPosed(h);
  await poseBystander(h);
  const targetId = await poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: "cyan",
  });

  // Muted through the key `specs/controls.md` binds, which is how a player mutes.
  await h.tap(MUTE_KEY);
  const muted = await h.snapshot();
  assertEqual(
    muted.muted,
    true,
    `the ${String(MUTE_KEY)} key muted the game, mute being toggled from any ` +
      "screen (specs/controls.md)",
  );

  // Every sound the build starts from here on, counted at the source.
  const before = await h.sounds();

  // 1. A shot, fired by the ship's own cannon.
  await h.hold(FIRE_KEY);
  const fired = await h.until((s) => playerBullets(s).length > 0, {
    maxFrames: FIRE_FRAMES,
  });
  await h.release(FIRE_KEY);

  // 2. A flip, pressed on the key the `b` action is bound to.
  await h.tap(FLIP_KEY);
  const flipped = await h.snapshot();

  // 3. A matching kill, by a bullet placed below the target so the flip's lockout
  //    cannot block it.
  const target = requireDrone(
    await h.snapshot(),
    targetId,
    "the shot's target",
  );
  await poseShotBelow(h, target.x, target.y, target.effectiveBand, SHOT_BELOW);
  const killed = await h.until((s) => droneById(s, targetId) === undefined, {
    maxFrames: CLIMB_FRAMES,
  });

  const after = await h.sounds();
  const ended = await h.snapshot();
  await captureStill(h, "muted");

  assertEqual(
    fired.hit,
    true,
    `a shot left the ship inside the ${String(FIRE_FRAMES)} frames after the ` +
      `${String(FIRE_KEY)} key went down, so the muted game really did fire ` +
      "(specs/ship.md)",
  );
  assertNotEqual(
    flipped.ship.band,
    muted.ship.band,
    `the ${String(FLIP_KEY)} key changed the ship's band, so the muted game ` +
      "really did flip (specs/bands.md)",
  );
  assertEqual(
    killed.hit,
    true,
    `the ${target.effectiveBand} shot destroyed the drone inside the ` +
      `${String(CLIMB_FRAMES)} frames its climb takes, so the muted game really ` +
      "did kill (specs/bands.md)",
  );
  assertEqual(
    ended.muted,
    true,
    "the game was still muted when the three events had run, so the silence " +
      "below was read under mute throughout (specs/ui.md)",
  );
  assertEqual(
    after - before,
    0,
    "sounds the build started while muted, over a shot, a flip and a matching " +
      "kill — while sound is muted the game starts no sound at all, so no " +
      "source is started and no node is scheduled (specs/ui.md)",
  );
});
