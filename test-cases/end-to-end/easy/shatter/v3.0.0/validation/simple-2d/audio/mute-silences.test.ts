// audio/mute-silences — a muted game stays fully playable.
//
// `specs/audio.md`: "Muting belongs to the engine. The game binds the mute action
// to the engine's mute bit and toggles it from any screen. While sound is muted
// every cue is silent and the game stays fully playable." `specs/controls.md` binds
// that action to `KeyM`, read as a press edge, once per press.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT. `specs/instrumentation.md` carries
// no operation that sets it — "There is therefore no operation that sets muting:
// mute is reached the way a player reaches it, through its action in
// `specs/controls.md`, and the snapshot reports the result" — so the key is really
// pressed and `muted` is read back before anything else is driven.
//
// WHAT SILENCE IS ON THIS ENGINE IS THE ENGINE'S. `specs/audio.md` puts muting
// with the runtime — "Muting belongs to the engine" — and the bus zeroes the gain
// of every play it makes while the mute bit is set, so a reading of that gain
// returns the same verdict for every build on this engine. What is the BUILD's is
// that its mute action really reached the bit, and that the game went on running
// with it set. Under `none` the build writes the audio layer itself, so its
// silence is its own and `validation/none/audio/mute-silences.test.ts` reads the
// sounds that started.
//
// THREE EVENTS, BECAUSE THE POINT IS ABOUT THE GAME AND NOT ABOUT ONE CUE. A shot
// taken with the real fire key, a rock destroyed by a real round, and a real fatal
// contact: three of the game's own paths, each raising a cue its own point has
// already proved sounds when the bus is open. Every one of them is driven here with
// the bus muted, and each is asserted to have HAPPENED — "the game stays fully
// playable" is the half of that sentence this point decides.
//
// WHAT THIS DOES NOT DECIDE. That the key toggles the reported bit, which is
// `controls/mute-m`'s.

import { afterEach, beforeEach, it } from "vitest";
import { MUZZLE_SPEED, ROCK_RADIUS, SHIP_R, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  aimedRound,
  captureStill,
  createHarness,
  holdAction,
  keyFor,
  poseBullet,
  poseRock,
  releaseAction,
  rockById,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The facing the shot is taken along: `+x`, across the field and clear of the star. */
const ACROSS_THE_FIELD = 0;

/** Where the ship is posed for the fatal contact: far from the star, as in `audio/death-cue`. */
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

afterEach(() => {
  h?.dispose();
});

it("takes a shot, destroys a rock and loses the ship with sound muted", async () => {
  startPlaying(h);
  // One tick, so the game has run an update and `muted` is its refreshed copy of
  // the runtime's bit rather than an opening value (specs/instrumentation.md).
  await h.advance(1);
  assertEqual(
    h.snapshot().muted,
    false,
    "a game on which no mute key has been pressed reports sound on, which is " +
      "what makes the press below a mute rather than an unmute",
  );

  await tapAction(h, "mute");
  assertEqual(
    h.snapshot().muted,
    true,
    `${keyFor("mute")} toggles sound from any screen and the snapshot reports ` +
      "the result (specs/controls.md, specs/instrumentation.md)",
  );

  // 1. A shot, taken with the key rather than placed: the gun is what raises
  //    CUES.fire (specs/audio.md).
  h.debug.setShipAngle(ACROSS_THE_FIELD);
  h.debug.setFireCooldown(0);
  holdAction(h, "a");
  const shot = await h.until((s) => s.bullets.length > 0, {
    maxFrames: SHOT_TICKS,
  });
  releaseAction(h, "a");
  h.debug.clearBullets();

  // 2. A rock destroyed by a real round: what raises CUES.shatter.
  const rock = poseRock(h, "small", ROCK_X, ROCK_Y);
  const target = rockById(
    h.snapshot(),
    rock,
    "the Small this check destroys while muted (specs/instrumentation.md)",
  );
  const round = aimedRound(target);
  poseBullet(h, round.x, round.y, round.vx, round.vy);
  const kill = await h.until((s) => !s.rocks.some((one) => one.id === rock), {
    maxFrames: FLIGHT_TICKS,
  });

  // 3. A fatal contact: what raises CUES.death.
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipInvuln(0);
  h.debug.setShipCollision(true);
  poseRock(h, "small", SHIP_X, SHIP_Y - GAP, 0, CLOSING_SPEED);
  const death = await h.until((s) => s.lives < START_LIVES, {
    maxFrames: CONTACT_TICKS,
  });
  captureStill(h, "muted");

  assertEqual(
    shot.hit,
    true,
    `the gun took a shot inside ${String(SHOT_TICKS)} ticks of ` +
      `${keyFor("a")} going down — a muted game stays fully playable ` +
      "(specs/audio.md)",
  );
  assertEqual(
    kill.hit,
    true,
    `the posed Small was destroyed inside ${String(FLIGHT_TICKS)} ticks by a ` +
      `round closing at ${String(MUZZLE_SPEED)} units per second — a muted game ` +
      "stays fully playable (specs/collision.md, specs/audio.md)",
  );
  assertEqual(
    death.hit,
    true,
    `the drifting Small destroyed the ship inside ${String(CONTACT_TICKS)} ` +
      `ticks, closing ${String(GAP - SHIP_R - ROCK_RADIUS.small)} units at ` +
      `${String(CLOSING_SPEED)} units per second — a muted game stays fully ` +
      "playable (specs/collision.md, specs/audio.md)",
  );
});
