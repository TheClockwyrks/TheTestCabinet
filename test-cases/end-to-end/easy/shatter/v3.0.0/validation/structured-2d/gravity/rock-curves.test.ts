// gravity/rock-curves — the well turns a drifting rock's course toward the star.
//
// THE RULE. `specs/gravity.md`, "Which bodies are pulled", gives "a rock, of any
// size" a `Yes`. `specs/rocks.md` gives a rock a straight-line drift and nothing
// that steers it, so the well is the only thing in the game that can turn one,
// and a field of rocks that all fly straight is a build that never ran its
// gravity pass over the rock roster.
//
// GRADED SEPARATELY FROM THE ROUNDS, because a build writes its gravity pass over
// the rosters it remembers: `gravity/bullet-curves` and
// `gravity/enemy-bullet-curves` name the two bullet rosters, and this names the
// rocks. A build can pull every round it fires and let its rocks fly straight.
//
// WHAT IS READ. The HEADING of the rock's velocity, before and a second after —
// which is what the review item asks for, "its velocity direction turning toward
// the star over a second of game time" — rather than a displacement. A heading is
// the reading that separates a curve from a drift: a rock the well merely
// accelerated along its own course would gain speed and hold its direction, and
// a heading reads that as zero turn where a displacement would read it as motion.
//
// THE POSE. A Medium at `(400, 200)` drifting `(100, 0)`. Three things about it:
//
//   IT IS A LEGAL DRIFT. `specs/rocks.md` gives a Medium a base drift speed
//   between 90 and 150 units per second, so `100` is a course the game itself
//   would have handed out, and nothing about the scenario is a speed the
//   specification does not produce.
//
//   THE STAR IS OFF THE COURSE, not on it. The rock starts 288 units from the
//   star, on a bearing 33.7 degrees off its own heading — so the pull has a
//   component ACROSS the course, which is the component that turns it. A rock
//   flown straight at the star would be accelerated and never turned, and the
//   item would read zero on a conformant build.
//
//   IT NEVER REACHES THE CORE. `specs/collision.md` recycles a rock that touches
//   the core, contact for a Medium being at `CORE_R + 26` = 56 units. The bent
//   path's closest approach over the whole recorded stretch is 110 units, so
//   nothing is recycled and the reading is the curve rather than a collision.
//
// THE FLOOR, AND WHY IT IS A FLOOR. `specs/gravity.md`'s law integrated over that
// second at `specs/simulation.md`'s timestep turns the course by 19.1 degrees.
// This item asserts more than 8 — under half of it — because the requirement is
// that the well bends a rock, not that it bends one by a particular amount: HOW
// HARD the well pulls is `gravity/pull-magnitude`'s item, decided against the law
// to 5 percent, and a build that pulls too hard should fail there and pass here
// rather than failing both for one fault. What the gap between 8 and 19.1 buys is
// room for a build whose integrator differs from this file's arithmetic, and it
// is still eight degrees clear of the 0.0 a build that does not pull its rocks
// reads.
//
// THE SIGN IS THE DIRECTION. The star lies below the rock's course, so a turn
// toward it is a positive turn (`specs/overview.md` measures angles clockwise
// with `y` running down the field). Asserting the SIGNED turn is what makes this
// "toward the star" rather than "away from its line": a build that pushed its
// rocks away would read -19 degrees and fail, where a check on the unsigned turn
// would have passed it.
//
// THE RECORDING RUNS PAST THE READING. The verdict is taken at one second; the
// replay carries on for another 0.4 so a reviewer sees the rock still curving,
// rather than a clip that cuts on the frame the measurement was taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { DEG, angleDelta, headingOf } from "../geometry";

/** Where the rock is posed, and the drift it is posed on. */
const ROCK = { size: "medium" as const, x: 400, y: 200, vx: 100, vy: 0 };

/** The heading that drift is along, which the turn is measured from. */
const START_HEADING = Math.atan2(ROCK.vy, ROCK.vx);

/** The second of game time the turn is read over. */
const CURVE_TICKS = ticksFor(1);

/** How much of the curve the recording keeps after the reading is taken. */
const TAIL_TICKS = ticksFor(0.4);

/**
 * How far the course must have turned toward the star in that second, in degrees.
 *
 * A floor, not a figure: `specs/gravity.md`'s law over this pose turns the course
 * by 19.1 degrees, and 8 is under half of it. See the header for why the item is
 * decided on a floor and what the gap is spent on.
 */
const MIN_TURN = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns a drifting rock's course toward the star over a second", async () => {
  startPlaying(h);

  const id = poseRock(h, ROCK.size, ROCK.x, ROCK.y, ROCK.vx, ROCK.vy);

  const turned = await captureReplay(h, "curve", async () => {
    await h.advance(CURVE_TICKS);
    // The reading, at the instant the second is up.
    const rock = requireRock(
      h.snapshot(),
      id,
      "the rock posed drifting past the star still on the field a second " +
        "later, its path never reaching the core (specs/collision.md)",
    );
    const turn = angleDelta(START_HEADING, headingOf(rock)) / DEG;
    // And the rest of the curve, for the reviewer.
    await h.advance(TAIL_TICKS);
    return turn;
  });

  assertGreaterThan(
    turned,
    MIN_TURN,
    `the degrees a rock drifting at (${ROCK.vx}, ${ROCK.vy}) past the star ` +
      `turned toward it over one second, measured as the signed change in the ` +
      `heading of its velocity: the well pulls a rock of any size ` +
      "(specs/gravity.md) and nothing in specs/rocks.md steers one, so a rock " +
      "that flew straight reads 0",
  );
});
