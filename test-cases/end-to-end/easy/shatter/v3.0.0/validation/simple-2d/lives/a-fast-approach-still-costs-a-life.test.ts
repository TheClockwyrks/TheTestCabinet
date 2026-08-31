// lives/a-fast-approach-still-costs-a-life — the ship is not passed through by a
// body closing at the game's top speed.
//
// THE RULE. `specs/collision.md`, under "Every body is a circle": "Collision is
// swept or continuous. Two bodies whose paths over a tick bring them within the
// sum of their radii at any point of that tick collide on it, however fast either
// was travelling and however far either moved. No body passes through another in a
// tick." This is the SHIP's half of that requirement;
// `bullets/no-tunnelling-at-speed` is the bullet's, and the two are graded apart so
// a build that sweeps its shots but samples its ship loses one point rather than
// none.
//
// TWELVE HUNDRED UNITS PER SECOND IS THE GAME'S OWN TOP CLOSING SPEED.
// `specs/weapons.md` launches a round at `MUZZLE_SPEED` (`520`) on top of the
// ship's own velocity and `specs/ship.md` caps that at `SHIP_MAX` (`680`), so
// `1200` is the fastest anything in this game closes on anything else — ten units
// of travel in one tick of the `TICK_HZ` (`120`) clock `specs/simulation.md`
// fixes. The rule quoted above is written for any pair at any speed, and
// `setRockVelocity` is what lets a check pose one (`specs/instrumentation.md`).
//
// THE APPROACH BEGINS OUTSIDE TOUCHING DISTANCE AND ENDS INSIDE IT. The ship
// collides at `SHIP_R` (`14`) and a Small at `ROCK_RADIUS.small` (`14`), so the
// pair touches at `28`. The rock is posed `37` units out, nine clear of that, and
// the tick carries it to `27` — a unit inside. A build that resolves its
// collisions against where the pair STOOD when the tick began, or that samples the
// separation before the field moves, reads `37` and lets the rock through; a build
// that resolves them against the path the tick just ran, as `specs/simulation.md`
// orders it (motion at step 4, collision at step 6), takes the ship.
//
// THE MISS IS THE CONTROL, AND IT IS OFFSET BY MORE THAN THE PAIR'S OWN RADII. The
// same rock, on the same approach, displaced `32` units across it — four more than
// the `28` at which the two touch — must leave the ship whole. Without it a build
// that killed the ship for any rock passing anywhere near would pass the hit, and
// the item would be reading proximity rather than contact. It is flown first, and
// the field is cleared before the approach that counts.
//
// AND EXACTLY ONE LIFE IS SPENT, on the tick the approach lands. A build that
// resolves the same overlap on tick after tick reads `1` rather than `2`, which is
// why the reading is the counter rather than "a life was lost".

import { afterEach, beforeEach, it } from "vitest";
import {
  MUZZLE_SPEED,
  ROCK_RADIUS,
  SHIP_MAX,
  SHIP_R,
  TICK_DT,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { DEATH_SPOT, SHIP_TOUCHES_SMALL } from "./scene";

/** The fastest anything in this game closes on anything else: `1200` units/second. */
const CLOSING = MUZZLE_SPEED + SHIP_MAX;

/** What that is worth in one tick of the fixed `TICK_HZ` clock: ten units. */
const STEP = CLOSING * TICK_DT;

/**
 * How far above the ship's centre the rock is posed, in logical units.
 *
 * One tick's travel outside touching distance, less a unit. The unit is not room on
 * any figure: it keeps the tick's END separation a clear unit inside `28` rather
 * than exactly on it, so the verdict is not decided by which side of a float
 * comparison the boundary falls on. The tick still BEGINS nine units outside
 * touching distance, which is the whole of what the reading turns on.
 */
const APPROACH = SHIP_TOUCHES_SMALL + STEP - 1;

/** How far across the approach the control is displaced: more than `28`. */
const MISS_OFFSET = SHIP_TOUCHES_SMALL + 4;

/** How long the control is flown for: long enough to pass the ship entirely. */
const MISS_TICKS = 6;

/** The ticks of aftermath the replay keeps once the approach has resolved. */
const AFTERMATH_TICKS = ticksFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends exactly one ship on a Small crossing it at 1200 units per second, and none on the same rock offset past their radii", async () => {
  startPlaying(h);
  h.debug.setShipPosition(DEATH_SPOT.x, DEATH_SPOT.y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipInvuln(0);
  // The gate this whole group turns on: the contact test IS the requirement.
  h.debug.setShipCollision(true);
  const before = h.snapshot().lives;

  const runs = await captureReplay(h, "sweep", async () => {
    // The control: the same closing speed, displaced across the approach by more
    // than the pair touch at, flown until it is past the ship.
    poseRock(
      h,
      "small",
      DEATH_SPOT.x + MISS_OFFSET,
      DEATH_SPOT.y - APPROACH,
      0,
      CLOSING,
    );
    await h.advance(MISS_TICKS);
    const missed = h.snapshot();
    h.debug.clearRocks();

    // And the approach itself, aimed through the centre, read after exactly one
    // tick — the tick `specs/collision.md` says it collides on.
    poseRock(h, "small", DEATH_SPOT.x, DEATH_SPOT.y - APPROACH, 0, CLOSING);
    await h.advance(1);
    const struck = h.snapshot();

    await h.advance(AFTERMATH_TICKS);
    return { missed, struck };
  });

  assertEqual(
    runs.missed.lives,
    before,
    `the ships left after a Small at ${CLOSING} units per second passed the ship ` +
      `${MISS_OFFSET} units across its approach, which is more than the ` +
      `${SHIP_R} + ${ROCK_RADIUS.small} at which the two touch ` +
      `(specs/collision.md)`,
  );
  assertEqual(
    runs.struck.lives,
    before - 1,
    `the ships left after the one tick a Small closing at ${CLOSING} units per ` +
      `second crossed from ${APPROACH.toFixed(0)} units out to ` +
      `${(APPROACH - STEP).toFixed(0)} — from nine units outside the ` +
      `${SHIP_TOUCHES_SMALL} at which the pair touches to a unit inside it. Two ` +
      `bodies whose paths over a tick bring them within the sum of their radii ` +
      `at any point of that tick collide on it, and losing a ship costs one life ` +
      `(specs/collision.md, specs/progression.md)`,
  );
});
