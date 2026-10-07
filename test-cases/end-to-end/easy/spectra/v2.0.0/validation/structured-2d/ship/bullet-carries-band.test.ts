// ship/bullet-carries-band — a shot carries the band the ship held when it was
// fired.
//
// specs/ship.md, "Firing": a shot "carries the ship's band at the instant it is
// fired, fixed for the bullet's whole life", and specs/bands.md makes that band what
// decides everything the shot then does. This point decides the CARRY, in both
// directions: a shot fired on cyan is a cyan bullet AND a shot fired on magenta is a
// magenta bullet. Both are read here because the item claims both — a build that
// stamps every shot with one fixed band satisfies half of it by accident, and only
// the pair catches it.
//
// THE SHIP'S BAND IS POSED, NOT FLIPPED. `setShipBand` "Sets the ship's band … It
// starts no fire lockout" (specs/instrumentation.md), which is exactly what this
// scenario wants: the flip is `bands/flip-instant`'s point and the lockout it starts
// is `bands/flip-starts-lockout`'s, and a real flip here would put a 0.30 s block on
// the cannon between the two shots and make this point depend on both of them.
// `setFireCooldown(0)` re-opens the cadence for the second shot for the same reason
// — `ship/fire-cadence` owns `FIRE_INTERVAL`, and waiting it out would only make
// this reading depend on it.
//
// THE FIRST SHOT IS HELD STILL, with `setBulletVelocity(id, 0, 0)`
// (specs/instrumentation.md), so the two shots are on the field together: the review
// item's output is one picture of a cyan shot and a magenta shot in flight, and a
// bullet left to climb would be 380 units up the stage — or off the top of the field
// altogether — by the time the second was fired. Freezing it changes nothing this
// point reads: `specs/bands.md` fixes a bullet's band for the bullet's whole life,
// however it moves.
//
// THE SECOND SHOT IS PICKED OUT BY ITS ID, not by counting: `fireOneShot` returns
// the first bullet on the roster that was not there before the press, so which of
// the two is being read is never in doubt.
//
// THE STORED BAND IS WHAT IS READ. `effectiveBand` is `specs/bands.md`'s derived
// value and is graded in the `bands` category; what this point is about is the band
// the shot was stamped with.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters, opens both fire
// gates, leaves the ship on cyan — the band `specs/bands.md` says a run starts on —
// and shuts the wave's entry gate, its dive gate and the ship's contact test, so no
// drone can consume either shot before it is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Band,
  type Harness,
} from "../harness";
import { bulletOnRoster, fireOneShot } from "./cannon";

/** The band the ship is posed on for the first shot: the one a run starts on. */
const FIRST: Band = "cyan";

/** The band the ship is posed on for the second shot: the other one. */
const SECOND: Band = "magenta";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stamps each shot with the band the ship held when it was fired", async () => {
  startPosed(h);
  h.debug.setShipBand(FIRST);
  assertEqual(
    h.snapshot().ship.band,
    FIRST,
    "the band the ship was posed on before the first shot",
  );

  const first = await fireOneShot(h, `the shot fired on ${FIRST}`);
  assertEqual(
    first.band,
    FIRST,
    `the band of the shot fired while the ship held ${FIRST} — a shot carries ` +
      "the ship's band at the instant it is fired (specs/ship.md)",
  );

  // Held still, so it is still on the field, on its own band, when the second shot
  // joins it for the picture the review item asks for.
  h.debug.setBulletVelocity(first.id, 0, 0);
  h.debug.setShipBand(SECOND);
  h.debug.setFireCooldown(0);
  assertEqual(
    h.snapshot().ship.band,
    SECOND,
    "the band the ship was posed on before the second shot",
  );

  const second = await fireOneShot(h, `the shot fired on ${SECOND}`);
  // Before the assertions, so a check that fails still leaves the picture of the two
  // shots the two bands produced.
  captureStill(h, "bands");

  assertEqual(
    second.band,
    SECOND,
    `the band of the shot fired while the ship held ${SECOND} — a shot carries ` +
      "the ship's band at the instant it is fired (specs/ship.md)",
  );
  assertEqual(
    bulletOnRoster(h.snapshot(), first.id, "once the second shot was fired")
      .band,
    FIRST,
    `the band the ${FIRST} shot still carries with both shots on the field, so ` +
      "the two really are a cyan bullet and a magenta bullet at one instant " +
      "(specs/ship.md)",
  );
});
