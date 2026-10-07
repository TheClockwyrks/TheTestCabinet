// lives/a-fast-approach-still-costs-a-life — the ship is not passed through by a
// body closing on it as fast as the two of them can close.
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
// EACH BODY IS POSED INSIDE ITS OWN STATED RANGE, AND THE CLOSING SPEED IS THE SUM.
// `specs/ship.md` caps the ship's speed at `SHIP_MAX` (`680`), and `specs/rocks.md`
// gives a Small a base drift speed of `130` to `210`, so a Small at
// `ROCK_SPEED_MAX.small` flown head-on into a ship at its cap closes at `890` units
// per second — a little over seven units of travel in one tick of the `TICK_HZ`
// (`120`) clock `specs/simulation.md` fixes. Neither body carries a figure its own
// specification does not allow it; how the pair is ARRANGED is the validator's, and
// the rule quoted above is written for any pair at any speed.
//
// THE APPROACH BEGINS OUTSIDE TOUCHING DISTANCE AND ENDS INSIDE IT. The ship
// collides at `SHIP_R` (`14`) and a Small at `ROCK_RADIUS.small` (`14`), so the
// pair touches at `28`. They are posed eight tenths of a tick's closing outside
// that, so the tick begins with six units of clear air between them and ends with
// them a unit and a half overlapped — each margin a fifth of the step, so neither
// reading sits on a boundary. A build that resolves its collisions against where
// the pair STOOD when the tick began, or that samples the separation before the
// field moves, finds them clear and lets the rock through; a build that resolves
// them against the paths the tick just ran, as `specs/simulation.md` orders it
// (motion at step 4, collision at step 6), takes the ship.
//
// THE MISS IS THE CONTROL, AND IT IS OFFSET BY MORE THAN THE PAIR'S OWN RADII. The
// same pair, on the same approach at the same speeds, displaced `32` units across
// it — four more than the `28` at which the two touch — must leave the ship whole.
// Without it a build that killed the ship for any rock passing anywhere near would
// pass the hit, and the item would be reading proximity rather than contact. It is
// flown first, and both bodies are posed afresh before the approach that counts.
//
// AND EXACTLY ONE LIFE IS SPENT, on the tick the approach lands. A build that
// resolves the same overlap on tick after tick reads `1` rather than `2`, which is
// why the reading is the counter rather than "a life was lost".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  SHIP_MAX,
  SHIP_R,
  TICK_DT,
} from "../constants";
import {
  captureReplay,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { DEATH_SPOT, SHIP_TOUCHES_SMALL } from "./scene";

/** The fastest a Small enters the field, of its own stated range: `210`. */
const ROCK_SPEED = ROCK_SPEED_MAX.small;

/** What the two of them close at with each at its own bound: `890` units/second. */
const CLOSING = SHIP_MAX + ROCK_SPEED;

/** What that is worth in one tick of the fixed `TICK_HZ` clock. */
const STEP = CLOSING * TICK_DT;

/**
 * The separation the pair is posed at, in logical units.
 *
 * Touching distance plus eight tenths of a tick's closing, so the tick that runs
 * carries them from a fifth of a step clear of contact to a fifth of a step inside
 * it. Neither margin is on the boundary, so the verdict is not decided by which
 * side of a float comparison a figure falls on.
 */
const APPROACH = SHIP_TOUCHES_SMALL + STEP * 0.8;

/** How far across the approach the control is displaced: more than `28`. */
const MISS_OFFSET = SHIP_TOUCHES_SMALL + 4;

/** How long the control is flown for: long enough to carry it past the ship. */
const MISS_TICKS = Math.ceil((APPROACH + SHIP_TOUCHES_SMALL) / STEP);

/** The ticks of aftermath the replay keeps once the approach has resolved. */
const AFTERMATH_TICKS = ticksFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The ship at the duel ground, flying straight up at its own cap. */
function poseCharge(harness: Harness): void {
  harness.debug.setShipPosition(DEATH_SPOT.x, DEATH_SPOT.y);
  harness.debug.setShipVelocity(0, -SHIP_MAX);
  harness.debug.setShipInvuln(0);
  // The gate this whole group turns on: the contact test IS the requirement.
  harness.debug.setShipCollision(true);
}

it("spends exactly one ship on a Small it meets head-on with each at its own top speed, and none on the same rock offset past their radii", async () => {
  startPlaying(h);
  poseCharge(h);
  const before = h.snapshot().lives;

  const runs = await captureReplay(h, "sweep", async () => {
    // The control: the same pair at the same speeds, displaced across the
    // approach by more than they touch at, flown until it is past the ship.
    poseRock(
      h,
      "small",
      DEATH_SPOT.x + MISS_OFFSET,
      DEATH_SPOT.y - APPROACH,
      0,
      ROCK_SPEED,
    );
    await h.advance(MISS_TICKS);
    const missed = h.snapshot();
    h.debug.clearRocks();

    // And the approach itself, aimed through the centre, on ground laid fresh —
    // the ship has flown a way up the field by now — read after exactly one tick,
    // the tick `specs/collision.md` says it collides on.
    poseCharge(h);
    poseRock(h, "small", DEATH_SPOT.x, DEATH_SPOT.y - APPROACH, 0, ROCK_SPEED);
    await h.advance(1);
    const struck = h.snapshot();

    await h.advance(AFTERMATH_TICKS);
    return { missed, struck };
  });

  assertEqual(
    runs.missed.lives,
    before,
    `the ships left after a Small drifting at ${ROCK_SPEED} units per second ` +
      `met a ship flying at ${SHIP_MAX} — ${CLOSING} between them — ` +
      `${MISS_OFFSET} units across its approach, which is more than the ` +
      `${SHIP_R} + ${ROCK_RADIUS.small} at which the two touch ` +
      "(specs/collision.md)",
  );
  assertEqual(
    runs.struck.lives,
    before - 1,
    `the ships left after the one tick a Small drifting at ${ROCK_SPEED} units ` +
      `per second and a ship flying at ${SHIP_MAX} closed from ` +
      `${APPROACH.toFixed(1)} units apart to ${(APPROACH - STEP).toFixed(1)} — ` +
      `from outside the ${SHIP_TOUCHES_SMALL} at which the pair touches to ` +
      "inside it. Two bodies whose paths over a tick bring them within the sum " +
      "of their radii at any point of that tick collide on it, and losing a " +
      "ship costs one life (specs/collision.md, specs/progression.md)",
  );
});
