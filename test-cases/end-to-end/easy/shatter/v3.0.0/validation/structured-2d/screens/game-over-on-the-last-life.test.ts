// screens/game-over-on-the-last-life — losing the last ship puts the game-over
// screen up.
//
// `specs/ui.md` fixes when the `gameover` screen is shown: "Shown on the tick
// the last ship is lost." `specs/progression.md` says what losing the last one
// is: "When the last ship is lost the life count reaches `0`, no new ship
// appears, and the game is over."
//
// THE CONTACT IS REAL AND IT IS ONE OF THE THREE THE SPECIFICATION NAMES.
// `specs/collision.md` gives the ship three lethal pairs — a rock, the saucer,
// and a saucer bullet — and this poses the first of them: a Small rock set
// drifting into a ship at rest, with the ship's own contact gate opened and its
// respawn grace posed clear, so the build's own collision pass resolves it. The
// screen is not posed and no life is spent by hand; the game loses its last ship
// the way it loses any ship.
//
// THE COUNTER IS THE EVENT, THE SCREEN IS THE READING. The field is sampled
// every tick, and the tick the life count first reads `0` is the tick the last
// ship was destroyed on. What this point asserts is the SCREEN at that tick and
// the one after it — one tick of latitude, because `specs/ui.md` puts the screen
// up "on the tick the last ship is lost" and a build that resolves its
// collisions after it has drawn the frame shows it one tick later without
// showing the player anything different. The counter itself is
// `lives/game-over-at-zero`'s point, and the ship that does not come back is
// `lives/respawn-only-with-lives-left`'s.
//
// AND THE SCREEN IS THE DEATH'S DOING. Every tick of the approach is read as
// well, and the screen must be `playing` on all of them: a build that puts its
// game-over screen up on a timer, or on entering a game with one ship left, is
// caught before the contact rather than passing on it.
//
// THE PAIR IS POSED FAR FROM THE STAR, some `510` units out, where the well
// pulls at about `20` units per second squared — so the approach is the drift
// this check arranged rather than a fall the environment produced, and the rock
// moves a unit or so over the third of a second it takes.
//
// THE FIELD HOLDS NOTHING ELSE. `startPlaying` clears it and holds the wave loop
// and the saucer's arrival off, so the only contact available is the one posed.
//
// WHAT THIS DOES NOT DECIDE. The life count (`lives/game-over-at-zero`), the
// respawn that does not happen (`lives/respawn-only-with-lives-left`), what the
// game-over screen then shows (`screens/game-over-shows-the-score`,
// `screens/game-over-shows-the-wave`), and the cue
// (`audio/death-cue`).

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SHIP_R } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  sampleEvery,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the ship is posed, in logical field units.
 *
 * The field's bottom-left, some `510` units from `(STAR_X, STAR_Y)`, so the
 * approach below is the drift this check arranged rather than the pull the well
 * exerts. Clear of every edge by more than the pair's radii, so nothing wraps.
 */
const SHIP_X = 200;
const SHIP_Y = 620;

/**
 * How far above the ship the rock is posed, in logical units.
 *
 * The pair touch when their centres are `SHIP_R + ROCK_RADIUS.small` (`28`)
 * apart (`specs/collision.md`), so a hundred units leaves seventy-two of
 * approach: long enough to be a window in which a build that shows its game-over
 * screen early is caught, short enough that the well has moved the rock about a
 * unit by the time it lands.
 */
const GAP = 100;

/**
 * The speed the rock is set drifting at, in units per second.
 *
 * Inside the `130` to `210` a Small's own drift runs at (`specs/rocks.md`) — a
 * rock moving no faster than the game itself sets one moving — and fast enough
 * that the approach is a third of a second rather than a stretch the well can
 * bend.
 */
const CLOSING_SPEED = 200;

/** The ships the run has left when the contact lands: this is the last one. */
const LAST_SHIP = 1;

/**
 * The ticks the contact is watched for.
 *
 * The approach is `(GAP - SHIP_R - ROCK_RADIUS.small) / CLOSING_SPEED`, a third
 * of a second, so a whole second is three times over — a build whose swept
 * contact lands late still reaches its verdict rather than timing out.
 */
const WATCH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the gameover screen on the tick the last ship is destroyed", async () => {
  // Live play with one ship left, on an empty field holding one drifting rock.
  startPlaying(h);
  h.debug.setLives(LAST_SHIP);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipVelocity(0, 0);
  // The two faculties this point is about, back on: the lethal contact test, and
  // a ship with no grace left to ignore it with (specs/collision.md).
  h.debug.setShipInvuln(0);
  h.debug.setShipCollision(true);
  poseRock(h, "small", SHIP_X, SHIP_Y - GAP, 0, CLOSING_SPEED);

  const ticks = await sampleEvery(h, WATCH_TICKS, 1, (s) => ({
    lives: s.lives,
    screen: s.screen,
  }));
  captureStill(h, "gameover");

  const lost = ticks.findIndex((tick) => tick.lives < LAST_SHIP);
  assertGreaterThanOrEqual(
    lost,
    0,
    `the tick, of ${String(ticks.length)} sampled, on which the drifting ` +
      `Small destroyed the last ship — it closes ` +
      `${String(GAP - SHIP_R - ROCK_RADIUS.small)} units at ` +
      `${String(CLOSING_SPEED)} units per second onto a ship with its contact ` +
      "gate open and no grace left (specs/collision.md), and losing that ship " +
      "takes the count to 0 (specs/progression.md)",
  );

  for (let tick = 0; tick < lost; tick += 1) {
    assertEqual(
      ticks[tick].screen,
      "playing",
      `the screen on tick ${String(tick)} of the rock's approach, ` +
        `${String(lost - tick)} ticks before the contact — the game-over ` +
        "screen is shown on the tick the last ship is lost (specs/ui.md), so " +
        "a game still being played is on playing",
    );
  }

  assertEqual(
    ticks[Math.min(lost + 1, ticks.length - 1)].screen,
    "gameover",
    `the screen one tick after the last ship was destroyed, on tick ` +
      `${String(lost)} of the sampled span — the game-over screen is shown on ` +
      "the tick the last ship is lost (specs/ui.md)",
  );
});
