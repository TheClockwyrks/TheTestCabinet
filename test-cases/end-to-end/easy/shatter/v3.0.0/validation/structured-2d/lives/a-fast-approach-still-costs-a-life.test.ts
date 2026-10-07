// lives/a-fast-approach-still-costs-a-life — a rock and a ship closing as fast as
// the two of them can meet on the tick their paths cross, not a tick later.
//
// THE RULE. `specs/collision.md`: "Collision is swept or continuous. Two bodies
// whose paths over a tick bring them within the sum of their radii at any point
// of that tick collide ON IT, however fast either was travelling and however far
// either moved. No body passes through another in a tick." This is the ship's
// half of that requirement; `bullets/no-tunnelling-at-speed` is the bullet's, and
// the two are separate items so a grade names which body a build resolves
// against stale positions.
//
// EACH BODY IS POSED INSIDE ITS OWN STATED RANGE, AND THE CLOSING SPEED IS THE
// SUM. `specs/ship.md` caps the ship's speed at `SHIP_MAX` (680), and
// `specs/rocks.md` gives a Small a base drift speed of 130 to 210, so a Small at
// `ROCK_SPEED_MAX.small` flown head-on into a ship at its cap closes at
// `CLOSING_SPEED` (890) units per second. Neither body carries a figure its own
// specification does not allow it; how the pair is ARRANGED is this validator's.
//
// THE POSE. The Small is placed `RANGE` units from the ship's centre along the
// line the ship is charging out from the star on, against the
// `SHIP_R + ROCK_RADIUS.small` (28) at which `specs/collision.md` says two bodies
// touch. `RANGE` is eight tenths of a tick's closing outside that, so at the
// START of the tick the two are a fifth of a step clear of contact and at its END
// they are a fifth of a step inside it. Neither figure is anywhere near the
// boundary, so nothing here is decided by rounding.
//
// WHAT THAT SEPARATES. A build that resolves contact against the positions the
// bodies MOVED TO reads the overlap and spends the life on this tick. A build
// that resolves against the positions they came FROM — the reading the rule
// forbids, and the one a build reaches by resolving collisions before it
// integrates — finds them 8 units clear, spends nothing, and only notices on the
// tick after. So the reading is the exact tick, taken twice: no life is owed
// before a tick has run, and exactly one is owed after one has.
//
// EXACTLY ONE, because a build that resolves the same pair once per position
// and once per sweep drops two.
//
// AND THE MISS IS THE CONTROL. The same pair, on the same approach at the same
// speeds, run down a parallel line displaced `MISS_ACROSS` (32) units across it —
// four more than the 28 at which the pair touches — must leave every ship
// standing. Without it a build that spent a life for any rock passing anywhere
// near the ship would pass the reading above, and this item would be grading
// proximity rather than contact. It is flown FIRST, on its own ground, and the
// field is laid fresh before the approach that counts, so neither reading can be
// the other one's leftovers.
//
// The ship is posed on quiet ground with its lethal contact test on and no
// respawn grace, and the field holds nothing but the two bodies.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  SHIP_MAX,
  SHIP_R,
  START_LIVES,
  TICK_DT,
} from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import { speedOf, wrappedDistance } from "../geometry";
import {
  captureReplay,
  createHarness,
  requireRock,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";
import { chargeVelocity, poseDuel, poseRockAtRange } from "./duel";

/** The size the rock is posed at: the tightest of the three collision radii. */
const ROCK = "small" as const;

/** The fastest a Small enters the field, of its own stated range: 210. */
const ROCK_SPEED = ROCK_SPEED_MAX[ROCK];

/** What the two of them close at with each at its own bound: 890 units/second. */
const CLOSING_SPEED = SHIP_MAX + ROCK_SPEED;

/** How far the pair closes in one simulation tick, in units. */
const STEP = CLOSING_SPEED * TICK_DT;

/** Contact, as `specs/collision.md` defines it for a ship and a Small: 28. */
const CONTACT = SHIP_R + ROCK_RADIUS[ROCK];

/**
 * The separation the pair is posed at, in units.
 *
 * Contact plus eight tenths of a tick's closing, so the tick that runs carries
 * them from a fifth of a step clear of contact to a fifth of a step inside it.
 * Neither margin sits on the boundary.
 */
const RANGE = CONTACT + STEP * 0.8;

/**
 * How far across its approach the control rock is displaced, in units: 32.
 *
 * Four more than the `CONTACT` (28) at which `specs/collision.md` has the pair
 * touch, so the nearest the two circles come over the whole of the control's run
 * is four units of clear air. A rock that never touched the ship costs no life,
 * however fast it went past.
 */
const MISS_ACROSS = CONTACT + 4;

/** How long the control is flown for: long enough to carry it past the ship. */
const MISS_TICKS = Math.ceil((RANGE + CONTACT) / STEP);

/** More of the field after the contact, filmed for the replay. */
const DWELL_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends exactly one life on the tick a fast rock reaches the ship, and none on the same rock offset past their radii", async () => {
  // The control first: the same rock at the same closing speed, on a line that
  // misses the ship's centre by more than the two touch at, flown until it is
  // past the ship entirely.
  poseDuel(h, chargeVelocity(SHIP_MAX));
  poseRockAtRange(h, ROCK, RANGE, CLOSING_SPEED, MISS_ACROSS);
  await h.advance(MISS_TICKS);
  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    `the ships left after a ${ROCK} drifting at ${String(ROCK_SPEED)} units ` +
      `per second met a ship flying at ${String(SHIP_MAX)} — ` +
      `${String(CLOSING_SPEED)} between them — and passed it ` +
      `${String(MISS_ACROSS)} units across its ` +
      `approach, which is more than the SHIP_R + ROCK_RADIUS.${ROCK} ` +
      `(${String(CONTACT)}) at which the two touch — a body that never came ` +
      "within the sum of the radii never collided (specs/collision.md)",
  );

  // And the approach that counts, on ground laid fresh.
  poseDuel(h, chargeVelocity(SHIP_MAX));
  const rockId = poseRockAtRange(h, ROCK, RANGE, CLOSING_SPEED);

  const armed = h.snapshot();
  const rock = requireRock(armed, rockId, "the rock posed to charge the ship");
  assertEqual(
    armed.ship.collision,
    true,
    "the ship's lethal contact test running for the approach " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    armed.ship.invuln,
    0,
    "the ship carrying no respawn grace, so the contact is lethal " +
      "(specs/collision.md)",
  );
  assertGreaterThan(
    wrappedDistance(
      { x: rock.x, y: rock.y },
      { x: armed.ship.x, y: armed.ship.y },
    ),
    CONTACT,
    "the rock posed clear of contact, so no life is owed until a tick has " +
      "run (specs/collision.md)",
  );
  assertEqual(
    Math.round(speedOf(rock)),
    ROCK_SPEED,
    "setRockVelocity to be reported by the snapshot, so the rock really " +
      "drifts at the top of a Small's own stated range " +
      "(specs/instrumentation.md, specs/rocks.md)",
  );
  assertEqual(
    armed.lives,
    START_LIVES,
    "the ships the run stands on before the tick (specs/progression.md)",
  );

  let struck: ShatterSnapshot = armed;
  await captureReplay(h, "sweep", async () => {
    await h.advance(1);
    struck = h.snapshot();
    // Filmed past the reading, so the replay shows what the contact did rather
    // than cutting on the frame it was measured at.
    await h.advance(DWELL_TICKS);
  });

  assertEqual(
    struck.lives,
    START_LIVES - 1,
    `the ships left one tick after a pair ${(RANGE - CONTACT).toFixed(1)} ` +
      `units clear of contact closed ${STEP.toFixed(1)} — the tick their paths ` +
      "meet on is the tick they collide on (specs/collision.md)",
  );
});
