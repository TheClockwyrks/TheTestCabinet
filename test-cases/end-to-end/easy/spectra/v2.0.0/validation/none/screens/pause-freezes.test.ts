// Spectra — screens/pause-freezes: the pause holds the whole field still.
//
// THE RULE. `specs/ui.md`, on `paused`: "The field stays visible behind the menu
// and is frozen: no drone moves, no bullet travels, no phase timer runs, none of
// the clocks the wave keeps advances, and no cue plays, so a paused game is
// exactly where it was when it was paused." This point reads the positions —
// every drone, every bullet, and the ship — which is what the review item states.
//
// WHAT IS POSED, AND WHY EACH PIECE IS THERE. Each is a thing that WOULD have
// moved a long way over the ten seconds if the pause did not hold it, so the
// difference between a frozen field and a running one is hundreds of units rather
// than a rounding error:
//
//   - a Shard in phase `diving` with its travel gated ON, which is the one drone
//     faculty this point is about. It would fly its dive at `DIVE_SPEED` (`300`)
//     and be off the bottom of the field several times over;
//   - one of the player's bullets in flight, which climbs at
//     `PLAYER_BULLET_SPEED` (`760`) and would have left the field — and the roster
//     — inside half a second;
//   - one enemy bullet, which falls at `ENEMY_BULLET_SPEED` (`320`) and would have
//     done the same downward;
//   - the ship, parked off the centre of its lane, WITH A DIRECTION KEY HELD DOWN
//     for the whole ten seconds. `specs/controls.md` does not list `left` among
//     the actions the `paused` screen reads, so a held `ArrowLeft` must move
//     nothing; without it the ship stands still on a frozen field and on a running
//     one alike, and the reading would decide nothing.
//
// THE SHIP'S CONTACT GATE IS SHUT by `startPosed`, so the enemy bullet and the
// diving Shard posed near the ship's half of the field cannot cost a life if the
// build fails to freeze — which would enter the `ready` phase and stop the wave
// before the reading. The two other world gates are shut for the same reason: an
// unfrozen field must be caught HERE, by what moved, rather than by a wave that
// released drones of its own into the middle of it.
//
// THE TEN SECONDS ARE RUN OFF CAMERA with `skip`, which runs the same real update
// the loop runs without opening recorded frames.
//
// THE TOLERANCE. A hundredth of a logical unit. It is room for a build that
// integrates a zero rate over a frame and lands a float away, not room for
// movement: everything posed above travels hundreds of units in ten seconds of a
// running field.
//
// WHAT IS NOT ASSERTED. That a key opens the paused screen at all is
// `controls/pause-escape`'s and `controls/pause-p`'s; that resuming returns the
// wave as it was is `controls/pause-resumes`'s; what the screen DRAWS is
// `screens/pause-menu-items`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, fail } from "../assert";
import { BINDINGS, SHIP_X_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  lastBullet,
  poseDrone,
  requireBullet,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";

/** How long the field is held on the paused screen, in seconds. */
const PAUSED_SECONDS = 10;

/**
 * How far anything may have drifted, in logical units.
 *
 * A hundredth of a unit: room for a build's own arithmetic over six hundred
 * frames, and four orders of magnitude below the hundreds of units each posed
 * thing travels in ten seconds of a running field.
 */
const STILL_TOLERANCE = 0.01;

/** Where each posed thing stands, all clear of one another. */
const DIVER_AT = { x: 300, y: 200 } as const;
const PLAYER_SHOT_AT = { x: 900, y: 400 } as const;
const ENEMY_SHOT_AT = { x: 1100, y: 200 } as const;
const SHIP_AT = 500;

/** A direction key `specs/controls.md` says the paused screen does not read. */
const LEFT_KEY = BINDINGS.left[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every drone, bullet and the ship exactly where the pause found them", async () => {
  await startPosed(h);
  const diver = await poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
  });
  await h.debug.addPlayerBullet(PLAYER_SHOT_AT.x, PLAYER_SHOT_AT.y, "cyan");
  const playerShot = lastBullet(await h.snapshot());
  await h.debug.addEnemyBullet(ENEMY_SHOT_AT.x, ENEMY_SHOT_AT.y, "magenta");
  const enemyShot = lastBullet(await h.snapshot());
  await h.debug.setShipX(SHIP_AT);
  if (playerShot === undefined || enemyShot === undefined) {
    fail(
      "addPlayerBullet and addEnemyBullet to append a bullet to the roster " +
        "(specs/instrumentation.md)",
      `player ${String(playerShot?.id)}, enemy ${String(enemyShot?.id)}`,
    );
  }

  await h.debug.setScreen("paused");
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.screen, "paused", "the game is on the paused screen");
  assertEqual(
    before.bullets.length,
    2,
    "precondition: both posed bullets are in flight",
  );
  assertEqual(
    before.drones.length,
    1,
    "precondition: the posed diver is the only drone on the field",
  );
  assertCloseTo(
    before.ship.x,
    SHIP_AT,
    STILL_TOLERANCE,
    "precondition: the ship is parked where it was posed",
  );

  // Ten seconds of the build's own update, with a direction key held throughout.
  await h.hold(LEFT_KEY);
  await h.skip(PAUSED_SECONDS);
  await h.release(LEFT_KEY);
  await h.advance(1);
  await captureStill(h, "frozen");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "paused",
    "the game is still on the paused screen after the hold",
  );

  const divedBefore = requireDrone(before, diver, "the paused diver");
  const divedAfter = requireDrone(after, diver, "the paused diver");
  assertCloseTo(
    divedAfter.x,
    divedBefore.x,
    STILL_TOLERANCE,
    `the diving drone's x after ${PAUSED_SECONDS} paused seconds — no drone ` +
      "moves while the field is frozen (specs/ui.md)",
  );
  assertCloseTo(
    divedAfter.y,
    divedBefore.y,
    STILL_TOLERANCE,
    `the diving drone's y after ${PAUSED_SECONDS} paused seconds — no drone ` +
      "moves while the field is frozen (specs/ui.md)",
  );

  for (const shot of [playerShot, enemyShot]) {
    const wasAt = requireBullet(before, shot.id, "a paused bullet");
    const isAt = requireBullet(after, shot.id, "a paused bullet");
    assertCloseTo(
      isAt.x,
      wasAt.x,
      STILL_TOLERANCE,
      `the ${wasAt.friendly ? "player's" : "enemy"} bullet's x after ` +
        `${PAUSED_SECONDS} paused seconds — no bullet travels while the field ` +
        "is frozen (specs/ui.md)",
    );
    assertCloseTo(
      isAt.y,
      wasAt.y,
      STILL_TOLERANCE,
      `the ${wasAt.friendly ? "player's" : "enemy"} bullet's y after ` +
        `${PAUSED_SECONDS} paused seconds — no bullet travels while the field ` +
        "is frozen (specs/ui.md)",
    );
  }

  assertCloseTo(
    after.ship.x,
    before.ship.x,
    STILL_TOLERANCE,
    `the ship's x after ${PAUSED_SECONDS} paused seconds with ${LEFT_KEY} held ` +
      `down — the paused screen reads no movement action (specs/controls.md) ` +
      `and the field is frozen (specs/ui.md); the lane's clamp would have put ` +
      `it at ${SHIP_X_MIN}`,
  );
});
