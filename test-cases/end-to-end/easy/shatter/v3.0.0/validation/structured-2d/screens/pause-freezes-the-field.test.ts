// screens/pause-freezes-the-field — the paused screen advances nothing.
//
// `specs/ui.md`, on `paused`: "The field stays visible behind the menu and is
// frozen: nothing advances. No body moves, no timer runs down, no wave arrives,
// no rock spawns, no saucer arrives or fires, and no cue plays, so a paused game
// is exactly where it was when it was paused. The accumulated simulation time
// goes on rising: it counts the ticks the game ran rather than the play it ran."
//
// EXACTLY, WITH NO TOLERANCE, AND THAT IS DELIBERATE. "Nothing advances" is not
// a bound to be met approximately: a frozen body is at the number it was at.
// Every reading below is compared with `assertEqual`, so a build that steps its
// world by one tick behind the menu fails naming the field that moved, and there
// is no threshold anywhere in this file to argue about.
//
// A BODY, A ROUND AND THREE CLOCKS, so a failure names WHICH kind of thing the
// build went on advancing:
//
//   - a Medium rock DRIFTING at a speed inside its own range, so two seconds of
//     an unfrozen field would carry it hundreds of units;
//   - one of the ship's rounds in flight, whose `life` a running field spends —
//     `specs/weapons.md` gives a round `BULLET_LIFE` (`1.5` s), less than the two
//     seconds this check waits, so an unfrozen field would not merely move the
//     round, it would expire it;
//   - the ship's respawn grace, the gun's gate, and the `WAVE N` banner, each
//     posed with time left on it.
//
// THE PAIR IS POSED ON THE QUIET GROUND, `fixtures.ts`'s `QUIET_CORNER` and its
// opposite, `412` units from the star where the well pulls at some `26` units
// per second squared. The rock and the round are on opposite diagonals so
// neither can reach the other, and neither is near the core. Nothing here rests
// on that being far — a frozen field does not move at all — but it keeps an
// UNFROZEN build's failure legible as the drift this check arranged rather than
// as a body the well swallowed.
//
// THE FIELD IS EMPTY BUT FOR THOSE TWO, AND THE GATES ARE OFF, so a rock that
// moved moved because the build advanced it. `startPlaying` holds the wave loop,
// the saucer's arrival and the ship's lethal contact off; the banner posed on
// top of that still runs down on an unfrozen field, because
// `specs/instrumentation.md` says of `setWaveSpawning` that "A banner already
// running still runs down".
//
// THE PAUSE IS POSED DIRECTLY, through `setScreen("paused")`, which "spawns
// nothing and clears nothing" (`specs/instrumentation.md`). Which key pauses is
// `controls/pause-p`'s and `controls/pause-escape`'s.
//
// WHAT THIS DOES NOT DECIDE. What the pause menu shows
// (`screens/pause-menu-entries`), where its entries lead
// (`screens/resume-returns-to-play` and the two beside it), and which key
// pauses (`controls/pause-*`).

