// ship/bullet-band-fixed — a bullet already in flight keeps its band when the ship
// flips.
//
// specs/bands.md, "The flip": "A bullet already in flight keeps the band it was
// fired with", and specs/ship.md says the same from the cannon's side — a shot
// carries the ship's band "at the instant it is fired, fixed for the bullet's whole
// life". This point decides what the FLIP does to a shot that is already out there,
// and nothing else: that a shot is stamped with the right band in the first place is
// `ship/bullet-carries-band`, that the flip changes the ship's band at all is
// `bands/flip-instant`, and the lockout it starts is `bands/flip-starts-lockout`.
//
// THE FLIP IS A REAL PRESS. specs/instrumentation.md carries no operation that
// flips — `setShipBand` sets the band and starts no lockout, which is a different
// thing — so the only way to put the rule under test in front of the build is the
// flip action itself, delivered at the engine's own event target on the key
// `specs/controls.md` binds `b` to. The check reads the ship's band back afterwards
// and requires it to have changed: a build whose flip did nothing has not put its
// bullet through a flip, and this point is not decided in its favour by a press that
// never happened.
//
// THE SHOTS ARE POSED, NOT FIRED. `addPlayerBullet` adds "one of the player's
// bullets in flight … carrying `band`" (specs/instrumentation.md), which is
// precisely the precondition the rule names — a bullet ALREADY in flight, with a
// band of its own — and posing it keeps the cannon, the cadence and the spawn point
// out of a point about neither. It is also the only way to have both bands in the
// air at once without firing twice around a flip.
//
// TWO BULLETS, ONE ON EACH BAND, AND THAT IS WHAT SEPARATES THE WRONG MODELS. The
// ship is on cyan. A build that re-stamps every bullet with the ship's NEW band
// turns both magenta; a build that flips every bullet along with the ship swaps the
// two; a build that derives a bullet's band from the ship's live band reports both
// as magenta. A single cyan bullet would tell the first two apart from a correct
// build but not from each other, and a single magenta one would miss the first
// entirely. With one of each, every wrong model reads as a different pair — which
// is how the same point reads under the other two engines.
//
// THE SHOTS ARE HELD STILL, with `setBulletVelocity(id, 0, 0)`
// (specs/instrumentation.md), so the bullets the check reads after the flip are
// certainly the same two and are certainly still on the field: `specs/bands.md`
// fixes a bullet's band for its whole life however it moves, so nothing this point
// reads depends on their travel, and specs/field.md's removal at the top of the
// field is `field/player-bullet-leaves-field`'s.
//
// THE FIELD IS WATCHED FOR A FIFTH OF A SECOND AFTER THE FLIP, not read on the
// instant, so a build that repaints its bullets' bands a frame or two later is
// caught rather than sampled just before it acts.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so no drone can
// consume the bullet before the flip lands (specs/bands.md).

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_Y } from "../../src/constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  LANE_CENTER,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";
import { bulletOnRoster } from "./cannon";

/** The key the flip is delivered on: the first `specs/controls.md` binds to `b`. */
const FLIP_KEY = BINDINGS.b[0];

/** The band the ship holds, and the band the first shot is therefore fired with. */
const FIRED_ON: Band = "cyan";

/** The other band, which the second shot carries and the ship flips TO. */
const OTHER_BAND: Band = "magenta";

/** Where the two posed shots stand: either side of the lane, well inside the field. */
const SAME_AT = { x: LANE_CENTER - 80, y: SHIP_Y - 200 };
const OTHER_AT = { x: LANE_CENTER + 80, y: SHIP_Y - 200 };

/**
 * How long the field is watched after the flip, in frames.
 *
 * A fifth of a second — twenty frames of the harness's 100 Hz clock — so a build
 * that re-reads its bullets' bands off the ship on a later frame has had every
 * chance to, and is caught rather than missed by a reading taken on the instant.
 */
const WATCH_FRAMES = ticksFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves both bullets on the bands they were fired with, through a flip", async () => {
  startPosed(h);
  h.debug.setShipBand(FIRED_ON);
  const same = posePlayerBullet(h, SAME_AT.x, SAME_AT.y, FIRED_ON);
  const other = posePlayerBullet(h, OTHER_AT.x, OTHER_AT.y, OTHER_BAND);
  // Held still, so the bullets read after the flip are certainly the same two and
  // are certainly still on the field. A band is fixed for a bullet's whole life
  // however it moves (specs/bands.md), so nothing this point reads is changed by
  // holding them.
  h.debug.setBulletVelocity(same, 0, 0);
  h.debug.setBulletVelocity(other, 0, 0);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the flip action");
  assertEqual(
    before.ship.band,
    FIRED_ON,
    "the band the ship holds before the flip",
  );
  assertEqual(
    bulletOnRoster(before, same, "before the flip").band,
    FIRED_ON,
    "the band the first shot was posed in flight with",
  );
  assertEqual(
    bulletOnRoster(before, other, "before the flip").band,
    OTHER_BAND,
    "the band the second shot was posed in flight with",
  );

  await h.tap(FLIP_KEY);
  await h.advance(WATCH_FRAMES);
  // Before the assertions, so a check that fails still leaves the picture of the
  // field the flip left behind.
  captureStill(h, "kept");

  const after = h.snapshot();
  assertNotEqual(
    after.ship.band,
    FIRED_ON,
    "the ship's band a fifth of a second after the flip action was delivered, " +
      "which must have changed for this scenario to be a flip at all " +
      "(specs/bands.md)",
  );
  assertEqual(
    bulletOnRoster(after, same, `${String(WATCH_FRAMES)} frames after the flip`)
      .band,
    FIRED_ON,
    `the band of the ${FIRED_ON} bullet that was already in flight when the ` +
      `ship flipped to ${after.ship.band} — a bullet already in flight keeps ` +
      "the band it was fired with (specs/bands.md)",
  );
  assertEqual(
    bulletOnRoster(
      after,
      other,
      `${String(WATCH_FRAMES)} frames after the flip`,
    ).band,
    OTHER_BAND,
    `the band of the ${OTHER_BAND} bullet that was already in flight when the ` +
      `ship flipped to ${after.ship.band} — the flip drags no bullet onto the ` +
      "band it left, either (specs/bands.md)",
  );
});
