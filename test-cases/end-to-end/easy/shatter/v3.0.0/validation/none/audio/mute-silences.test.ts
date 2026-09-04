// audio/mute-silences — with sound muted, the events that raise cues raise nothing
// audible.
//
// `specs/audio.md`: "the mute key toggles it from any screen. While sound is muted
// every cue is silent and the game stays fully playable." `specs/controls.md` binds
// that key: `KeyM`, read as a press edge, once per press.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT. `specs/instrumentation.md` carries
// no operation that sets it — "there is no operation that sets it: mute is reached
// the way a player reaches it, through its key in `specs/controls.md`, and the
// snapshot reports the result" — so the key is really pressed and `muted` is read
// back before anything else is driven.
//
// THREE EVENTS, BECAUSE THE ITEM IS ABOUT THE BUS AND NOT ABOUT ONE CUE. A shot
// taken with the real fire key, a rock destroyed by a real round, and a real fatal
// contact: three different cues on three different paths, each of which its own
// point has already proved sounds when the bus is open. Every one of them is driven
// here with the bus muted, and the whole stretch has to be silent.
//
// SILENCE IS READ BOTH WAYS THE HARNESS CAN HEAR IT. Nothing attributed to any
// driven tick (`watchCues`), and nothing at all across the stretch (`sounds()`,
// which also counts a sound a build emits from a key's own event handler, at a
// moment no tick accounts for). A build that answers a muted bus by playing at zero
// gain is still starting a source and is still caught: `specs/audio.md` says every
// cue is SILENT, and a source started at zero gain is a sound the browser
// scheduled.
//
// WHAT THIS DOES NOT DECIDE. That the key toggles the reported bit, which is
// `controls/mute-m`'s; that the game stays playable while muted, which is what the
// three events being reached at all shows here and what the rest of the checklist
// grades in full.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import {
  FACE_UP,
  KEY_FIRE,
  KEY_MUTE,
  ROCK_RADIUS,
  SHIP_R,
  START_LIVES,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  shootRock,
  startPlaying,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/** Where the ship is posed: far from the star, so the fatal contact below is a drift. */
const SHIP_X = 200;
const SHIP_Y = 620;

/** Where the rock that is shot down is posed, far out from the well. */
const ROCK_X = 250;
const ROCK_Y = 200;

/** How far above the ship the fatal rock is posed, in logical units. */
const GAP = 100;

/** The speed that rock is set drifting at, inside a Small's own range (`specs/rocks.md`). */
const CLOSING_SPEED = 200;

/** The ticks the held fire key is given to produce its round (`specs/weapons.md`). */
const SHOT_TICKS = 4;

/** The ticks a round placed on a rock's doorstep is given to land. */
const FLIGHT_TICKS = ticksFor(0.25);

/** The ticks the fatal contact is watched for: three times the approach it takes. */
const CONTACT_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("emits nothing across a shot, a shatter and a death while muted", async () => {
  await startPlaying(h);
  // A genuine, browser-trusted gesture: an engineless build's audio does not start
  // until the player has interacted with the page (`specs/audio.md`). The key is
  // bound to nothing (`specs/controls.md`), so arming neither mutes nor lifts a mute.
  await h.armAudio();

  const opening = await h.snapshot();
  assertEqual(
    opening.muted,
    false,
    "a page that has had no mute key pressed on it reports sound on, which is " +
      "what makes the press below a mute rather than an unmute",
  );
  await h.tap(KEY_MUTE);
  const muted = await h.snapshot();
  assertEqual(
    muted.muted,
    true,
    `${KEY_MUTE} toggles sound from any screen and the snapshot reports the ` +
      "result (specs/controls.md, specs/instrumentation.md)",
  );

  // Everything from here is read for silence: the ticks, and the running total.
  const played = watchCues(h);
  const before = await h.sounds();

  await h.debug.setShipPosition(SHIP_X, SHIP_Y);
  await h.debug.setShipVelocity(0, 0);
  await h.debug.setShipAngle(FACE_UP);
  await h.debug.setFireCooldown(0);

  // 1. A shot, taken with the key rather than placed: the gun is what raises
  //    CUES.fire (specs/audio.md).
  await h.hold(KEY_FIRE);
  const shot = await h.until((s) => s.bullets.length > 0, {
    maxTicks: SHOT_TICKS,
    poll: 1,
  });
  await h.release(KEY_FIRE);
  assertEqual(
    shot.hit,
    true,
    `the gun took a shot inside ${String(SHOT_TICKS)} ticks of ${KEY_FIRE} going ` +
      "down — a muted game stays fully playable (specs/audio.md)",
  );
  await h.debug.clearBullets();

  // 2. A rock destroyed by a real round: what raises CUES.shatter.
  const rock = await poseRock(h, "small", ROCK_X, ROCK_Y);
  const kill = await shootRock(h, rock, { maxTicks: FLIGHT_TICKS });
  assertUndefined(
    rockById(kill.snapshot, rock),
    `the posed Small was destroyed inside ${String(FLIGHT_TICKS)} ticks by a ` +
      "round placed on its doorstep (specs/collision.md)",
  );

  // 3. A fatal contact: what raises CUES.death.
  await h.debug.setShipInvuln(0);
  await h.debug.setShipCollision(true);
  await poseRock(h, "small", SHIP_X, SHIP_Y - GAP, 0, CLOSING_SPEED);
  const death = await h.until((s) => s.lives < START_LIVES, {
    maxTicks: CONTACT_TICKS,
    poll: 1,
  });
  await captureStill(h, "muted");
  assertEqual(
    death.hit,
    true,
    `the drifting Small destroyed the ship inside ${String(CONTACT_TICKS)} ` +
      `ticks, closing ${String(GAP - SHIP_R - ROCK_RADIUS.small)} units at ` +
      `${String(CLOSING_SPEED)} units per second (specs/collision.md)`,
  );

  assertEqual(
    played.length,
    0,
    "sounds attributed to a driven tick across the shot, the shatter and the " +
      "death — while sound is muted every cue is silent (specs/audio.md)",
  );
  assertEqual(
    (await h.sounds()) - before,
    0,
    "sounds the build emitted anywhere across the three events, ticks or not — " +
      "a source started at zero gain is still a sound the browser scheduled, and " +
      "specs/audio.md requires silence",
  );
});