import { afterEach, beforeEach, it } from "vitest";
import { MUZZLE_SPEED } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import { QUIET_CORNER, QUIET_CORNER_OPPOSITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseRock,
  requireBullet,
  requireRock,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The rock's drift, in units per second along each axis.
 *
 * A speed of about `120`, inside the `90` to `150` a Medium's own drift runs at
 * (`specs/rocks.md`) — a rock moving no faster than the game itself sets one
 * moving. Aimed down and to the left, away from the star, so an unfrozen field
 * carries it into open space rather than into the core.
 */
const DRIFT_VX = -85;
const DRIFT_VY = 85;

/** The respawn grace posed on the ship, in seconds. */
const POSED_INVULN = 2;

/** The gun's gate posed on the ship, in whole simulation ticks. */
const POSED_COOLDOWN = 30;

/** The seconds posed onto the `WAVE N` banner. */
const POSED_BANNER = 1;

/**
 * How long the paused game is driven for, in ticks.
 *
 * Two seconds. Longer than the `1.5` s `BULLET_LIFE` `specs/weapons.md` gives a
 * round and than the `POSED_BANNER` and `POSED_INVULN` above, so every clock
 * posed here would have run OUT on an unfrozen field rather than merely run
 * down, and long enough that the drifting rock would have crossed a fifth of
 * the field.
 */
const FROZEN_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances no body and no timer while the game is paused, and goes on accumulating simTime", async () => {
  // Live play on an empty, quiet field: one drifting rock, one round in flight,
  // and three clocks with time left on them.
  startPlaying(h);
  const rockId = poseRock(
    h,
    "medium",
    QUIET_CORNER.x,
    QUIET_CORNER.y,
    DRIFT_VX,
    DRIFT_VY,
  );
  const bulletId = poseBullet(
    h,
    QUIET_CORNER_OPPOSITE.x,
    QUIET_CORNER_OPPOSITE.y,
    MUZZLE_SPEED,
    0,
  );
  h.debug.setShipInvuln(POSED_INVULN);
  h.debug.setFireCooldown(POSED_COOLDOWN);
  h.debug.setWaveBanner(POSED_BANNER);

  h.debug.setScreen("paused");
  const before = h.snapshot();

  await h.advance(FROZEN_TICKS);
  const after = h.snapshot();
  captureStill(h, "frozen");

  const held = `after ${String(FROZEN_TICKS)} ticks paused — the paused screen advances nothing, so a paused game is exactly where it was when it was paused (specs/ui.md)`;

  assertEqual(after.screen, "paused", `the screen ${held}`);

  const rockBefore = requireRock(before, rockId, "the rock posed drifting");
  const rockAfter = requireRock(
    after,
    rockId,
    `the rock posed drifting, ${held}`,
  );
  assertEqual(rockAfter.x, rockBefore.x, `the drifting rock's x ${held}`);
  assertEqual(rockAfter.y, rockBefore.y, `the drifting rock's y ${held}`);
  assertEqual(rockAfter.vx, rockBefore.vx, `the drifting rock's vx ${held}`);
  assertEqual(rockAfter.vy, rockBefore.vy, `the drifting rock's vy ${held}`);

  const shotBefore = requireBullet(
    before,
    bulletId,
    "the round posed in flight",
  );
  const shotAfter = requireBullet(
    after,
    bulletId,
    `the round posed in flight, ${held}`,
  );
  assertEqual(shotAfter.x, shotBefore.x, `the round's x ${held}`);
  assertEqual(shotAfter.y, shotBefore.y, `the round's y ${held}`);
  assertEqual(
    shotAfter.life,
    shotBefore.life,
    `the round's remaining life ${held}`,
  );

  assertEqual(after.ship.x, before.ship.x, `the ship's x ${held}`);
  assertEqual(after.ship.y, before.ship.y, `the ship's y ${held}`);
  assertEqual(
    after.ship.invuln,
    before.ship.invuln,
    `the ship's respawn grace ${held}`,
  );
  assertEqual(
    after.ship.fireCooldown,
    before.ship.fireCooldown,
    `the gun's gate, in whole ticks, ${held}`,
  );

  assertEqual(after.waveBanner, before.waveBanner, `the WAVE N banner ${held}`);
  assertEqual(after.wave, before.wave, `the wave number ${held}`);
  assertEqual(after.score, before.score, `the score ${held}`);
  assertEqual(after.lives, before.lives, `the ships left ${held}`);

  assertCloseTo(
    after.simTime - before.simTime,
    seconds(FROZEN_TICKS),
    6,
    `the accumulated simulation time gained over ${String(FROZEN_TICKS)} ` +
      "paused ticks, in seconds — simTime goes on rising while the field is " +
      "frozen, because it counts the ticks the game ran rather than the play " +
      "it ran (specs/ui.md)",
  );
});
