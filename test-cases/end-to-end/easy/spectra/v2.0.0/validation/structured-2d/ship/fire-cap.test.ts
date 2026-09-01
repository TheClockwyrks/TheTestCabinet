// ship/fire-cap — however long fire is held, at most `MAX_PLAYER_BULLETS` of the
// player's bullets are alive at once.
//
// specs/ship.md, "What blocks a shot": a shot is allowed only when "Fewer than
// `MAX_PLAYER_BULLETS` (`3`) of the player's bullets are in flight." This point
// decides that ceiling, and only the ceiling: it is an upper bound, so the check
// asserts one.
//
// THE SCENARIO IS POSED ON THE GATE'S OWN BOUNDARY. Two of the player's bullets are
// placed on the field before the key goes down, which is exactly one short of the
// cap: "fewer than 3" is true at two and false at three, so a conforming build takes
// one more shot and then takes none, however long the key stays down. Reaching the
// boundary by posing it rather than by firing up to it is what keeps this point off
// the cadence's ground — nothing below reads a spacing — and it is what makes the
// wrong models read as different numbers: a build with NO cap climbs past 8 over the
// held two seconds, a build that caps at 4 reads 4, and a conforming build reads 3.
//
// THE TWO POSED BULLETS ARE NOT BYSTANDERS — they ARE the precondition this point
// is about, a cap one shot from closing — and they are HELD STILL with
// `setBulletVelocity(id, 0, 0)` (specs/instrumentation.md), which is the same
// isolation as posing an entity with only the faculties its requirement exercises:
// what a bullet counts toward is not its travel. Left to travel they would climb
// out of the play field in 0.77 s and specs/field.md would remove them, handing
// their slots back and turning the rest of the window into a check on the field's
// edge — `field/player-bullet-leaves-field`'s point, not this one. Standing still
// they hold their two slots for the whole hold, which is what "however long fire is
// held" asks. A bullet with no velocity is still one of the player's bullets in
// flight: specs/ship.md counts what is on the roster.
//
// THE SHIP'S OWN SHOT IS LEFT TO TRAVEL, so the window is not a frozen tableau: the
// third bullet climbs off the top after two thirds of a second, the cap re-opens,
// the build fires again, and the ceiling is tested over and over across the two
// seconds rather than once.
//
// THE PEAK IS SAMPLED EVERY FRAME, so a build that briefly overfills and then trims
// its roster is caught: `FIRE_INTERVAL` is sixteen frames of the harness's 100 Hz
// clock, and no shot can appear and vanish inside one.
//
// THE HOLD IS SHOWN TO HAVE FIRED, so the ceiling is a ceiling on something. A
// cannon that fires nothing ends the hold on the two posed bullets alone and
// trivially satisfies any cap, so one shot beyond the posed pair is demanded first
// — the scenario's precondition, not a second requirement. That a press fires is
// `ship/fire-spawns-bullet`'s point, and how often shots leave is
// `ship/fire-cadence`'s; neither is restated here. The bound above the precondition
// stays one-sided, so a build with a slower cadence that never reaches three still
// passes this point and loses that one.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so the only friendly
// bullets counted are the two posed and whatever the held key adds, and no drone can
// consume one (specs/bands.md).

import { afterEach, beforeEach, it } from "vitest";
import { MAX_PLAYER_BULLETS, SHIP_Y } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  LANE_CENTER,
  playerBullets,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { FIRE_KEY } from "./cannon";

/** How long the fire action is held: two seconds, the "however long" of the point. */
const HOLD_SECONDS = 2;
const HOLD_FRAMES = ticksFor(HOLD_SECONDS);

/** How many of the player's bullets are posed: one short of the cap. */
const POSED = MAX_PLAYER_BULLETS - 1;

/** How far apart the posed bullets stand, and how far above the ship's lane. */
const POSED_SPACING = 160;
const POSED_Y = SHIP_Y - 120;

/**
 * Where the posed bullets stand: spread evenly about the centre of the ship's lane.
 *
 * Well clear of the column the ship fires up, so the still shows the posed pair and
 * the build's own shot apart from one another, and inside the play field on both
 * axes. Derived from `POSED` rather than written out, so the arrangement follows
 * `MAX_PLAYER_BULLETS` wherever the specification puts it.
 */
const POSED_AT = Array.from({ length: POSED }, (_, n) => ({
  x: LANE_CENTER + (n - (POSED - 1) / 2) * POSED_SPACING,
  y: POSED_Y,
}));

/** The band the posed bullets carry. Immaterial here: no drone is on the field. */
const BAND = "cyan";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never lets more than MAX_PLAYER_BULLETS friendly bullets be alive at once", async () => {
  startPosed(h);
  for (const at of POSED_AT) {
    const id = posePlayerBullet(h, at.x, at.y, BAND);
    // Held still, so the two slots they occupy are still occupied at the end of the
    // hold rather than given back by the field's own edge.
    h.debug.setBulletVelocity(id, 0, 0);
  }

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the fire action");
  assertEqual(
    before.ship.cooldown,
    0,
    "the fire cooldown the ship was posed with",
  );
  assertEqual(
    before.ship.lockout,
    0,
    "the fire lockout the ship was posed with",
  );
  assertLength(
    playerBullets(before),
    POSED,
    "the player's bullets posed on the field before the key went down, one " +
      `short of MAX_PLAYER_BULLETS (${String(MAX_PLAYER_BULLETS)})`,
  );

  let peak = playerBullets(before).length;
  h.hold(FIRE_KEY);
  try {
    for (let frame = 0; frame < HOLD_FRAMES; frame += 1) {
      await h.advance(1);
      peak = Math.max(peak, playerBullets(h.snapshot()).length);
    }
  } finally {
    h.release(FIRE_KEY);
  }
  // Before the assertion, so a check that fails still leaves the picture of the
  // field the held key produced.
  captureStill(h, "capped");

  assertGreaterThanOrEqual(
    peak,
    POSED + 1,
    "the most of the player's bullets alive at once over the hold, against the " +
      `${String(POSED)} posed before it — the hold put at least one more of the ` +
      "player's bullets in the air, so the cap below is a cap on something. A " +
      "cannon that fires nothing trivially satisfies any ceiling, and it is " +
      "ship/fire-spawns-bullet that grades whether a press fires; this only keeps " +
      "that build from passing here as well",
  );
  assertLessThanOrEqual(
    peak,
    MAX_PLAYER_BULLETS,
    `the most of the player's bullets alive at once at any frame of ` +
      `${String(HOLD_SECONDS)}s of held fire, begun with ${String(POSED)} of ` +
      "them already in flight — a shot is allowed only while fewer than " +
      `MAX_PLAYER_BULLETS (${String(MAX_PLAYER_BULLETS)}) are (specs/ship.md)`,
  );
});
