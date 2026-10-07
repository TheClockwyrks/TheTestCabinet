// Shatter — screens/pause-freezes-the-field: the paused screen advances nothing.
//
// THE RULE. `specs/ui.md`, on `paused`: "The field stays visible behind the menu and
// is frozen: nothing advances. No body moves, no timer runs down, no wave arrives, no
// rock spawns, no saucer arrives or fires, and no cue plays, so a paused game is
// exactly where it was when it was paused. The accumulated simulation time goes on
// rising: it counts the ticks the game ran rather than the play it ran."
//
// So the rule has two halves and both are read here, because they are the two halves
// of one requirement rather than two requirements: what the pause holds STILL, and
// the one quantity it does not. A build that froze the clock along with the field
// would satisfy the first half and break the rule, and `specs/instrumentation.md`
// states the same thing a second time — "`simTime` accumulates every tick's
// `TICK_DT`, whatever the screen".
//
// THE SCENE, AND WHY EACH PIECE OF IT IS THERE. A DRIFTING ROCK is a body, and it is
// posed far from the star so that the well cannot be mistaken for the freeze: over
// the two seconds this runs, a live field carries it three hundred units. A BULLET IN
// FLIGHT is a second body and a running timer at once — `specs/weapons.md` gives it
// `BULLET_LIFE` (`1.5` s), which is SHORTER than the pause, so on a build that keeps
// stepping it is not merely moved but GONE, and the roster count says so. A WAVE
// BANNER is the third reading, a timer that belongs to the run rather than to any
// entity and that `specs/ui.md` names in the same sentence ("no wave arrives"). And
// THE SHIP IS THE FOURTH, because it is the one body no scenario can remove and it
// carries two timers of its own: it is posed with a drift, so a build that froze the
// rosters and kept flying the ship is caught by its position, and with a respawn
// grace and a fire gate part-way down, so a build that froze every body and kept
// counting its timers is caught by those — which is the half of the sentence that
// reads "no timer runs down".
//
// THE FIELD IS RUNNING BEFORE IT IS PAUSED. The scene is stepped for a fifth of a
// second first, so what the pause stops is a game in motion rather than a scene that
// had never moved — a build that never stepped anything at all is caught by the
// bullet's life having fallen before the pause.
//
// THE PAUSE IS POSED, NOT PRESSED. `setScreen("paused")` is the direct route to the
// screen whose BEHAVIOUR this item grades; that `KeyP` and `Escape` reach it is
// `controls/pause-p` and `controls/pause-escape`'s requirement.
//
// WHAT THIS ITEM DOES NOT DECIDE. What the pause menu shows
// (`screens/pause-menu-entries`), or that the game comes back as it stood
// (`screens/resume-returns-to-play`).

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import { BULLET_LIFE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  poseBullet,
  poseRock,
  requireBullet,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { reachPaused } from "./screens";

/** Where the drifting rock is posed: far out, where the well moves it slowly. */
const ROCK_AT = { x: 200, y: 200 };
/** Its drift: fast enough that two live seconds would carry it three hundred units. */
const ROCK_DRIFT = { vx: 150, vy: 0 };

/** Where the bullet is posed, well clear of the rock and of the star's core. */
const BULLET_AT = { x: 1040, y: 620 };
/** Its velocity, up the field and into nothing. */
const BULLET_DRIFT = { vx: 0, vy: -420 };

/**
 * The seconds left on the wave banner when the pause lands.
 *
 * Shorter than the pause, so a build that kept the run's timers going has let it run
 * out rather than merely shortened it.
 */
const BANNER_SECONDS = 1.0;

/** Ticks of live play before the pause, so what is frozen is a game in motion. */
const LIVE_TICKS = ticksFor(0.2);

/** The seconds the game is held paused. */
const PAUSED_SECONDS = 2.0;

/**
 * Where the ship is posed and the drift it carries.
 *
 * `(640, 560)` is the safe point a fresh ship stands at, and the drift runs along
 * the row it stands on, so two live seconds would carry it clear across the field
 * while the pause holds it where it was. It stays `200` units from the star's centre
 * throughout, far outside the `CORE_R + SHIP_R` (`44`) at which the slide begins, so
 * nothing but the freeze decides where it ends.
 */
const SHIP_AT = { x: 640, y: 560 };
const SHIP_DRIFT = { vx: 120, vy: 0 };

/**
 * The respawn grace and the fire gate the ship is posed with.
 *
 * Both part-way down and both SHORTER than the pause, so a build that kept them
 * running has let each reach zero rather than merely shortened it: the grace at
 * `2.5` seconds is down to `2.3` by the pause and would be gone well inside the two
 * seconds that follow, and the gun's gate of `60` whole ticks is down to `36` and
 * would be gone inside a third of a second.
 */
const SHIP_INVULN = 2.5;
const SHIP_COOLDOWN = 60;

/**
 * How closely a frozen reading must hold, as {@link assertCloseTo} decimal places:
 * two, so within `0.005` of where it stood, in logical units or in seconds.
 *
 * Nothing frozen moves at all, so this is not a measurement allowance: it covers only
 * a build that rebuilds an unchanged field from unchanged fields in floating point.
 * It is well under a hundredth of what one tick of the posed scene covers — the rock
 * travels `1.25` units in a tick and every timer falls `TICK_DT` (`0.0083` s) — so a
 * build that stepped even one tick of the pause is caught.
 */
const FROZEN_DIGITS = 2;

/**
 * How far the accumulated simulation time may miss the seconds the pause ran, in
 * seconds.
 *
 * Half a tick. `specs/simulation.md` advances the game in whole ticks, so a build
 * whose `simTime` is a tick ahead or behind at the moment either reading is taken is
 * still counting every tick the game ran, which is the rule; a build that stopped the
 * clock reads `0` and a build that ran the clock at some other rate misses by far
 * more than this.
 */
const SIM_TIME_TOLERANCE = TICK_DT / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every body and every timer where they stood while the pause runs, and goes on counting ticks", async () => {
  await startPlaying(h);
  const rockId = await poseRock(
    h,
    "medium",
    ROCK_AT.x,
    ROCK_AT.y,
    ROCK_DRIFT.vx,
    ROCK_DRIFT.vy,
  );
  const bulletId = await poseBullet(
    h,
    BULLET_AT.x,
    BULLET_AT.y,
    BULLET_DRIFT.vx,
    BULLET_DRIFT.vy,
  );
  await h.debug.setWaveBanner(BANNER_SECONDS);
  await h.debug.setShipPosition(SHIP_AT.x, SHIP_AT.y);
  await h.debug.setShipVelocity(SHIP_DRIFT.vx, SHIP_DRIFT.vy);
  await h.debug.setShipInvuln(SHIP_INVULN);
  await h.debug.setFireCooldown(SHIP_COOLDOWN);

  // A fifth of a second of real play, so the pause stops a field in motion.
  await h.advance(LIVE_TICKS);
  const before = await h.snapshot();
  const rockBefore = requireRock(
    before,
    rockId,
    "the drifting rock at the pause",
  );
  const bulletBefore = requireBullet(
    before,
    bulletId,
    "the bullet in flight at the pause",
  );
  assertLessThanOrEqual(
    bulletBefore.life,
    BULLET_LIFE,
    "the bullet's remaining life at the pause, after a fifth of a second of play",
  );

  await reachPaused(h);
  await h.advance(ticksFor(PAUSED_SECONDS));
  await captureStill(h, "frozen");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "paused",
    "the screen still showing after the pause ran",
  );

  const rockAfter = requireRock(
    after,
    rockId,
    "the drifting rock after the pause",
  );
  assertCloseTo(
    rockAfter.x,
    rockBefore.x,
    FROZEN_DIGITS,
    "the paused rock's x (specs/ui.md)",
  );
  assertCloseTo(
    rockAfter.y,
    rockBefore.y,
    FROZEN_DIGITS,
    "the paused rock's y (specs/ui.md)",
  );
  assertCloseTo(
    rockAfter.vx,
    rockBefore.vx,
    FROZEN_DIGITS,
    "the paused rock's vx (specs/ui.md)",
  );
  assertCloseTo(
    rockAfter.vy,
    rockBefore.vy,
    FROZEN_DIGITS,
    "the paused rock's vy (specs/ui.md)",
  );

  const bulletAfter = requireBullet(
    after,
    bulletId,
    "the bullet in flight after the pause",
  );
  assertCloseTo(
    bulletAfter.x,
    bulletBefore.x,
    FROZEN_DIGITS,
    "the paused bullet's x (specs/ui.md)",
  );
  assertCloseTo(
    bulletAfter.y,
    bulletBefore.y,
    FROZEN_DIGITS,
    "the paused bullet's y (specs/ui.md)",
  );
  assertCloseTo(
    bulletAfter.life,
    bulletBefore.life,
    FROZEN_DIGITS,
    "the paused bullet's remaining life, a timer that would have run out (specs/ui.md)",
  );

  assertCloseTo(
    after.waveBanner,
    before.waveBanner,
    FROZEN_DIGITS,
    "the paused wave banner's remaining seconds (specs/ui.md)",
  );

  // The ship: a body that was drifting, and two timers of its own that were
  // running. `specs/ui.md`: "No body moves, no timer runs down."
  assertCloseTo(
    after.ship.x,
    before.ship.x,
    FROZEN_DIGITS,
    "the paused ship's x, posed with a drift of 120 units per second (specs/ui.md)",
  );
  assertCloseTo(
    after.ship.y,
    before.ship.y,
    FROZEN_DIGITS,
    "the paused ship's y (specs/ui.md)",
  );
  assertCloseTo(
    after.ship.invuln,
    before.ship.invuln,
    FROZEN_DIGITS,
    "the paused ship's remaining respawn grace, a timer that would have run out (specs/ui.md)",
  );
  assertEqual(
    after.ship.fireCooldown,
    before.ship.fireCooldown,
    "the paused ship's fire gate, in whole ticks, which would have run out (specs/ui.md)",
  );

  assertLessThanOrEqual(
    Math.abs(after.simTime - before.simTime - PAUSED_SECONDS),
    SIM_TIME_TOLERANCE,
    "the simulation time the paused ticks added, which goes on rising (specs/ui.md)",
  );
});
