// screens/pause-freezes-the-field — nothing on the field advances while the game
// is paused.
//
// THE RULE. `specs/ui.md` on the `paused` screen: "the field stays visible behind
// the menu and is frozen: nothing advances. No body moves, no timer runs down, no
// wave arrives, no rock spawns, no saucer arrives or fires, and no cue plays, so a
// paused game is exactly where it was when it was paused." And the one exception,
// fixed by the same paragraph: "the accumulated simulation time goes on rising: it
// counts the ticks the game ran rather than the play it ran." So both halves are
// read here — every reading held, and `simTime` alone still climbing.
//
// A LIVE FIELD FIRST, AND WHY THAT MATTERS. A pose that never moved is frozen
// whatever the build does, so the scenario is run LIVE for `LIVE_TICKS` before the
// pause and the rock's own movement over that stretch is asserted. Only then is
// the game paused. A build that froze the whole game — one that never advanced the
// field at all — fails the live half, and a build that kept simulating behind the
// menu fails the frozen half; neither can pass by doing nothing.
//
// WHAT IS POSED, AND WHY EACH ONE. `specs/ui.md` names bodies AND timers, so the
// scenario carries one of each kind the game holds: a rock drifting under the
// well, one of the ship's bullets in flight with a lifetime running, and a ship
// carrying velocity — which under `specs/ship.md` sheds speed to drag every tick
// it is not thrusting, so a build that kept stepping the ship shows it in the
// velocity as well as the position. The three timers are the respawn grace, the
// gun's cooldown and the `WAVE N` banner, each posed part-spent so it has somewhere
// to run down to. Everything else is emptied by `startPlaying`, so there is no
// bystander whose movement could be read as this scenario's.
//
// THE SCREEN IS POSED, NOT PAUSED INTO, with `setScreen("paused")`
// (`specs/instrumentation.md`): the key that pauses is `controls/pause-p`'s
// requirement, and posing the screen puts the pause on a tick boundary the check
// chose, so the reading taken the instant after it is the state the pause left.
//
// THE BOUND. "Nothing advances" admits no drift at all, so every held reading is
// compared to `FROZEN_DIGITS` decimal places rather than against a tolerance: the
// only allowance is a build that recomputes a value it did not change. Two whole
// seconds pass under the pause — two hundred and forty ticks, against a rock that
// would cover ROCK_DRIFT units in that time — so a build leaking even a single
// tick of simulation is far outside it.
//
// WHAT THIS ITEM DOES NOT DECIDE. That `RESUME` gives the run back, which is
// `screens/resume-returns-to-play`, nor that a saucer visiting is held with
// everything else, which is `saucer/restart-despawns`'s neighbouring concern.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  bulletById,
  createHarness,
  poseBullet,
  poseRock,
  rockById,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** How long the field is run LIVE before the pause, in ticks: a tenth of a second. */
const LIVE_TICKS = ticksFor(0.1);

/** How long the paused field is watched, in ticks: the two seconds the item names. */
const PAUSED_TICKS = ticksFor(2);

/**
 * Where the drifting rock is posed, and how fast, in logical units.
 *
 * Out in the field's upper left, `394` units from the star at `(640, 360)` — well
 * outside everything the star draws (`specs/field.md`) — and clear of the ship, of
 * the bullet and of every edge, so nothing it does over the live stretch is a
 * collision or a wrap. `120` units per second is inside the `60` to `210` a rock's
 * own drift runs at (`specs/rocks.md`), so the field is moving no faster than the
 * game itself sets it moving.
 */
const ROCK_SPOT = { x: 300, y: 160 };
const ROCK_DRIFT = 120;

/**
 * Where the bullet in flight is posed, and how fast.
 *
 * Over on the right, far from the rock and from the ship, travelling up the field
 * so its own lifetime is running down while it moves. `400` units per second is
 * under the `520` muzzle speed `specs/weapons.md` fixes, and its `1.5` s lifetime
 * outlasts the live stretch many times over.
 */
const BULLET_SPOT = { x: 960, y: 560 };
const BULLET_SPEED = 400;

/** The velocity the ship carries into the pause, in units per second. */
const SHIP_DRIFT = 120;

/** The three timers, each posed part-spent so it has somewhere left to run. */
const POSED_INVULN = 1.0; // seconds of respawn grace
const POSED_COOLDOWN = 30; // whole ticks of the gun's gate
const POSED_BANNER = 1.0; // seconds left on the WAVE N banner

/**
 * How far a rock must have travelled over the live stretch to have been moving.
 *
 * `LIVE_TICKS` at `ROCK_DRIFT` is ten units; five is half of it, which no build
 * that stepped the field misses and no build that did not can reach.
 */
const MOVED_AT_LEAST = 5;

