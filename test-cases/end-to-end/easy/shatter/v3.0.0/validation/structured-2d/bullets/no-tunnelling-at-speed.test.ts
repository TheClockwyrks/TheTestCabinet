// bullets/no-tunnelling-at-speed — a round closing at the game's top speed takes
// the rock it closed on.
//
// specs/collision.md, "Every body is a circle": "Collision is swept or
// continuous. Two bodies whose paths over a tick bring them within the sum of
// their radii at any point of that tick collide on it, however fast either was
// travelling and however far either moved. No body passes through another in a
// tick." The pair here is the fastest one the gun can produce: specs/weapons.md
// launches a round at `MUZZLE_SPEED` (`520`) on top of the ship's own velocity,
// and specs/ship.md caps that at `SHIP_MAX` (`680`), so `1200` units per second
// is the top closing speed a round can carry — ten units of travel in one tick of
// the `TICK_HZ` (`120`) clock specs/simulation.md fixes.
//
// THE SHOT BEGINS OUTSIDE TOUCHING DISTANCE AND ENDS INSIDE IT. A Small collides
// at `ROCK_RADIUS.small` (`14`) and a round at `BULLET_R` (`3`), so the pair
// touches at `17`. The round is posed `26` units out, nine units clear of that,
// and the tick carries it to `16` — a unit inside. A build that resolves its
// collisions against where the pair STOOD when the tick began, or that samples
// the separation before the field moves, reads `26` and lets the round through; a
// build that resolves them against the path the tick just ran, as
// specs/collision.md requires, takes the rock. This is the one item in the group a
// build with the wrong pass order fails while passing every radius reading.
//
// ONE ROUND IS ENOUGH TO DESTROY THE TARGET UNDER EITHER VARIANT. The target is a
// Small, and specs/rocks.md's `warhead` armour table gives a Small a health of
// `1` — so the hit that lands is the hit that destroys it whether or not the
// variant grades armour, and this item reads the sweep rather than the health.
//
// THE ROUND CARRIES THE ROCK'S OWN VELOCITY on top of its approach, so the
// closing speed along the line between them is exactly the `1200` the scenario
// names whatever the well has done to the rock by then, and the separation really
// does close by ten units in the tick.
//
// THE MISS IS THE CONTROL, AND IT IS OFFSET BY MORE THAN THE PAIR'S OWN RADII.
// The same round, on the same approach, displaced `21` units across it — four
// units more than the `17` at which the two touch — must leave the rock standing.
// Without it a build that removes any rock a round passes anywhere near would pass
// the hit, and the item would be reading proximity rather than contact. It is
// fired first, so the rock it leaves standing is the rock the second shot takes.
//
// THE FIELD IS QUIET AND THE PAIR IS FAR FROM THE STAR. `startPlaying` leaves no
// other rock, no saucer and no enemy fire, and `QUIET_CORNER` is `412` units from
// the star's centre — outside everything the star draws, and far enough that the
// well moves the pair by a few hundredths of a unit over the ticks this runs for.
//
// AND THE CLIP DOES NOT CUT ON THE MEASUREMENT. The verdict is read on the tick
// the round crossed, but the recording runs a fifth of a second past it, so the
// reviewer sees the Small come apart rather than the frame it was still whole in.

import { afterEach, beforeEach, it } from "vitest";
import {
  BULLET_R,
  MUZZLE_SPEED,
  ROCK_RADIUS,
  SHIP_MAX,
  TICK_DT,
} from "../constants";
import { assertTrue } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseBullet,
  poseRock,
  requireRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the Small stands: the quiet ground, well clear of the star. */
const ROCK_X = QUIET_CORNER.x;
const ROCK_Y = QUIET_CORNER.y;

/** The fastest a round can close: the muzzle speed on top of the ship's cap. */
const SPEED = MUZZLE_SPEED + SHIP_MAX;
/** What that is worth in one tick of the fixed `TICK_HZ` clock: ten units. */
const STEP = SPEED * TICK_DT;
/** The separation at which a round and a Small touch (specs/collision.md). */
const COMBINED = BULLET_R + ROCK_RADIUS.small;

/**
 * How far the round is posed from the rock's centre, in logical units.
 *
 * One tick's travel outside touching distance, less a unit. The unit is not room
 * on any figure: it keeps the tick's END separation a clear unit inside `17`
 * rather than exactly on it, so the verdict is not decided by which side of a
 * float comparison the boundary falls on. The tick still BEGINS nine units
 * outside touching distance, which is the whole of what the reading turns on.
 */
const APPROACH = COMBINED + STEP - 1;

/** How far across the approach the control shot is displaced: more than `17`. */
const MISS_OFFSET = COMBINED + 4;

/** How long the control shot is flown for: long enough to pass the rock entirely. */
const MISS_TICKS = 6;

/** The ticks of aftermath the replay keeps once the shot has resolved. */
const AFTERMATH_TICKS = ticksFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a Small with a round closing at 1200 units per second, and misses it when offset by more than their radii", async () => {
  startPlaying(h);
  const rockId = poseRock(h, "small", ROCK_X, ROCK_Y);

  const runs = await captureReplay(h, "sweep", async () => {
    // The control: the same approach, displaced across it by more than the pair
    // touch at, flown until it is past the rock.
    const posed = requireRock(
      h.snapshot(),
      rockId,
      "the Small the fast round is aimed at",
    );
    poseBullet(
      h,
      posed.x - APPROACH,
      posed.y + MISS_OFFSET,
      posed.vx + SPEED,
      posed.vy,
    );
    await h.advance(MISS_TICKS);
    const missed = h.snapshot();
    h.debug.clearBullets();

    // And the shot itself, aimed through the centre, read after exactly one tick.
    // The rock is re-read where the control left it, and falls back to the pose
    // only if the control destroyed it — which the first assertion below fails on.
    const target = rockById(missed, rockId) ?? posed;
    poseBullet(h, target.x - APPROACH, target.y, target.vx + SPEED, target.vy);
    await h.advance(1);
    const struck = h.snapshot();

    await h.advance(AFTERMATH_TICKS);
    return { missed, struck };
  });

  assertTrue(
    runs.missed.rocks.some((rock) => rock.id === rockId),
    `the Small still on the field after a round at ${SPEED} units per second ` +
      `passed it ${MISS_OFFSET} units across its approach, which is more than ` +
      `the ${COMBINED} at which a round and a Small touch ` +
      `(specs/collision.md); the rock roster held ` +
      `${JSON.stringify(runs.missed.rocks.map((rock) => rock.id))}`,
  );
  assertTrue(
    !runs.struck.rocks.some((rock) => rock.id === rockId),
    `the Small destroyed on the one tick a round closing at ${SPEED} units ` +
      `per second crossed from ${APPROACH} units out to ` +
      `${(APPROACH - STEP).toFixed(0)} — from nine units outside the ` +
      `${COMBINED} at which the pair touch to a unit inside it ` +
      `(specs/collision.md: two bodies whose paths over a tick bring them ` +
      `within the sum of their radii at any point of that tick collide on it); ` +
      `the rock roster held ` +
      `${JSON.stringify(runs.struck.rocks.map((rock) => rock.id))}`,
  );
});
