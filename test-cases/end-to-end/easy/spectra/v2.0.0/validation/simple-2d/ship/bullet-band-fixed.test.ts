// Spectra — ship/bullet-band-fixed: a bullet already in flight keeps its band.
//
// THE RULE. `specs/ship.md`: a shot carries the ship's band "at the instant it is
// fired, FIXED for the bullet's whole life", and `specs/bands.md` says the same
// from the flip's side: "a bullet already in flight keeps the band it was fired
// with". The review item fixes the reading: a bullet already in flight keeps its
// band when the ship flips.
//
// THE FLIP IS A REAL PRESS, BECAUSE THE ITEM IS ABOUT THE FLIP. Posing the ship's
// band with `setShipBand` would catch a build whose bullets READ their band off the
// ship, but not the other wrong model — a flip handler that walks the bullet roster
// and re-stamps what is in the air, which is a plausible reading of "the ship's
// band swaps" and lives entirely inside the action. Only the action itself
// exercises it. That the flip changes the band at all is `bands/flip-instant`'s
// point; it is read here as the scenario's precondition, so a build whose flip does
// nothing fails with that named rather than passing this point because nothing
// happened.
//
// TWO BULLETS, ONE ON EACH BAND, AND THAT IS WHAT SEPARATES THE WRONG MODELS. The
// ship is on cyan. A build that re-stamps every bullet with the ship's NEW band
// turns both magenta; a build that flips every bullet along with the ship swaps the
// two; a build that derives a bullet's band from the ship's live band reports both
// as magenta. A single cyan bullet would tell the first two apart from a correct
// build but not from each other, and a single magenta one would miss the first
// entirely. With one of each, every wrong model reads as a different pair.
//
// THE FLIP IS GIVEN TIME TO ACT. A fifth of a second of game time runs after the
// press, so a build that re-stamps its bullets on a later update rather than
// inside the handler has had every chance to and is caught rather than sampled
// just before it acts. It is the window the same point uses under the other two
// engines.
//
// THE BULLETS ARE PLACED RATHER THAN FIRED, AND HELD STILL. `addPlayerBullet` takes
// the band as an argument, which is the only way to have both bands in the air at
// once without firing twice around a flip — and firing them would put the cannon's
// gates, its spawn point and the `FLIP_LOCKOUT` this very flip starts inside a
// reading about what a bullet in flight remembers. `setBulletVelocity(id, 0, 0)`
// then holds each one where it was placed, so both bullets read after the flip are
// certainly the same two and are certainly still on the field: `specs/ship.md`
// fixes a bullet's band for its whole life however it moves, so nothing this point
// reads depends on its travel, and the removal at the top of the field is
// `field/player-bullet-leaves-field`'s.
//
// THE FLIP KEY IS TAPPED, AND THAT IS THE RIGHT DELIVERY FOR IT. `specs/controls.md`
// reads `b` as a press edge, once per press, so `Harness.tap` — down, up, then the
// one frame that delivers the edge — is exactly a player's press of it. The
// per-frame hold the fire action needs would be a second press's worth of nothing.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no drone can consume either bullet before it is read.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, FIELD_TOP } from "../constants";
import { assertEqual, assertNotEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  findBullet,
  lastBullet,
  startPosed,
  ticksFor,
  type BulletSnapshot,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** The key the flip is delivered on: the first the build bound to `b`. */
const FLIP_KEY = BINDINGS.b[0];

/** The band the run opens on, which `startPosed` restores, and the other one. */
const SHIP_BAND = "cyan" as const;
const OTHER_BAND = "magenta" as const;

/** Where the two bullets are placed: either side of the lane, well inside the field. */
const LEFT_AT = { x: 560, y: FIELD_TOP + 200 } as const;
const RIGHT_AT = { x: 720, y: FIELD_TOP + 200 } as const;

/** How much game time runs after the flip, so a build that re-stamps later is caught. */
const SETTLE_TICKS = ticksFor(0.2);

/**
 * The bullet with that id, or a failure naming what its absence means HERE.
 *
 * A bullet the flip removed is this item's failure and not the harness's, so the
 * verdict names the flip rather than the roster.
 */
function keptBullet(
  snapshot: SpectraSnapshot,
  id: number,
  which: string,
): BulletSnapshot {
  const found = findBullet(snapshot, id);
  if (found === null) {
    fail(
      `${which} to still be in flight after the ship flipped — a bullet in ` +
        "flight keeps the band it was fired with, and keeps flying " +
        "(specs/ship.md)",
      "it had left the bullet roster",
    );
  }
  return found;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves both bullets on the bands they were fired with, through a flip", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the flip is pressed in is live",
  );
  assertEqual(before.ship.band, SHIP_BAND, "the band the ship flips FROM");

  h.debug.addPlayerBullet(LEFT_AT.x, LEFT_AT.y, SHIP_BAND);
  const same = lastBullet(h.snapshot());
  h.debug.addPlayerBullet(RIGHT_AT.x, RIGHT_AT.y, OTHER_BAND);
  const other = lastBullet(h.snapshot());
  assertEqual(
    same.band,
    SHIP_BAND,
    "the band the first bullet was placed with",
  );
  assertEqual(
    other.band,
    OTHER_BAND,
    "the band the second bullet was placed with",
  );
  // Held where they were placed, so the two bullets read after the flip are
  // certainly the same two and are certainly still on the field.
  h.debug.setBulletVelocity(same.id, 0, 0);
  h.debug.setBulletVelocity(other.id, 0, 0);

  await h.tap(FLIP_KEY);
  await h.advance(SETTLE_TICKS);
  // Before the assertions, so a check that fails still leaves the picture of the
  // two shots the flip passed over.
  captureStill(h, "kept");
  const after = h.snapshot();
  assertNotEqual(
    after.ship.band,
    SHIP_BAND,
    "the ship's band after the flip — the flip is what this scenario needs to " +
      "have happened (specs/bands.md)",
  );

  assertEqual(
    keptBullet(after, same.id, "the bullet fired on the ship's old band").band,
    SHIP_BAND,
    `the band of the bullet in flight on ${SHIP_BAND}, after the ship flipped ` +
      `to ${OTHER_BAND} (specs/ship.md)`,
  );
  assertEqual(
    keptBullet(after, other.id, "the bullet fired on the other band").band,
    OTHER_BAND,
    `the band of the bullet in flight on ${OTHER_BAND}, after the ship ` +
      `flipped to ${OTHER_BAND} (specs/ship.md)`,
  );
});
