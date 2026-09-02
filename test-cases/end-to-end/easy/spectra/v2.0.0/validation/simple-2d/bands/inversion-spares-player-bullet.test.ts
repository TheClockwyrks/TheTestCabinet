// bands/inversion-spares-player-bullet — a player bullet is never inverted.
//
// specs/bands.md, "Effective band": "The ship's band and the player's bullets are
// never swapped. A player bullet's effective band always equals its stored band,
// and the ship reads its own true band through an inversion." The inversion's own
// section says the same from the other side — "Nothing about the ship, the
// player's bullets, or any stored band changes."
//
// THIS IS THE EXCEPTION TO `bands.inversion-swaps-enemy-bullet`, and the pair is
// what separates a build that swaps the right roster from one that swaps every
// bullet on the field. The two are posed identically — the same band, the same
// inversion, the same single frame — and differ only in which `add*Bullet`
// operation put the bullet in flight, so a build that inverts indiscriminately
// passes that point and fails this one.
//
// THE BULLET IS PLACED RATHER THAN FIRED, so the stored band under test is the
// one this check chose and no lockout, cadence or cap can keep the shot from
// existing (specs/ship.md gates the cannon three ways; none of them is this
// point's business).
//
// IT IS PLACED WELL BELOW THE LINE THAT REMOVES IT — specs/field.md removes a
// player bullet whose centre climbs above `FIELD_TOP` (`64`) — so the single
// frame that runs leaves it on the roster to be read.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  bulletOf,
  captureStill,
  createHarness,
  lastBullet,
  startPosed,
  type Harness,
} from "../harness";

/** Where the bullet is placed: mid-field, far below FIELD_TOP (specs/field.md). */
const BULLET_X = LANE_CENTER;
const BULLET_Y = 400;

/** The band the player's bullet stores, which an inversion must not touch. */
const STORED_BAND = "cyan" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a player bullet's stored band while an inversion runs", async () => {
  startPosed(h);
  h.debug.setInversion(INVERSION_TIME);
  h.debug.addPlayerBullet(BULLET_X, BULLET_Y, STORED_BAND);
  const bulletId = lastBullet(h.snapshot()).id;

  await h.advance(1);
  captureStill(h, "kept");

  const posed = h.snapshot();
  assertEqual(
    posed.inversionActive,
    true,
    `an inversion running over the posed bullet after setInversion ` +
      `(${INVERSION_TIME} s) — without one there is nothing for the player's ` +
      "bullet to be spared from",
  );

  const bullet = bulletOf(posed, bulletId);
  assertEqual(
    bullet.friendly,
    true,
    "the bullet posed as the player's, which is what makes it one of the " +
      "bullets specs/bands.md spares",
  );
  assertEqual(
    bullet.band,
    STORED_BAND,
    "the bullet's stored band, which is the band the reading below has to " +
      "equal for the sparing to mean anything",
  );
  assertEqual(
    bullet.effectiveBand,
    STORED_BAND,
    `the effective band of one of the player's bullets storing ` +
      `${STORED_BAND} with an inversion of ${INVERSION_TIME} s posed — ` +
      "specs/bands.md: the player's bullets are never swapped, so a player " +
      "bullet's effective band always equals its stored band",
  );
});
