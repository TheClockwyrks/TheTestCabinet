// audio/death-cue — the cue the ship being destroyed plays.
//
// `specs/audio.md` fixes `death` (`CUES.death`) as the cue played when "The ship is
// destroyed", on the tick its event happens.
//
// THE CONTACT IS REAL AND IT IS ONE OF THE THREE THE SPECIFICATION NAMES.
// `specs/collision.md` gives the ship exactly three lethal pairs — a rock, the
// saucer, and a saucer bullet — and `specs/progression.md` states that losing a
// ship costs one life. A Small rock is set drifting into a ship posed at rest, the
// ship's own contact gate is opened and its respawn grace posed clear, and the
// build's own collision pass resolves the contact. The tick the life count falls is
// the tick the ship was destroyed on.
//
// THE PAIR IS POSED FAR FROM THE STAR. The well pulls a rock at `MU / d^2`
// (`specs/gravity.md`), which at the safe point's own distance would overwhelm the
// drift this check arranges and turn the approach into a reading of the
// environment. Four hundred and seventy units out it is some twenty units per
// second squared, which moves the rock about a unit over the third of a second the
// approach takes — a hundredth of the contact circle it is closing on. The ship is
// never pulled at all (`specs/ship.md`), so it stays exactly where it was posed.
//
// THE APPROACH IS THE QUIET WINDOW. Some forty ticks of a rock drifting toward a
// ship, which `specs/audio.md` names no cue for, so a build that sounds as a rock
// nears the ship, or on a timer, is caught before the contact it is meant to sound
// on.
//
// WHAT THIS DOES NOT DECIDE. The life, which is `lives/rock-costs-a-life`'s; the
// respawn, which is `lives/respawn-*`'s; and the cue's NAME, which is not
// observable from outside an engineless build (`./cues.ts`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ROCK_RADIUS, SHIP_R, START_LIVES } from "../constants";
import {
  armAudio,
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

/**
 * Where the ship is posed, in logical field units.
 *
 * Down in the field's bottom-left, some 470 units from `(STAR_X, STAR_Y)`, so the
 * approach below is the drift this check arranged rather than the pull the well
 * exerts. Clear of every edge by more than the pair's radii, so nothing wraps.
 */
const SHIP_X = 200;
const SHIP_Y = 620;

/**
 * How far above the ship the rock is posed, in logical units.
 *
 * The pair touch when their centres are `SHIP_R + ROCK_RADIUS.small` (`28`) apart
 * (`specs/collision.md`), so a hundred units leaves seventy-two of approach: long
 * enough to be a quiet window with something visibly happening in it, short enough
 * that the well has moved the rock about a unit by the time it lands.
 */
const GAP = 100;

/**
 * The speed the rock is set drifting at, in units per second.
 *
 * Inside the `130` to `210` a Small's own drift runs at (`specs/rocks.md`) — a rock
 * moving no faster than the game itself sets one moving — and fast enough that the
 * approach is a third of a second rather than a stretch the well can bend.
 */
const CLOSING_SPEED = 200;

/**
 * The ticks the contact is watched for.
 *
 * The approach is `(GAP - SHIP_R - ROCK_RADIUS.small) / CLOSING_SPEED`, a third of
 * a second, so a whole second is three times over — a build whose swept contact
 * lands late still reaches its verdict rather than timing out.
 */
const WATCH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick the ship is destroyed, and not on the approach", async () => {
  await startPlaying(h);
  // A genuine, browser-trusted gesture: an engineless build's audio does not start
  // until the player has interacted with the page (`specs/audio.md`), and the key
  // is bound to nothing (`specs/controls.md`).
  await armAudio(h);

  await h.debug.setShipPosition(SHIP_X, SHIP_Y);
  await h.debug.setShipVelocity(0, 0);
  // The two faculties this point is about, back on: the lethal contact test, and a
  // ship with no grace left to ignore it with (`specs/progression.md`).
  await h.debug.setShipInvuln(0);
  await h.debug.setShipCollision(true);
  await poseRock(h, "small", SHIP_X, SHIP_Y - GAP, 0, CLOSING_SPEED);

  const death = await watchForEvent(
    h,
    (s) => s.lives < START_LIVES,
    WATCH_TICKS,
  );
  await captureStill(h, "death");

  assertEqual(
    death.hit,
    true,
    `the drifting Small destroyed the ship inside ${String(WATCH_TICKS)} ticks, ` +
      `closing ${String(GAP - SHIP_R - ROCK_RADIUS.small)} units at ` +
      `${String(CLOSING_SPEED)} units per second onto a ship with its contact ` +
      "gate open and no grace left (specs/collision.md)",
  );
  assertEqual(
    soundsBeforeEvent(death),
    0,
    `sounds the build emitted over the ${String(death.at - 1)} ticks of the rock's ` +
      "approach, on a field holding nothing but the ship and that rock — " +
      "specs/audio.md names no cue for a rock drifting",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(death),
    1,
    "sounds the build emitted on the tick the ship was destroyed — the ship being " +
      "destroyed plays CUES.death on that tick (specs/audio.md)",
  );
});