/**
 * The decimal places every held reading is compared to.
 *
 * Not a tolerance on the BEHAVIOUR — `specs/ui.md` freezes the field outright —
 * but on the arithmetic: a build that recomputes a position it did not change may
 * land a float's last bits away from where it started. Six places is a millionth
 * of a logical unit, against a rock that would move `240` of them over the same
 * stretch unpaused.
 */
const FROZEN_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds every body and every timer where the pause found them", async () => {
  startPlaying(h);
  const rockId = poseRock(h, "small", ROCK_SPOT.x, ROCK_SPOT.y, ROCK_DRIFT, 0);
  const bulletId = poseBullet(
    h,
    BULLET_SPOT.x,
    BULLET_SPOT.y,
    0,
    -BULLET_SPEED,
  );
  h.debug.setShipVelocity(SHIP_DRIFT, 0);
  h.debug.setShipInvuln(POSED_INVULN);
  h.debug.setFireCooldown(POSED_COOLDOWN);
  h.debug.setWaveBanner(POSED_BANNER);

  // The field really is live: the rock covers ground before anything is paused.
  const opened = rockById(h.snapshot(), rockId, "the drifting rock, as posed");
  await h.advance(LIVE_TICKS);
  const running = rockById(
    h.snapshot(),
    rockId,
    "the drifting rock, in flight",
  );
  assertGreaterThan(
    Math.hypot(running.x - opened.x, running.y - opened.y),
    MOVED_AT_LEAST,
    "the logical units the rock covered over the live stretch before the " +
      "pause, which is what makes the frozen reading mean anything",
  );

  h.debug.setScreen("paused");
  const stood = h.snapshot();
  assertEqual(stood.screen, "paused", "the screen the field was frozen on");

  await h.advance(PAUSED_TICKS);
  captureStill(h, "frozen");

  const later = h.snapshot();
  assertEqual(
    later.screen,
    "paused",
    "the screen still showing two seconds on",
  );

  // No body moves.
  const rockStood = rockById(
    stood,
    rockId,
    "the rock the pause found drifting",
  );
  const rockLater = rockById(
    later,
    rockId,
    "the rock two seconds into the pause",
  );
  for (const field of ["x", "y", "vx", "vy"] as const) {
    assertCloseTo(
      rockLater[field],
      rockStood[field],
      FROZEN_DIGITS,
      `the rock's ${field} two seconds into a pause that advances nothing ` +
        `(specs/ui.md)`,
    );
  }
  const bulletStood = bulletById(stood, bulletId, "the bullet the pause found");
  const bulletLater = bulletById(later, bulletId, "the bullet two seconds on");
  for (const field of ["x", "y", "vx", "vy"] as const) {
    assertCloseTo(
      bulletLater[field],
      bulletStood[field],
      FROZEN_DIGITS,
      `the bullet's ${field} two seconds into a pause that advances nothing ` +
        `(specs/ui.md)`,
    );
  }
  for (const field of ["x", "y", "vx", "vy"] as const) {
    assertCloseTo(
      later.ship[field],
      stood.ship[field],
      FROZEN_DIGITS,
      `the ship's ${field} two seconds into a pause that advances nothing ` +
        `(specs/ui.md)`,
    );
  }

  // No timer runs down.
  assertCloseTo(
    bulletLater.life,
    bulletStood.life,
    FROZEN_DIGITS,
    "the seconds left on the bullet's lifetime (specs/ui.md)",
  );
  assertCloseTo(
    later.ship.invuln,
    stood.ship.invuln,
    FROZEN_DIGITS,
    "the seconds left of respawn grace (specs/ui.md)",
  );
  assertCloseTo(
    later.ship.fireCooldown,
    stood.ship.fireCooldown,
    FROZEN_DIGITS,
    "the ticks left on the gun's cooldown (specs/ui.md)",
  );
  assertCloseTo(
    later.waveBanner,
    stood.waveBanner,
    FROZEN_DIGITS,
    "the seconds left on the WAVE N banner (specs/ui.md)",
  );

  // No wave arrives, no rock spawns, and no saucer arrives.
  assertEqual(
    later.rocks.length,
    stood.rocks.length,
    "the rocks on the frozen field (specs/ui.md)",
  );
  assertEqual(later.wave, stood.wave, "the wave the frozen run is on");
  assertEqual(later.saucer, null, "the saucer a paused game does not receive");

  // And the one reading that does go on: simTime counts the ticks that ran.
  assertCloseTo(
    later.simTime - stood.simTime,
    secondsFor(PAUSED_TICKS),
    2,
    "the seconds of simulation time a paused game accumulates, which counts " +
      "the ticks the game ran rather than the play it ran (specs/ui.md)",
  );
});
