// torpedo/refills-on-respawn — the ship that follows a death carries a full charge.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The charge: "A respawn refills the
// charge to `1` and cancels any recharge in progress." `specs/progression.md`
// fixes what a respawn is: "When a ship is lost and lives remain, the next ship
// appears at rest at the safe point ... with `INVULN_TIME` (`2.5` seconds) of
// respawn grace."
//
// THE CHARGE IS POSED PART-FILLED, AT `0.36`. Not `0`, because a build that
// refills nothing but happens to fill fast would be flattered by a bar that was
// nearly full anyway; and not a round fraction, because `0.36` is a number no
// build arrives at by coincidence. A build that leaves the recharge running reads
// about `0.36` plus what the quarter-second between the death and the reading
// added — under `0.03` — so the two answers are more than nine tenths of the bar
// apart.
//
// THE DEATH IS A REAL ONE. `specs/collision.md` destroys the ship on contact with
// a rock, and this check arranges exactly that: the ship's lethal contact test is
// turned back ON (it is the one gate this scenario's REQUIREMENT depends on), the
// respawn grace is at zero, and one Small is posed on the ship's doorstep closing
// on it. There is no debug operation that respawns a ship, and there is not meant
// to be one: the refill is a consequence of the respawn, so the respawn has to
// happen.
//
// THE ROCK COMES IN FROM THE SIDE FACING AWAY FROM THE STAR, so its whole approach
// is a fall inward: the well adds a fraction of a unit per second along the line
// it is already travelling and never bends it off the ship. The duel is fought at
// `(300, 180)`, `385` units from the star and `510` from the safe point — so the
// ship the respawn puts up is somewhere the dying ship was not.
//
// WHAT IS READ. `torpedoCharge` a quarter of a second after the life fell, by
// which time every build has put its next ship up. That the ship itself is at the
// safe point, at rest and facing up is `lives/respawns-at-the-safe-point`,
// `lives/respawns-at-rest` and `lives/respawns-facing-up`; this item reads the
// charge and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SHIP_R, START_LIVES } from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { STAR, shortestSeparation } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  poseShip,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { POSED_CHARGE_SLACK, requireCharge } from "./scenario";

/** The quiet ground the duel is fought on: far from the star and from the safe point. */
const DUEL_X = 300;
const DUEL_Y = 180;

/** The bar the dying ship carries. See the note above on why it is 0.36. */
const POSED_CHARGE = 0.36;

/** The rock that takes the ship, and how it closes. */
const ROCK = "small" as const;
/** The gap between the two surfaces when the rock is posed, in units. */
const STANDOFF = 40;
/** How fast it closes, in units per second: a sixth of a second of approach. */
const CLOSING_SPEED = 240;

/** How long the contact is waited for, and how long the respawn is given after it. */
const CONTACT_TICKS = ticksFor(0.5);
const RESPAWN_TICKS = ticksFor(0.25);

/**
 * How far below `1` the refilled charge may read, as a fraction of the bar.
 *
 * `0.01`. `specs/weapons.md` fixes the refilled value at `1` exactly and this is
 * not room on it: it covers a build that reaches `1` by clamping a sum, and it is
 * a thirty-second of the distance to the `0.36` a build that refilled nothing
 * would report.
 */
const FULL_TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refills the torpedo charge to 1 on the ship that follows a death", async () => {
  startPlaying(h);
  poseShip(h, { x: DUEL_X, y: DUEL_Y, vx: 0, vy: 0 });
  h.debug.setShipInvuln(0);
  h.debug.setShipCollision(true);
  h.debug.setTorpedoCharge?.(POSED_CHARGE);

  // The side of the ship facing away from the star, so the rock's whole approach
  // is a fall inward and the well never bends it off the line.
  const out = shortestSeparation(STAR, { x: DUEL_X, y: DUEL_Y });
  const length = Math.hypot(out.x, out.y);
  const reach = SHIP_R + ROCK_RADIUS[ROCK] + STANDOFF;
  poseRock(
    h,
    ROCK,
    DUEL_X + (out.x / length) * reach,
    DUEL_Y + (out.y / length) * reach,
    (-out.x / length) * CLOSING_SPEED,
    (-out.y / length) * CLOSING_SPEED,
  );

  const armed = h.snapshot();
  assertEqual(
    armed.lives,
    START_LIVES,
    "the ships the run stands on before the contact, so a respawn follows it " +
      "(specs/progression.md)",
  );
  assertLessThanOrEqual(
    Math.abs(
      requireCharge(armed, "the charge the dying ship carries") - POSED_CHARGE,
    ),
    POSED_CHARGE_SLACK,
    `setTorpedoCharge(${POSED_CHARGE}) to leave the bar part filled, which is ` +
      "the state the respawn has to refill (specs/instrumentation.md)",
  );

  const contact = await h.until((s) => s.lives < START_LIVES, {
    maxFrames: CONTACT_TICKS,
  });
  assertTrue(
    contact.hit,
    "the rock posed on the ship's doorstep to reach it and cost a life, so a " +
      "respawn happens for this item to read (specs/collision.md, " +
      "specs/progression.md)",
  );

  await h.advance(RESPAWN_TICKS);
  const after = h.snapshot();
  // The respawned ship with a full charge.
  captureStill(h, "refilled");

  const charge = requireCharge(after, "the charge the respawned ship carries");
  assertGreaterThanOrEqual(
    charge,
    1 - FULL_TOLERANCE,
    "torpedoCharge to read 1 on the ship the respawn put up — a respawn " +
      "refills the charge to 1 and cancels any recharge in progress " +
      `(specs/weapons.md); read ${charge.toFixed(4)}, against the ` +
      `${POSED_CHARGE} the dying ship carried`,
  );
});
