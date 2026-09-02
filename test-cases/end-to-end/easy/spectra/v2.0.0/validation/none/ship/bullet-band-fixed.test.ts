// Spectra — ship/bullet-band-fixed: a bullet already in flight keeps its band.
//
// THE RULE. `specs/ship.md`: a shot carries the ship's band "at the instant it is
// fired, FIXED for the bullet's whole life", and `specs/instrumentation.md` says
// the same from the surface's side: "a bullet's band is fixed for its life.
// Nothing sets it after the fact." The review item fixes the reading: a bullet
// already in flight keeps its band when the ship flips.
//
// THE FLIP IS A REAL PRESS, BECAUSE THE ITEM IS ABOUT THE FLIP. Posing the ship's
// band with `setShipBand` would catch a build whose bullets READ their band off
// the ship, but not the other wrong model — a flip handler that walks the bullet
// roster and re-stamps what is in the air, which is a plausible reading of "the
// ship's band swaps" and lives entirely inside the action. Only the action itself
// exercises it. That the flip changes the band at all is `bands/flip-instant`'s
// point; it is read here as the scenario's precondition, so a build whose flip
// does nothing fails with that named rather than passing this point because
// nothing happened.
//
// TWO BULLETS, ONE ON EACH BAND, AND THAT IS WHAT SEPARATES THE WRONG MODELS. The
// ship is on cyan. A build that re-stamps every bullet with the ship's NEW band
// turns both magenta; a build that flips every bullet along with the ship swaps
// the two; a build that derives a bullet's band from the ship's live band reports
// both as magenta. A single cyan bullet would tell the first two apart from a
// correct build but not from each other, and a single magenta one would miss the
// first entirely. With one of each, every wrong model reads as a different pair.
//
// THE FLIP IS GIVEN TIME TO ACT. A fifth of a second of game time runs after the
// press, so a build that re-stamps its bullets on a later update rather than
// inside the handler has had every chance to and is caught rather than sampled
// just before it acts. It is the window the same point uses under both engines.
//
// THE BULLETS ARE PLACED RATHER THAN FIRED, AND HELD STILL. `addPlayerBullet`
// takes the band as an argument, which is the only way to have both bands in the
// air at once without firing twice around a flip — and firing them would put the
// cannon's gates, its spawn point and the `FLIP_LOCKOUT` this very flip starts
// inside a reading about what a bullet in flight remembers.
// `setBulletVelocity(id, 0, 0)` then holds each one where it was placed, so both
// bullets read after the flip are certainly the same two and are certainly still
// on the field: `specs/ship.md` fixes a bullet's band for its whole life however
// it moves, so nothing this point reads depends on its travel, and the removal at
// the top of the field is `field/player-bullet-leaves-field`'s.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no drone can consume either bullet before it is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, fail } from "../assert";
import { BINDINGS, FIELD_TOP, opposite } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  lastBullet,
  requireBullet,
  startPosed,
  type Harness,
} from "../harness";

/** The key the flip is delivered on: the first `specs/controls.md` binds to `b`. */
const FLIP_KEY = BINDINGS.b[0];

/** The band the run opens on, which `startPosed` restores. */
const SHIP_BAND = "cyan" as const;

/** Where the two bullets are placed: either side of the lane, well inside the field. */
const LEFT_AT = { x: 560, y: FIELD_TOP + 200 };
const RIGHT_AT = { x: 720, y: FIELD_TOP + 200 };

/** How much game time runs after the flip, so a build that re-stamps later is caught. */
const SETTLE_FRAMES = framesFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves both bullets on the bands they were fired with, through a flip", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the flip is pressed in is live",
  );
  assertEqual(before.ship.band, SHIP_BAND, "the band the ship flips FROM");

  await h.debug.addPlayerBullet(LEFT_AT.x, LEFT_AT.y, SHIP_BAND);
  const same = lastBullet(await h.snapshot());
  await h.debug.addPlayerBullet(RIGHT_AT.x, RIGHT_AT.y, opposite(SHIP_BAND));
  const other = lastBullet(await h.snapshot());
  if (same === undefined || other === undefined) {
    fail(
      "addPlayerBullet to append each bullet to the roster (specs/instrumentation.md)",
      "the bullet roster did not grow for both placements",
    );
  }
  assertEqual(
    same.band,
    SHIP_BAND,
    "the band the first bullet was placed with",
  );
  assertEqual(
    other.band,
    opposite(SHIP_BAND),
    "the band the second bullet was placed with",
  );
  // Held where they were placed, so the two bullets read after the flip are
  // certainly the same two and are certainly still on the field.
  await h.debug.setBulletVelocity(same.id, 0, 0);
  await h.debug.setBulletVelocity(other.id, 0, 0);

  await h.tap(FLIP_KEY);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "kept");
  const after = await h.snapshot();
  assertNotEqual(
    after.ship.band,
    SHIP_BAND,
    "the ship's band after the flip — the flip is what this scenario needs to have happened (specs/bands.md)",
  );

  assertEqual(
    requireBullet(after, same.id, "the bullet fired on the ship's old band")
      .band,
    SHIP_BAND,
    `the band of the bullet in flight on ${SHIP_BAND}, after the ship flipped to ${opposite(SHIP_BAND)} (specs/ship.md)`,
  );
  assertEqual(
    requireBullet(after, other.id, "the bullet fired on the other band").band,
    opposite(SHIP_BAND),
    `the band of the bullet in flight on ${opposite(SHIP_BAND)}, after the ship flipped to ${opposite(SHIP_BAND)} (specs/ship.md)`,
  );
});
