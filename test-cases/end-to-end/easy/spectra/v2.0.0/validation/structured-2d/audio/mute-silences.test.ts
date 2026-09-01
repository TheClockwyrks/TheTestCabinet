// audio/mute-silences — with sound muted, the game starts no sound at all.
//
// `specs/ui.md` states the rule at SOURCE strength, and that is what makes it
// assertable under an engine: "While sound is muted the game starts no sound at
// all: it plays no cue rather than playing one for the bus to silence, so no cue
// reaches the bus while muted."
//
// That is a rule about the GAME, not about the bus. The engine's bus announces
// every `play` and every `loop` whether or not it is muted, and reports a muted
// one at `gain: 0` — so a build that mutes by handing the bus every cue and
// letting it silence them is plainly visible here, and fails the rule as stated
// rather than being caught by an unstated one.
//
// So the measurement is: mute the game through its own binding, then raise three
// of the nine events on a posed field — a shot, a flip, and a matching kill — and
// read everything the build started on the bus across the whole of it.
//
// THE THREE EVENTS ARE ASSERTED TO HAVE HAPPENED. A build that answers no key and
// destroys nothing would reach the bus with nothing either, and would pass a check
// that read only the silence. So each event is confirmed on its own before the
// silence is: a bullet left the ship, the ship's band changed, and the drone left
// the roster.
//
// THE ORDER IS FIRE, THEN FLIP, THEN KILL, and it is forced. `specs/bands.md` has
// the flip start a `FLIP_LOCKOUT` (`0.30`) second lockout "during which the ship
// cannot fire", so a flip before the shot would block it. The kill is driven by a
// bullet placed on the field rather than by the cannon, so the lockout does not
// reach it.
//
// A FOURTH EVENT RIDES ALONG, AND IT ONLY STRENGTHENS THIS. The world holds
// exactly the one drone the kill is about, so a build that reads `specs/stages.md`'s
// "the last drone of its wave" as the drones ON THE FIELD clears the stage on the
// frame that drone dies; the clear is a fifth cue such a build must also leave
// unplayed while muted, and the reading below covers it.
//
// WHAT THIS DOES NOT DECIDE. That `KeyM` is mute's binding, or that the HUD shows
// the mute state, which are `controls/mute-m`'s and `screens/mute-indicator`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  BINDINGS,
  FIRE_INTERVAL,
  PLAYER_BULLET_SPEED,
} from "../../src/constants";
import { assertEqual, assertLength, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  playerBullets,
  poseDrone,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { posedDrone, watchSounds } from "./cues";

/** The keys `specs/controls.md` binds the three actions this check drives. */
const MUTE_KEY = BINDINGS.mute[0];
const FIRE_KEY = BINDINGS.a[0];
const FLIP_KEY = BINDINGS.b[0];

/** Where the target Shard stands: clear of the ship's lane at `LANE_CENTER`. */
const TARGET_X = 400;
const TARGET_Y = 300;

/** How far below the drone the bullet starts, in logical units. */
const SHOT_BELOW = 200;

/**
 * Frames the held fire key is given to put a bullet on the field.
 *
 * `startPosed` leaves the cooldown, the cap and the lockout all clear, so a
 * conforming build fires on the first frame it reads the key down; a build that
 * waits out a whole cadence tick still fires inside `FIRE_INTERVAL` (`0.16`). Two
 * frames of slack cover the frame the key-down is delivered on.
 */
const FIRE_FRAMES = ticksFor(FIRE_INTERVAL) + 2;

/**
 * Frames the posed shot is given to climb into the drone.
 *
 * The time to climb the whole `SHOT_BELOW` at `PLAYER_BULLET_SPEED` (`760`) —
 * geometry, not a tolerance — plus two frames for the frame it is placed on.
 */
const CLIMB_FRAMES = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts no sound at all while the game is muted", async () => {
  // An empty, quiet, live wave, then the one drone the kill is about, posed as a
  // prop: no travel, no oscillation, no fire.
  startPosed(h);
  const targetId = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });

  // Muted through the key specs/controls.md binds, which is how a player mutes.
  await h.tap(MUTE_KEY);
  const muted = h.snapshot();
  assertEqual(
    muted.muted,
    true,
    `the ${String(MUTE_KEY)} key muted the game, mute being toggled from any ` +
      "screen (specs/controls.md)",
  );

  // Every sound the build starts from here on, by either of the bus's two doors.
  const started = watchSounds(h);

  // 1. A shot, fired by the ship's own cannon.
  h.hold(FIRE_KEY);
  const fired = await h.until((s) => playerBullets(s).length > 0, {
    maxFrames: FIRE_FRAMES,
  });
  h.release(FIRE_KEY);

  // 2. A flip, pressed on the key the `b` action is bound to.
  await h.tap(FLIP_KEY);
  const flipped = h.snapshot();

  // 3. A matching kill, by a bullet placed below the target so the flip's lockout
  //    cannot block it.
  const target = posedDrone(h, targetId);
  posePlayerBullet(h, target.x, target.y + SHOT_BELOW, target.effectiveBand);
  const killed = await h.until((s) => droneById(s, targetId) === undefined, {
    maxFrames: CLIMB_FRAMES,
  });

  const heard = [...started];
  const ended = h.snapshot();
  captureStill(h, "muted");

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
  assertLength(
    heard,
    0,
    "cues the build started on the bus while muted, over a shot, a flip and a " +
      "matching kill — while sound is muted the game plays no cue rather than " +
      `playing one for the bus to silence (specs/ui.md); it started ${heard
        .map((one) => `${one.cue} (${one.how})`)
        .join(", ")}`,
  );
});
