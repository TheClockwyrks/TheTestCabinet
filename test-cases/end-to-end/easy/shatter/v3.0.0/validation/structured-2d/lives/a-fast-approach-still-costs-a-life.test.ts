// lives/a-fast-approach-still-costs-a-life — a rock closing fast takes the ship
// on the tick their paths meet, not a tick later.
//
// THE RULE. `specs/collision.md`: "Collision is swept or continuous. Two bodies
// whose paths over a tick bring them within the sum of their radii at any point
// of that tick collide ON IT, however fast either was travelling and however far
// either moved. No body passes through another in a tick." This is the ship's
// half of that requirement; `bullets/no-tunnelling-at-speed` is the bullet's, and
// the two are separate items so a grade names which body a build resolves
// against stale positions.
//
// THE POSE. A Small is placed `RANGE` (36) units from the ship's centre and
// closed at `CLOSING_SPEED` (1200) units per second — a step of `10` units a
// tick, against the `SHIP_R + ROCK_RADIUS.small` (28) at which
// `specs/collision.md` says two bodies touch. So at the START of the tick the
// two are 8 units clear of contact, and at its END they are 2 units inside it.
// Neither figure is anywhere near the boundary, so nothing here is decided by
// rounding.
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
// The ship is posed at rest on quiet ground with its lethal contact test on and
// no respawn grace, and the field holds nothing but the two bodies.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SHIP_R, START_LIVES, TICK_DT } from "../../src/constants";
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
import { poseDuel, poseRockAtRange } from "./duel";

/** The size the rock is posed at: the tightest of the three collision radii. */
const ROCK = "small" as const;

/** The speed the rock closes at, in units per second. The figure the item names. */
const CLOSING_SPEED = 1200;

/** How far the rock travels in one simulation tick, in units: 10. */
const STEP = CLOSING_SPEED * TICK_DT;

/** Contact, as `specs/collision.md` defines it for a ship and a Small: 28. */
const CONTACT = SHIP_R + ROCK_RADIUS[ROCK];

/**
 * The separation the rock is posed at, in units: 36.
 *
 * Contact plus eight tenths of a tick's travel, so the tick that runs carries
 * the rock from 8 units clear of contact to 2 units inside it. Both margins are
 * a fifth of the step, so neither the reading before the tick nor the one after
 * sits on the boundary.
 */
const RANGE = CONTACT + STEP * 0.8;

/** More of the field after the contact, filmed for the replay. */
const DWELL_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends exactly one life on the tick a fast rock reaches the ship", async () => {
  poseDuel(h);
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
    CLOSING_SPEED,
    "setRockVelocity to be reported by the snapshot, so the rock really " +
      "closes at the speed this item names (specs/instrumentation.md)",
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
    "the ships left one tick after a rock 8 units clear of contact closed " +
      "10 units — the tick their paths meet on is the tick they collide on " +
      "(specs/collision.md)",
  );
});
